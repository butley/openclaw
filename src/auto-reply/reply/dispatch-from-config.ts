import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import type { OpenClawConfig } from "../../config/config.js";
import { loadSessionStore, resolveStorePath, type SessionEntry } from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";
import { createInternalHookEvent, triggerInternalHook } from "../../hooks/internal-hooks.js";
import { isDiagnosticsEnabled } from "../../infra/diagnostic-events.js";
import { emitInboundMessageEvent } from "../../infra/inbound-events.js";
import {
  logMessageProcessed,
  logMessageQueued,
  logSessionStateChange,
} from "../../logging/diagnostic.js";
import { getGlobalHookRunner } from "../../plugins/hook-runner-global.js";
import { resolveSendPolicy } from "../../sessions/send-policy.js";
import { maybeApplyTtsToPayload, normalizeTtsAutoMode, resolveTtsConfig } from "../../tts/tts.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../../utils/message-channel.js";
import { getReplyFromConfig } from "../reply.js";
import type { FinalizedMsgContext } from "../templating.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import { formatAbortReplyText, tryFastAbortFromMessage } from "./abort.js";
import { shouldBypassAcpDispatchForCommand, tryDispatchAcpReply } from "./dispatch-acp.js";
import { shouldSkipDuplicateInbound } from "./inbound-dedupe.js";
import type { ReplyDispatcher, ReplyDispatchKind } from "./reply-dispatcher.js";
import { shouldSuppressReasoningPayload } from "./reply-payloads.js";
import { isRoutableChannel, routeReply } from "./route-reply.js";
import { resolveRunTypingPolicy } from "./typing-policy.js";

const AUDIO_PLACEHOLDER_RE = /^<media:audio>(\s*\([^)]*\))?$/i;
const AUDIO_HEADER_RE = /^\[Audio\b/i;
const normalizeMediaType = (value: string): string => value.split(";")[0]?.trim().toLowerCase();

const isInboundAudioContext = (ctx: FinalizedMsgContext): boolean => {
  const rawTypes = [
    typeof ctx.MediaType === "string" ? ctx.MediaType : undefined,
    ...(Array.isArray(ctx.MediaTypes) ? ctx.MediaTypes : []),
  ].filter(Boolean) as string[];
  const types = rawTypes.map((type) => normalizeMediaType(type));
  if (types.some((type) => type === "audio" || type.startsWith("audio/"))) {
    return true;
  }

  const body =
    typeof ctx.BodyForCommands === "string"
      ? ctx.BodyForCommands
      : typeof ctx.CommandBody === "string"
        ? ctx.CommandBody
        : typeof ctx.RawBody === "string"
          ? ctx.RawBody
          : typeof ctx.Body === "string"
            ? ctx.Body
            : "";
  const trimmed = body.trim();
  if (!trimmed) {
    return false;
  }
  if (AUDIO_PLACEHOLDER_RE.test(trimmed)) {
    return true;
  }
  return AUDIO_HEADER_RE.test(trimmed);
};

const resolveSessionStoreEntry = (
  ctx: FinalizedMsgContext,
  cfg: OpenClawConfig,
): {
  sessionKey?: string;
  entry?: SessionEntry;
} => {
  const targetSessionKey =
    ctx.CommandSource === "native" ? ctx.CommandTargetSessionKey?.trim() : undefined;
  const sessionKey = (targetSessionKey ?? ctx.SessionKey)?.trim();
  if (!sessionKey) {
    return {};
  }
  const agentId = resolveSessionAgentId({ sessionKey, config: cfg });
  const storePath = resolveStorePath(cfg.session?.store, { agentId });
  try {
    const store = loadSessionStore(storePath);
    return {
      sessionKey,
      entry: store[sessionKey.toLowerCase()] ?? store[sessionKey],
    };
  } catch {
    return {
      sessionKey,
    };
  }
};

export type DispatchFromConfigResult = {
  queuedFinal: boolean;
  counts: Record<ReplyDispatchKind, number>;
};


/** Reformat upstream verbose tool narration into clean one-liner for messaging channels. */
function formatToolNarrationForChannel(raw: string): string {
  // Extract duration from ANYWHERE in the raw text before truncating to first line.
  let rawDuration = "";
  const rawDurMatch = raw.match(/\((\d+\.\d+s|\?)\)/);
  if (rawDurMatch) rawDuration = " " + rawDurMatch[0];

  // Extract actual command from second paragraph (after \n\n).
  let actualCmd = "";
  const paragraphs = raw.split("\n\n");
  if (paragraphs.length > 1) {
    const cmdMatch = paragraphs.slice(1).join(" ").match(/\`([^\`]+)\`/);
    if (cmdMatch) actualCmd = cmdMatch[1].trim();
  }

  const firstLine = raw.split("\n\n")[0].split("\n")[0].trim();
  let text = firstLine.replace(/^`+|`+$/g, "").trim();

  // Strip upstream emoji prefix and tool label (e.g. "🛠️ Exec: ...", "🧩 Memory Search: ...")
  const prefixMatch = text.match(/^[\p{Emoji}\p{Emoji_Presentation}\uFE0F\s]+(?:[A-Za-z_ ]+:?\s*)?/u);
  let toolType = "";
  if (prefixMatch) {
    // Try "Label:" first (e.g. "Exec:"), then bare "Label" (e.g. "Message")
    const typeMatch = prefixMatch[0].match(/([A-Za-z_ ]+):/) || prefixMatch[0].match(/\s([A-Za-z_]{2,})\s*$/);
    if (typeMatch) {
      toolType = typeMatch[1].trim().toLowerCase().replace(/\s+/g, "_");
    }
    text = text.slice(prefixMatch[0].length).trim();
  }

  // For exec: prefer actual command from raw when available.
  if ((toolType === "exec" || toolType === "bash") && actualCmd) {
    text = actualCmd
      .replace(/#[^\n]*/g, "")
      .replace(/-C\s+~?\/[^\s]+\s*/g, "")
      .replace(/2>&1/g, "")
      .replace(/\s*\(\d+\.\d+s\)/, "")
      .trim();
    // Take first meaningful command in chain (skip leading "cd ...")
    const chainParts = text.split(/\s*&&\s*|\s*;\s*/).filter(Boolean);
    if (chainParts.length > 1) {
      const meaningful = chainParts.find(p => !/^cd\s/.test(p.trim())) || chainParts[chainParts.length - 1];
      text = meaningful.trim();
    }
  }

  // Remove trailing "(in ~/...)" location hints.
  text = text.replace(/\s*\(in [^)]+\)\s*$/, "");

  // Shorten paths: ~/Projects/openclaw/src/web/foo.ts → foo.ts, ~/bob/TOOLS.md → TOOLS.md
  text = text.replace(
    /~\/[A-Za-z0-9_./-]+/g,
    (match) => {
      const parts = match.split("/");
      if (parts.length <= 2) return match;
      const last = parts[parts.length - 1];
      return last.includes(".") ? last : parts.slice(-2).join("/");
    },
  );

  // Shorten known verbose commands.
  text = text
    .replace(/launchctl list \S+/g, "launchctl list")
    .replace(/systemctl \S+ (\S+)\.service/g, "systemctl $1");

  // Collapse verbose exec chain verbs.
  text = text
    .replace(/\bprint text(?:\s*→\s*)?/g, "")
    .replace(/\brun\s+/g, "")
    .replace(/\bview\s+/gi, "")
    .replace(/\bdate(?:\s*→\s*)?/g, "")
    .replace(/\becho\s+\S+(?:\s*→\s*)?/g, "")
    .replace(/\bsleep\s+\S+(?:\s*→\s*)?/g, "")
    .replace(/\bshow last \d+ lines?/g, "")
    .replace(/\bshow first \d+ lines?/g, "")
    .replace(/->/g, "→")
    .replace(/→\s*→/g, "→")
    .replace(/→\s*(?:first \d+ lines?|last \d+ lines?)/gi, "")
    .replace(/^\s*→\s*/, "")
    .replace(/\s*→\s*$/, "")
    .replace(/\(\+\d+ steps?\)/g, "")
    .trim();

  // Pick emoji based on tool type and command content.
  let emoji = "🧩";
  if (toolType === "exec" || toolType === "bash") {
    if (/\blaunchctl|systemctl|restart|kill\b/.test(text)) emoji = "⚙️";
    else if (/\bgit\b/.test(text)) emoji = "📦";
    else if (/\bnpm|build|make\b/.test(text)) emoji = "🔨";
    else if (/\bgrep|search|find\b/.test(text)) emoji = "🔍";
    else if (/\bpython|node|bun\b/.test(text)) emoji = "🐍";
    else if (/\bcat|head|tail|sed|awk\b/.test(text)) emoji = "📄";
    else emoji = "🛠️";
  } else if (toolType === "read") emoji = "📂";
  else if (toolType === "write" || toolType === "edit") {
    emoji = "✏️";
    // Clean "in filename (N chars)" → "filename (N chars)"
    text = text.replace(/^in\s+/, "");
  }
  else if (toolType === "web_search" || toolType === "web_fetch") emoji = "🌐";
  else if (toolType === "memory_search" || toolType === "memory_get") {
    emoji = "🧠";
    if (!text.startsWith('"')) text = '"' + text + '"';
  }
  else if (toolType === "image") emoji = "🖼️";
  else if (toolType === "message") return "";
  else if (toolType === "process") emoji = "🧰";
  else if (toolType === "browser") emoji = "🌐";
  else if (toolType === "canvas") emoji = "🎨";
  else if (toolType === "nodes") emoji = "📱";
  else if (toolType === "cron") emoji = "⏰";
  else if (toolType === "gateway") emoji = "🔌";
  else if (toolType === "sessions_spawn") emoji = "🚀";
  else if (toolType === "subagents") emoji = "🤖";
  else if (toolType === "session_status") emoji = "📊";
  else if (toolType === "whatsapp_login") emoji = "🟢";
  else if (toolType === "sessions_list" || toolType === "sessions_history" || toolType === "sessions_send") emoji = "🗂️";
  else if (toolType === "agents_list") emoji = "🧭";
  else if (toolType === "tts") emoji = "🔊";
  else if (toolType === "apply_patch") emoji = "🩹";

  // Extract duration suffix (e.g. "(0.1s)") to reposition at end.
  let durationSuffix = "";
  const durMatch = text.match(/\s*\((\d+\.\d+s|\?)\)/);
  if (durMatch) {
    durationSuffix = " " + durMatch[0].trim();
    text = text.replace(durMatch[0], "").trim();
  } else if (rawDuration) {
    durationSuffix = rawDuration;
  }

  // Extract error/result info suffixes.
  let resultSuffix = "";
  const resMatch = text.match(/\s*(\[(?:qmd|local)\]\s*→\s*\d+ results?)\s*/i);
  if (resMatch) {
    resultSuffix = " " + resMatch[1].trim();
    text = text.replace(resMatch[0], "").trim();
  }
  const errMatch = text.match(/\s*❌\s*/);
  if (errMatch) {
    resultSuffix = " ❌" + resultSuffix;
    text = text.replace(errMatch[0], "").trim();
  }

  // Clean up Read tool: "first N lines of FILE" → "FILE (1-N)"
  if (toolType === "read") {
    const readMatch = text.match(/^first (\d+) lines of (.+)/i);
    if (readMatch) {
      text = readMatch[2] + " (1-" + readMatch[1] + ")";
    }
    const rangeMatch = text.match(/^lines? (\d+)[-–](\d+) of (.+)/i);
    if (rangeMatch) {
      text = rangeMatch[3] + " (" + rangeMatch[1] + "-" + rangeMatch[2] + ")";
    }
  }

  // For exec chains, take first meaningful command
  if ((toolType === "exec" || toolType === "bash") && /&&|;/.test(text)) {
    const first = text.split(/\s*&&\s*|\s*;\s*/)[0].trim();
    if (first.length > 5) text = first;
  }
  if (text.length > 80) text = text.slice(0, 77) + "...";

  // Append result info and duration at the end.
  const suffix = resultSuffix + durationSuffix;

  return text ? emoji + " " + text + suffix : firstLine.slice(0, 80);
}

export async function dispatchReplyFromConfig(params: {
  ctx: FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcher: ReplyDispatcher;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof getReplyFromConfig;
}): Promise<DispatchFromConfigResult> {
  const { ctx, cfg, dispatcher } = params;
  const diagnosticsEnabled = isDiagnosticsEnabled(cfg);
  const channel = String(ctx.Surface ?? ctx.Provider ?? "unknown").toLowerCase();
  const chatId = ctx.To ?? ctx.From;
  const messageId = ctx.MessageSid ?? ctx.MessageSidFirst ?? ctx.MessageSidLast;
  const sessionKey = ctx.SessionKey;
  const startTime = diagnosticsEnabled ? Date.now() : 0;
  const canTrackSession = diagnosticsEnabled && Boolean(sessionKey);

  const recordProcessed = (
    outcome: "completed" | "skipped" | "error",
    opts?: {
      reason?: string;
      error?: string;
    },
  ) => {
    if (!diagnosticsEnabled) {
      return;
    }
    logMessageProcessed({
      channel,
      chatId,
      messageId,
      sessionKey,
      durationMs: Date.now() - startTime,
      outcome,
      reason: opts?.reason,
      error: opts?.error,
    });
  };

  const markProcessing = () => {
    if (!canTrackSession || !sessionKey) {
      return;
    }
    logMessageQueued({ sessionKey, channel, source: "dispatch" });
    logSessionStateChange({
      sessionKey,
      state: "processing",
      reason: "message_start",
    });
  };

  const markIdle = (reason: string) => {
    if (!canTrackSession || !sessionKey) {
      return;
    }
    logSessionStateChange({
      sessionKey,
      state: "idle",
      reason,
    });
  };

  if (shouldSkipDuplicateInbound(ctx)) {
    recordProcessed("skipped", { reason: "duplicate" });
    return { queuedFinal: false, counts: dispatcher.getQueuedCounts() };
  }

  const sessionStoreEntry = resolveSessionStoreEntry(ctx, cfg);
  const inboundAudio = isInboundAudioContext(ctx);
  const sessionTtsAuto = normalizeTtsAutoMode(sessionStoreEntry.entry?.ttsAuto);
  const hookRunner = getGlobalHookRunner();

  // Extract message context for hooks (plugin and internal)
  const timestamp =
    typeof ctx.Timestamp === "number" && Number.isFinite(ctx.Timestamp) ? ctx.Timestamp : undefined;
  const messageIdForHook =
    ctx.MessageSidFull ?? ctx.MessageSid ?? ctx.MessageSidFirst ?? ctx.MessageSidLast;
  const content =
    typeof ctx.BodyForCommands === "string"
      ? ctx.BodyForCommands
      : typeof ctx.RawBody === "string"
        ? ctx.RawBody
        : typeof ctx.Body === "string"
          ? ctx.Body
          : "";
  const channelId = (ctx.OriginatingChannel ?? ctx.Surface ?? ctx.Provider ?? "").toLowerCase();
  const conversationId = ctx.OriginatingTo ?? ctx.To ?? ctx.From ?? undefined;

  // Emit inbound message event for WebSocket broadcast (Butley patch)
  emitInboundMessageEvent({
    messageId: messageIdForHook ?? "",
    sessionKey: ctx.SessionKey ?? "",
    channel: channelId,
    accountId: ctx.AccountId ?? "",
    from: ctx.From ?? "",
    senderName: ctx.SenderName ?? "",
    content,
    timestamp: timestamp ?? Date.now(),
    chatType: ctx.ChatType === "group" ? "group" : "dm",
    conversationId: conversationId != null ? String(conversationId) : "",
    threadId: ctx.MessageThreadId != null ? String(ctx.MessageThreadId) : undefined,
    hasMedia: !!ctx.MediaUrl,
    mediaType: ctx.MediaUrls?.[0] ? "media" : undefined,
  });

  // Trigger plugin hooks (fire-and-forget)
  if (hookRunner?.hasHooks("message_received")) {
    void hookRunner
      .runMessageReceived(
        {
          from: ctx.From ?? "",
          content,
          timestamp,
          metadata: {
            to: ctx.To,
            provider: ctx.Provider,
            surface: ctx.Surface,
            threadId: ctx.MessageThreadId,
            originatingChannel: ctx.OriginatingChannel,
            originatingTo: ctx.OriginatingTo,
            messageId: messageIdForHook,
            senderId: ctx.SenderId,
            senderName: ctx.SenderName,
            senderUsername: ctx.SenderUsername,
            senderE164: ctx.SenderE164,
            guildId: ctx.GroupSpace,
            channelName: ctx.GroupChannel,
          },
        },
        {
          channelId,
          accountId: ctx.AccountId,
          conversationId,
        },
      )
      .catch((err) => {
        logVerbose(`dispatch-from-config: message_received plugin hook failed: ${String(err)}`);
      });
  }

  // Bridge to internal hooks (HOOK.md discovery system) - refs #8807
  if (sessionKey) {
    void triggerInternalHook(
      createInternalHookEvent("message", "received", sessionKey, {
        from: ctx.From ?? "",
        content,
        timestamp,
        channelId,
        accountId: ctx.AccountId,
        conversationId,
        messageId: messageIdForHook,
        metadata: {
          to: ctx.To,
          provider: ctx.Provider,
          surface: ctx.Surface,
          threadId: ctx.MessageThreadId,
          senderId: ctx.SenderId,
          senderName: ctx.SenderName,
          senderUsername: ctx.SenderUsername,
          senderE164: ctx.SenderE164,
          guildId: ctx.GroupSpace,
          channelName: ctx.GroupChannel,
        },
      }),
    ).catch((err) => {
      logVerbose(`dispatch-from-config: message_received internal hook failed: ${String(err)}`);
    });
  }

  // Check if we should route replies to originating channel instead of dispatcher.
  // Only route when the originating channel is DIFFERENT from the current surface.
  // This handles cross-provider routing (e.g., message from Telegram being processed
  // by a shared session that's currently on Slack) while preserving normal dispatcher
  // flow when the provider handles its own messages.
  //
  // Debug: `pnpm test src/auto-reply/reply/dispatch-from-config.test.ts`
  const originatingChannel = ctx.OriginatingChannel;
  const originatingTo = ctx.OriginatingTo;
  const currentSurface = (ctx.Surface ?? ctx.Provider)?.toLowerCase();
  const shouldRouteToOriginating = Boolean(
    isRoutableChannel(originatingChannel) && originatingTo && originatingChannel !== currentSurface,
  );
  const shouldSuppressTyping =
    shouldRouteToOriginating || originatingChannel === INTERNAL_MESSAGE_CHANNEL;
  const ttsChannel = shouldRouteToOriginating ? originatingChannel : currentSurface;

  /**
   * Helper to send a payload via route-reply (async).
   * Only used when actually routing to a different provider.
   * Note: Only called when shouldRouteToOriginating is true, so
   * originatingChannel and originatingTo are guaranteed to be defined.
   */
  const sendPayloadAsync = async (
    payload: ReplyPayload,
    abortSignal?: AbortSignal,
    mirror?: boolean,
  ): Promise<void> => {
    // TypeScript doesn't narrow these from the shouldRouteToOriginating check,
    // but they're guaranteed non-null when this function is called.
    if (!originatingChannel || !originatingTo) {
      return;
    }
    if (abortSignal?.aborted) {
      return;
    }
    const result = await routeReply({
      payload,
      channel: originatingChannel,
      to: originatingTo,
      sessionKey: ctx.SessionKey,
      accountId: ctx.AccountId,
      threadId: ctx.MessageThreadId,
      cfg,
      abortSignal,
      mirror,
    });
    if (!result.ok) {
      logVerbose(`dispatch-from-config: route-reply failed: ${result.error ?? "unknown error"}`);
    }
  };

  markProcessing();

  try {
    const fastAbort = await tryFastAbortFromMessage({ ctx, cfg });
    if (fastAbort.handled) {
      const payload = {
        text: formatAbortReplyText(fastAbort.stoppedSubagents),
      } satisfies ReplyPayload;
      let queuedFinal = false;
      let routedFinalCount = 0;
      if (shouldRouteToOriginating && originatingChannel && originatingTo) {
        const result = await routeReply({
          payload,
          channel: originatingChannel,
          to: originatingTo,
          sessionKey: ctx.SessionKey,
          accountId: ctx.AccountId,
          threadId: ctx.MessageThreadId,
          cfg,
        });
        queuedFinal = result.ok;
        if (result.ok) {
          routedFinalCount += 1;
        }
        if (!result.ok) {
          logVerbose(
            `dispatch-from-config: route-reply (abort) failed: ${result.error ?? "unknown error"}`,
          );
        }
      } else {
        queuedFinal = dispatcher.sendFinalReply(payload);
      }
      const counts = dispatcher.getQueuedCounts();
      counts.final += routedFinalCount;
      recordProcessed("completed", { reason: "fast_abort" });
      markIdle("message_completed");
      return { queuedFinal, counts };
    }

    const bypassAcpForCommand = shouldBypassAcpDispatchForCommand(ctx, cfg);

    const sendPolicy = resolveSendPolicy({
      cfg,
      entry: sessionStoreEntry.entry,
      sessionKey: sessionStoreEntry.sessionKey ?? sessionKey,
      channel:
        sessionStoreEntry.entry?.channel ??
        ctx.OriginatingChannel ??
        ctx.Surface ??
        ctx.Provider ??
        undefined,
      chatType: sessionStoreEntry.entry?.chatType,
    });
    if (sendPolicy === "deny" && !bypassAcpForCommand) {
      logVerbose(
        `Send blocked by policy for session ${sessionStoreEntry.sessionKey ?? sessionKey ?? "unknown"}`,
      );
      const counts = dispatcher.getQueuedCounts();
      recordProcessed("completed", { reason: "send_policy_deny" });
      markIdle("message_completed");
      return { queuedFinal: false, counts };
    }

    const shouldSendToolSummaries = ctx.ChatType !== "group" && ctx.CommandSource !== "native";
    const acpDispatch = await tryDispatchAcpReply({
      ctx,
      cfg,
      dispatcher,
      sessionKey,
      inboundAudio,
      sessionTtsAuto,
      ttsChannel,
      shouldRouteToOriginating,
      originatingChannel,
      originatingTo,
      shouldSendToolSummaries,
      bypassForCommand: bypassAcpForCommand,
      recordProcessed,
      markIdle,
    });
    if (acpDispatch) {
      return acpDispatch;
    }

    // Track accumulated block text for TTS generation after streaming completes.
    // When block streaming succeeds, there's no final reply, so we need to generate
    // TTS audio separately from the accumulated block content.
    let accumulatedBlockText = "";
    let blockCount = 0;

    const resolveToolDeliveryPayload = (payload: ReplyPayload): ReplyPayload | null => {
      if (shouldSendToolSummaries) {
        return payload;
      }
      // Group/native flows intentionally suppress tool summary text, but media-only
      // tool results (for example TTS audio) must still be delivered.
      const hasMedia = Boolean(payload.mediaUrl) || (payload.mediaUrls?.length ?? 0) > 0;
      if (!hasMedia) {
        return null;
      }
      return { ...payload, text: undefined };
    };
    const typing = resolveRunTypingPolicy({
      requestedPolicy: params.replyOptions?.typingPolicy,
      suppressTyping: params.replyOptions?.suppressTyping === true || shouldSuppressTyping,
      originatingChannel,
      systemEvent: shouldRouteToOriginating,
    });

    const replyResult = await (params.replyResolver ?? getReplyFromConfig)(
      ctx,
      {
        ...params.replyOptions,
        typingPolicy: typing.typingPolicy,
        suppressTyping: typing.suppressTyping,
        onToolResult: (payload: ReplyPayload) => {
          const run = async () => {
            const ttsPayload = await maybeApplyTtsToPayload({
              payload,
              cfg,
              channel: ttsChannel,
              kind: "tool",
              inboundAudio,
              ttsAuto: sessionTtsAuto,
            });
            const deliveryPayload = resolveToolDeliveryPayload(ttsPayload);
            if (!deliveryPayload) {
              return;
            }
            // Format tool narration for messaging channels: clean one-liner with emoji.
            const formattedPayload = deliveryPayload.text
              ? { ...deliveryPayload, text: formatToolNarrationForChannel(deliveryPayload.text) }
              : deliveryPayload;
            if (shouldRouteToOriginating) {
              await sendPayloadAsync(formattedPayload, undefined, false);
            } else {
              dispatcher.sendToolResult(formattedPayload);
            }
          };
          return run();
        },
        onBlockReply: (payload: ReplyPayload, context) => {
          const run = async () => {
            // Suppress reasoning payloads — channels using this generic dispatch
            // path (WhatsApp, web, etc.) do not have a dedicated reasoning lane.
            // Telegram has its own dispatch path that handles reasoning splitting.
            if (shouldSuppressReasoningPayload(payload)) {
              return;
            }
            // Accumulate block text for TTS generation after streaming
            if (payload.text) {
              if (accumulatedBlockText.length > 0) {
                accumulatedBlockText += "\n";
              }
              accumulatedBlockText += payload.text;
              blockCount++;
            }
            const ttsPayload = await maybeApplyTtsToPayload({
              payload,
              cfg,
              channel: ttsChannel,
              kind: "block",
              inboundAudio,
              ttsAuto: sessionTtsAuto,
            });
            if (shouldRouteToOriginating) {
              await sendPayloadAsync(ttsPayload, context?.abortSignal, false);
            } else {
              dispatcher.sendBlockReply(ttsPayload);
            }
          };
          return run();
        },
      },
      cfg,
    );

    const replies = replyResult ? (Array.isArray(replyResult) ? replyResult : [replyResult]) : [];

    let queuedFinal = false;
    let routedFinalCount = 0;
    for (const reply of replies) {
      // Suppress reasoning payloads from channel delivery — channels using this
      // generic dispatch path do not have a dedicated reasoning lane.
      if (shouldSuppressReasoningPayload(reply)) {
        continue;
      }
      const ttsReply = await maybeApplyTtsToPayload({
        payload: reply,
        cfg,
        channel: ttsChannel,
        kind: "final",
        inboundAudio,
        ttsAuto: sessionTtsAuto,
      });
      if (shouldRouteToOriginating && originatingChannel && originatingTo) {
        // Route final reply to originating channel.
        const result = await routeReply({
          payload: ttsReply,
          channel: originatingChannel,
          to: originatingTo,
          sessionKey: ctx.SessionKey,
          accountId: ctx.AccountId,
          threadId: ctx.MessageThreadId,
          cfg,
        });
        if (!result.ok) {
          logVerbose(
            `dispatch-from-config: route-reply (final) failed: ${result.error ?? "unknown error"}`,
          );
        }
        queuedFinal = result.ok || queuedFinal;
        if (result.ok) {
          routedFinalCount += 1;
        }
      } else {
        queuedFinal = dispatcher.sendFinalReply(ttsReply) || queuedFinal;
      }
    }

    const ttsMode = resolveTtsConfig(cfg).mode ?? "final";
    // Generate TTS-only reply after block streaming completes (when there's no final reply).
    // This handles the case where block streaming succeeds and drops final payloads,
    // but we still want TTS audio to be generated from the accumulated block content.
    if (
      ttsMode === "final" &&
      replies.length === 0 &&
      blockCount > 0 &&
      accumulatedBlockText.trim()
    ) {
      try {
        const ttsSyntheticReply = await maybeApplyTtsToPayload({
          payload: { text: accumulatedBlockText },
          cfg,
          channel: ttsChannel,
          kind: "final",
          inboundAudio,
          ttsAuto: sessionTtsAuto,
        });
        // Only send if TTS was actually applied (mediaUrl exists)
        if (ttsSyntheticReply.mediaUrl) {
          // Send TTS-only payload (no text, just audio) so it doesn't duplicate the block content
          const ttsOnlyPayload: ReplyPayload = {
            mediaUrl: ttsSyntheticReply.mediaUrl,
            audioAsVoice: ttsSyntheticReply.audioAsVoice,
          };
          if (shouldRouteToOriginating && originatingChannel && originatingTo) {
            const result = await routeReply({
              payload: ttsOnlyPayload,
              channel: originatingChannel,
              to: originatingTo,
              sessionKey: ctx.SessionKey,
              accountId: ctx.AccountId,
              threadId: ctx.MessageThreadId,
              cfg,
            });
            queuedFinal = result.ok || queuedFinal;
            if (result.ok) {
              routedFinalCount += 1;
            }
            if (!result.ok) {
              logVerbose(
                `dispatch-from-config: route-reply (tts-only) failed: ${result.error ?? "unknown error"}`,
              );
            }
          } else {
            const didQueue = dispatcher.sendFinalReply(ttsOnlyPayload);
            queuedFinal = didQueue || queuedFinal;
          }
        }
      } catch (err) {
        logVerbose(
          `dispatch-from-config: accumulated block TTS failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const counts = dispatcher.getQueuedCounts();
    counts.final += routedFinalCount;
    recordProcessed("completed");
    markIdle("message_completed");
    return { queuedFinal, counts };
  } catch (err) {
    recordProcessed("error", { error: String(err) });
    markIdle("message_error");
    throw err;
  }
}
