import fs from "node:fs";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@mariozechner/pi-coding-agent";
import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import { resolveThinkingDefault } from "../../agents/model-selection.js";
import { resolveAgentTimeoutMs } from "../../agents/timeout.js";
import { dispatchInboundMessage } from "../../auto-reply/dispatch.js";
import { createReplyDispatcher } from "../../auto-reply/reply/reply-dispatcher.js";
import { registerAgentRunContext } from "../../infra/agent-events.js";
import type { MsgContext } from "../../auto-reply/templating.js";
import { createReplyPrefixOptions } from "../../channels/reply-prefix.js";
import { resolveSessionFilePath } from "../../config/sessions.js";
import { saveMediaBuffer } from "../../media/store.js";
import { resolveSendPolicy } from "../../sessions/send-policy.js";
import {
  stripInlineDirectiveTagsForDisplay,
  stripInlineDirectiveTagsFromMessageForDisplay,
} from "../../utils/directive-tags.js";
// [FORK-PATCH-23] Chat.send Internal Routing — control UI messages go through full agent pipeline (not just WS echo). See patches/README.md #23.
import { INTERNAL_MESSAGE_CHANNEL } from "../../utils/message-channel.js";
import {
  abortChatRunById,
  abortChatRunsForSessionKey,
  type ChatAbortControllerEntry,
  type ChatAbortOps,
  isChatStopCommandText,
  resolveChatRunExpiresAtMs,
} from "../chat-abort.js";
import {
  extractAudioAttachments,
  type ChatImageContent,
  parseMessageWithAttachments,
} from "../chat-attachments.js";
import { stripEnvelopeFromMessage, stripEnvelopeFromMessages } from "../chat-sanitize.js";
import { GATEWAY_CLIENT_CAPS, hasGatewayClientCap } from "../protocol/client-info.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateChatAbortParams,
  validateChatHistoryParams,
  validateChatInjectParams,
  validateChatSendParams,
} from "../protocol/index.js";
import { getMaxChatHistoryMessagesBytes } from "../server-constants.js";
import {
  capArrayByJsonBytes,
  loadSessionEntry,
  readSessionMessages,
  resolveSessionModelRef,
} from "../session-utils.js";
import { formatForLog } from "../ws-log.js";
import { injectTimestamp, timestampOptsFromConfig } from "./agent-timestamp.js";
import { normalizeRpcAttachmentsToChatAttachments } from "./attachment-normalize.js";
import { appendInjectedAssistantMessageToTranscript } from "./chat-transcript-inject.js";
import type { GatewayRequestContext, GatewayRequestHandlers } from "./types.js";

type TranscriptAppendResult = {
  ok: boolean;
  messageId?: string;
  message?: Record<string, unknown>;
  error?: string;
};

type AbortOrigin = "rpc" | "stop-command";

type AbortedPartialSnapshot = {
  runId: string;
  sessionId: string;
  text: string;
  abortOrigin: AbortOrigin;
};

const CHAT_HISTORY_TEXT_MAX_CHARS = 12_000;
const CHAT_HISTORY_MAX_SINGLE_MESSAGE_BYTES = 128 * 1024;
const CHAT_HISTORY_OVERSIZED_PLACEHOLDER = "[chat.history omitted: message too large]";
let chatHistoryPlaceholderEmitCount = 0;

function stripDisallowedChatControlChars(message: string): string {
  let output = "";
  for (const char of message) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      output += char;
    }
  }
  return output;
}

export function sanitizeChatSendMessageInput(
  message: string,
): { ok: true; message: string } | { ok: false; error: string } {
  const normalized = message.normalize("NFC");
  if (normalized.includes("\u0000")) {
    return { ok: false, error: "message must not contain null bytes" };
  }
  return { ok: true, message: stripDisallowedChatControlChars(normalized) };
}

function truncateChatHistoryText(text: string): { text: string; truncated: boolean } {
  if (text.length <= CHAT_HISTORY_TEXT_MAX_CHARS) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, CHAT_HISTORY_TEXT_MAX_CHARS)}\n...(truncated)...`,
    truncated: true,
  };
}

function sanitizeChatHistoryContentBlock(block: unknown): { block: unknown; changed: boolean } {
  if (!block || typeof block !== "object") {
    return { block, changed: false };
  }
  const entry = { ...(block as Record<string, unknown>) };
  let changed = false;
  if (typeof entry.text === "string") {
    const stripped = stripInlineDirectiveTagsForDisplay(entry.text);
    const res = truncateChatHistoryText(stripped.text);
    entry.text = res.text;
    changed ||= stripped.changed || res.truncated;
  }
  if (typeof entry.partialJson === "string") {
    const res = truncateChatHistoryText(entry.partialJson);
    entry.partialJson = res.text;
    changed ||= res.truncated;
  }
  if (typeof entry.arguments === "string") {
    const res = truncateChatHistoryText(entry.arguments);
    entry.arguments = res.text;
    changed ||= res.truncated;
  }
  if (typeof entry.thinking === "string") {
    const res = truncateChatHistoryText(entry.thinking);
    entry.thinking = res.text;
    changed ||= res.truncated;
  }
  if ("thinkingSignature" in entry) {
    delete entry.thinkingSignature;
    changed = true;
  }
  const type = typeof entry.type === "string" ? entry.type : "";
  if (type === "image" && typeof entry.data === "string") {
    const bytes = Buffer.byteLength(entry.data, "utf8");
    delete entry.data;
    entry.omitted = true;
    entry.bytes = bytes;
    changed = true;
    // Preserve mediaUrl if present (saved to disk on inbound)
  }
  return { block: changed ? entry : block, changed };
}

function sanitizeChatHistoryMessage(message: unknown): { message: unknown; changed: boolean } {
  if (!message || typeof message !== "object") {
    return { message, changed: false };
  }
  const entry = { ...(message as Record<string, unknown>) };
  let changed = false;

  if ("details" in entry) {
    delete entry.details;
    changed = true;
  }
  if ("usage" in entry) {
    delete entry.usage;
    changed = true;
  }
  if ("cost" in entry) {
    delete entry.cost;
    changed = true;
  }

  if (typeof entry.content === "string") {
    const stripped = stripInlineDirectiveTagsForDisplay(entry.content);
    const res = truncateChatHistoryText(stripped.text);
    entry.content = res.text;
    changed ||= stripped.changed || res.truncated;
  } else if (Array.isArray(entry.content)) {
    const updated = entry.content.map((block) => sanitizeChatHistoryContentBlock(block));
    if (updated.some((item) => item.changed)) {
      entry.content = updated.map((item) => item.block);
      changed = true;
    }
  }

  if (typeof entry.text === "string") {
    const stripped = stripInlineDirectiveTagsForDisplay(entry.text);
    const res = truncateChatHistoryText(stripped.text);
    entry.text = res.text;
    changed ||= stripped.changed || res.truncated;
  }

  return { message: changed ? entry : message, changed };
}

function sanitizeChatHistoryMessages(messages: unknown[]): unknown[] {
  if (messages.length === 0) {
    return messages;
  }
  let changed = false;
  const next = messages.map((message) => {
    const res = sanitizeChatHistoryMessage(message);
    changed ||= res.changed;
    return res.message;
  });
  return changed ? next : messages;
}

function jsonUtf8Bytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Buffer.byteLength(String(value), "utf8");
  }
}

function buildOversizedHistoryPlaceholder(message?: unknown): Record<string, unknown> {
  const role =
    message &&
    typeof message === "object" &&
    typeof (message as { role?: unknown }).role === "string"
      ? (message as { role: string }).role
      : "assistant";
  const timestamp =
    message &&
    typeof message === "object" &&
    typeof (message as { timestamp?: unknown }).timestamp === "number"
      ? (message as { timestamp: number }).timestamp
      : Date.now();
  return {
    role,
    timestamp,
    content: [{ type: "text", text: CHAT_HISTORY_OVERSIZED_PLACEHOLDER }],
    __openclaw: { truncated: true, reason: "oversized" },
  };
}

function replaceOversizedChatHistoryMessages(params: {
  messages: unknown[];
  maxSingleMessageBytes: number;
}): { messages: unknown[]; replacedCount: number } {
  const { messages, maxSingleMessageBytes } = params;
  if (messages.length === 0) {
    return { messages, replacedCount: 0 };
  }
  let replacedCount = 0;
  const next = messages.map((message) => {
    if (jsonUtf8Bytes(message) <= maxSingleMessageBytes) {
      return message;
    }
    replacedCount += 1;
    return buildOversizedHistoryPlaceholder(message);
  });
  return { messages: replacedCount > 0 ? next : messages, replacedCount };
}

function enforceChatHistoryFinalBudget(params: { messages: unknown[]; maxBytes: number }): {
  messages: unknown[];
  placeholderCount: number;
} {
  const { messages, maxBytes } = params;
  if (messages.length === 0) {
    return { messages, placeholderCount: 0 };
  }
  if (jsonUtf8Bytes(messages) <= maxBytes) {
    return { messages, placeholderCount: 0 };
  }
  const last = messages.at(-1);
  if (last && jsonUtf8Bytes([last]) <= maxBytes) {
    return { messages: [last], placeholderCount: 0 };
  }
  const placeholder = buildOversizedHistoryPlaceholder(last);
  if (jsonUtf8Bytes([placeholder]) <= maxBytes) {
    return { messages: [placeholder], placeholderCount: 1 };
  }
  return { messages: [], placeholderCount: 0 };
}

function resolveTranscriptPath(params: {
  sessionId: string;
  storePath: string | undefined;
  sessionFile?: string;
  agentId?: string;
}): string | null {
  const { sessionId, storePath, sessionFile, agentId } = params;
  if (!storePath && !sessionFile) {
    return null;
  }
  try {
    const sessionsDir = storePath ? path.dirname(storePath) : undefined;
    return resolveSessionFilePath(
      sessionId,
      sessionFile ? { sessionFile } : undefined,
      sessionsDir || agentId ? { sessionsDir, agentId } : undefined,
    );
  } catch {
    return null;
  }
}

function ensureTranscriptFile(params: { transcriptPath: string; sessionId: string }): {
  ok: boolean;
  error?: string;
} {
  if (fs.existsSync(params.transcriptPath)) {
    return { ok: true };
  }
  try {
    fs.mkdirSync(path.dirname(params.transcriptPath), { recursive: true });
    const header = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: params.sessionId,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    };
    fs.writeFileSync(params.transcriptPath, `${JSON.stringify(header)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function transcriptHasIdempotencyKey(transcriptPath: string, idempotencyKey: string): boolean {
  try {
    const lines = fs.readFileSync(transcriptPath, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      const parsed = JSON.parse(line) as { message?: { idempotencyKey?: unknown } };
      if (parsed?.message?.idempotencyKey === idempotencyKey) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function appendAssistantTranscriptMessage(params: {
  message: string;
  label?: string;
  sessionId: string;
  storePath: string | undefined;
  sessionFile?: string;
  agentId?: string;
  createIfMissing?: boolean;
  idempotencyKey?: string;
  abortMeta?: {
    aborted: true;
    origin: AbortOrigin;
    runId: string;
  };
}): TranscriptAppendResult {
  const transcriptPath = resolveTranscriptPath({
    sessionId: params.sessionId,
    storePath: params.storePath,
    sessionFile: params.sessionFile,
    agentId: params.agentId,
  });
  if (!transcriptPath) {
    return { ok: false, error: "transcript path not resolved" };
  }

  if (!fs.existsSync(transcriptPath)) {
    if (!params.createIfMissing) {
      return { ok: false, error: "transcript file not found" };
    }
    const ensured = ensureTranscriptFile({
      transcriptPath,
      sessionId: params.sessionId,
    });
    if (!ensured.ok) {
      return { ok: false, error: ensured.error ?? "failed to create transcript file" };
    }
  }

  if (params.idempotencyKey && transcriptHasIdempotencyKey(transcriptPath, params.idempotencyKey)) {
    return { ok: true };
  }

  return appendInjectedAssistantMessageToTranscript({
    transcriptPath,
    message: params.message,
    label: params.label,
    idempotencyKey: params.idempotencyKey,
    abortMeta: params.abortMeta,
  });
}

function collectSessionAbortPartials(params: {
  chatAbortControllers: Map<string, ChatAbortControllerEntry>;
  chatRunBuffers: Map<string, string>;
  sessionKey: string;
  abortOrigin: AbortOrigin;
}): AbortedPartialSnapshot[] {
  const out: AbortedPartialSnapshot[] = [];
  for (const [runId, active] of params.chatAbortControllers) {
    if (active.sessionKey !== params.sessionKey) {
      continue;
    }
    const text = params.chatRunBuffers.get(runId);
    if (!text || !text.trim()) {
      continue;
    }
    out.push({
      runId,
      sessionId: active.sessionId,
      text,
      abortOrigin: params.abortOrigin,
    });
  }
  return out;
}

function persistAbortedPartials(params: {
  context: Pick<GatewayRequestContext, "logGateway">;
  sessionKey: string;
  snapshots: AbortedPartialSnapshot[];
}) {
  if (params.snapshots.length === 0) {
    return;
  }
  const { storePath, entry } = loadSessionEntry(params.sessionKey);
  for (const snapshot of params.snapshots) {
    const sessionId = entry?.sessionId ?? snapshot.sessionId ?? snapshot.runId;
    const appended = appendAssistantTranscriptMessage({
      message: snapshot.text,
      sessionId,
      storePath,
      sessionFile: entry?.sessionFile,
      createIfMissing: true,
      idempotencyKey: `${snapshot.runId}:assistant`,
      abortMeta: {
        aborted: true,
        origin: snapshot.abortOrigin,
        runId: snapshot.runId,
      },
    });
    if (!appended.ok) {
      params.context.logGateway.warn(
        `chat.abort transcript append failed: ${appended.error ?? "unknown error"}`,
      );
    }
  }
}

function createChatAbortOps(context: GatewayRequestContext): ChatAbortOps {
  return {
    chatAbortControllers: context.chatAbortControllers,
    chatRunBuffers: context.chatRunBuffers,
    chatDeltaSentAt: context.chatDeltaSentAt,
    chatAbortedRuns: context.chatAbortedRuns,
    removeChatRun: context.removeChatRun,
    agentRunSeq: context.agentRunSeq,
    broadcast: context.broadcast,
    nodeSendToSession: context.nodeSendToSession,
  };
}

function abortChatRunsForSessionKeyWithPartials(params: {
  context: GatewayRequestContext;
  ops: ChatAbortOps;
  sessionKey: string;
  abortOrigin: AbortOrigin;
  stopReason?: string;
}) {
  const snapshots = collectSessionAbortPartials({
    chatAbortControllers: params.context.chatAbortControllers,
    chatRunBuffers: params.context.chatRunBuffers,
    sessionKey: params.sessionKey,
    abortOrigin: params.abortOrigin,
  });
  const res = abortChatRunsForSessionKey(params.ops, {
    sessionKey: params.sessionKey,
    stopReason: params.stopReason,
  });
  if (res.aborted) {
    persistAbortedPartials({
      context: params.context,
      sessionKey: params.sessionKey,
      snapshots,
    });
  }
  return res;
}

function nextChatSeq(context: { agentRunSeq: Map<string, number> }, runId: string) {
  const next = (context.agentRunSeq.get(runId) ?? 0) + 1;
  context.agentRunSeq.set(runId, next);
  return next;
}

function broadcastChatFinal(params: {
  context: Pick<GatewayRequestContext, "broadcast" | "nodeSendToSession" | "agentRunSeq">;
  runId: string;
  sessionKey: string;
  message?: Record<string, unknown>;
}) {
  const seq = nextChatSeq({ agentRunSeq: params.context.agentRunSeq }, params.runId);
  const strippedEnvelopeMessage = stripEnvelopeFromMessage(params.message) as
    | Record<string, unknown>
    | undefined;
  const payload = {
    runId: params.runId,
    sessionKey: params.sessionKey,
    seq,
    state: "final" as const,
    message: stripInlineDirectiveTagsFromMessageForDisplay(strippedEnvelopeMessage),
  };
  params.context.broadcast("chat", payload);
  params.context.nodeSendToSession(params.sessionKey, "chat", payload);
  params.context.agentRunSeq.delete(params.runId);
}

function broadcastChatError(params: {
  context: Pick<GatewayRequestContext, "broadcast" | "nodeSendToSession" | "agentRunSeq">;
  runId: string;
  sessionKey: string;
  errorMessage?: string;
}) {
  const seq = nextChatSeq({ agentRunSeq: params.context.agentRunSeq }, params.runId);
  const payload = {
    runId: params.runId,
    sessionKey: params.sessionKey,
    seq,
    state: "error" as const,
    errorMessage: params.errorMessage,
  };
  params.context.broadcast("chat", payload);
  params.context.nodeSendToSession(params.sessionKey, "chat", payload);
  params.context.agentRunSeq.delete(params.runId);
}

export const chatHandlers: GatewayRequestHandlers = {
  "chat.history": async ({ params, respond, context }) => {
    if (!validateChatHistoryParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.history params: ${formatValidationErrors(validateChatHistoryParams.errors)}`,
        ),
      );
      return;
    }
    const { sessionKey, limit } = params as {
      sessionKey: string;
      limit?: number;
    };
    const { cfg, storePath, entry } = loadSessionEntry(sessionKey);
    const sessionId = entry?.sessionId;
    const rawMessages =
      sessionId && storePath ? readSessionMessages(sessionId, storePath, entry?.sessionFile) : [];
    const hardMax = 1000;
    const defaultLimit = 200;
    const requested = typeof limit === "number" ? limit : defaultLimit;
    const max = Math.min(hardMax, requested);
    const sliced = rawMessages.length > max ? rawMessages.slice(-max) : rawMessages;
    // Extract metadata from user messages BEFORE stripping (stripEnvelopeFromMessages
    // removes Sender/Conversation info blocks). We attach as top-level fields.
    const threadHistoryIndices = new Set<number>();
    // [FORK-PATCH-29] Chat Sender Meta — extracts sender name/id from inbound metadata before stripEnvelope removes it. See patches/README.md #29.
    const senderMetaByIndex = new Map<number, { name: string; id: string; isGroupChat: boolean }>();
    // [FORK-PATCH-30] Chat Group Context — extracts group chat history (who said what) before stripEnvelope removes it. See patches/README.md #30.
    const chatHistoryByIndex = new Map<number, Array<{ sender: string; timestamp_ms: number; body: string }>>();
    for (let i = 0; i < sliced.length; i++) {
      const msg = sliced[i] as Record<string, unknown>;
      if (msg.role !== "user") {continue;}
      const text =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? (msg.content as Array<Record<string, unknown>>)
                .filter((b) => b.type === "text" && typeof b.text === "string")
                .map((b) => b.text as string)
                .join("")
            : "";
      if (!text) {continue;}
      // Detect thread history context messages
      if (text.trimStart().startsWith("[Thread history - for context]")) {
        threadHistoryIndices.add(i);
      }
      // Extract "Chat history since last reply" (WA/Telegram group context messages)
      const chatHistMatch = text.match(
        /Chat history since last reply \(untrusted, for context\):\s*```json\s*(\[[\s\S]*?\])\s*```/,
      );
      if (chatHistMatch) {
        try {
          const entries = JSON.parse(chatHistMatch[1]) as Array<Record<string, unknown>>;
          const parsed = entries
            .filter((e) => typeof e.sender === "string" && typeof e.body === "string")
            .map((e) => ({
              sender: e.sender as string,
              timestamp_ms: typeof e.timestamp_ms === "number" ? e.timestamp_ms : 0,
              body: e.body as string,
            }));
          if (parsed.length > 0) {chatHistoryByIndex.set(i, parsed);}
        } catch { /* ignore parse errors */ }
      }
      const senderMatch = text.match(
        /Sender \(untrusted metadata\):\s*```json\s*(\{[\s\S]*?\})\s*```/,
      );
      if (!senderMatch) {continue;}
      try {
        const sender = JSON.parse(senderMatch[1]) as Record<string, unknown>;
        const name = typeof sender.name === "string" ? sender.name : "";
        const id = typeof sender.id === "string" ? sender.id : "";
        if (!name) {continue;}
        let isGroupChat = false;
        const convMatch = text.match(
          /Conversation info \(untrusted metadata\):\s*```json\s*(\{[\s\S]*?\})\s*```/,
        );
        if (convMatch) {
          try {
            const conv = JSON.parse(convMatch[1]) as Record<string, unknown>;
            isGroupChat = conv.is_group_chat === true;
          } catch { /* ignore */ }
        }
        senderMetaByIndex.set(i, { name, id, isGroupChat });
      } catch { /* ignore parse errors */ }
    }
    const sanitized = stripEnvelopeFromMessages(sliced);
    // Extract audioUrl mapping BEFORE sanitize (which deletes `details`).
    // Maps message index → audioUrl for the final assistant message after a TTS toolResult.
    // Skips intermediate assistant messages with stopReason="toolUse" (still in tool-call loop).
    // [FORK-PATCH-22] Chat Media Pipeline — extracts audioUrl/imageUrl from toolResult details before sanitize deletes them. See patches/README.md #22.
    const audioUrlByIndex = new Map<number, string>();
    {
      let pendingAudioUrl: string | undefined;
      for (let i = 0; i < sanitized.length; i++) {
        const msg = sanitized[i] as Record<string, unknown>;
        const role = msg.role as string | undefined;
        const details = msg.details as Record<string, unknown> | undefined;
        if (role === "toolResult" && details?.audioUrl) {
          // TTS tool completed — hold the audioUrl until final assistant message
          pendingAudioUrl = details.audioUrl as string;
        } else if (role === "assistant") {
          const stopReason = msg.stopReason as string | undefined;
          if (pendingAudioUrl && stopReason !== "toolUse") {
            // Final assistant message (stop/end-turn) — attach audioUrl here
            audioUrlByIndex.set(i, pendingAudioUrl);
            pendingAudioUrl = undefined;
          }
          // If stopReason=toolUse, keep pendingAudioUrl for the next assistant
        } else if (role === "user") {
          // User message resets state (new turn)
          pendingAudioUrl = undefined;
        }
      }
    }
    // Same pattern for imageUrl (image_generate tool result → final assistant message).
    const imageUrlByIndex = new Map<number, string>();
    {
      let pendingImageUrl: string | undefined;
      for (let i = 0; i < sanitized.length; i++) {
        const msg = sanitized[i] as Record<string, unknown>;
        const role = msg.role as string | undefined;
        const details = msg.details as Record<string, unknown> | undefined;
        if (role === "toolResult" && details?.imageUrl) {
          pendingImageUrl = details.imageUrl as string;
        } else if (role === "assistant") {
          const stopReason = msg.stopReason as string | undefined;
          if (pendingImageUrl && stopReason !== "toolUse") {
            imageUrlByIndex.set(i, pendingImageUrl);
            pendingImageUrl = undefined;
          }
        } else if (role === "user") {
          pendingImageUrl = undefined;
        }
      }
    }
    const normalized = sanitizeChatHistoryMessages(sanitized);
    // Apply sender metadata to user messages (extracted before strip).
    for (const [idx, meta] of senderMetaByIndex) {
      if (idx < normalized.length) {
        (normalized[idx] as Record<string, unknown>).senderMeta = meta;
      }
    }
    // Apply chat history context (WA/Telegram group messages between bot replies).
    for (const [idx, entries] of chatHistoryByIndex) {
      if (idx < normalized.length) {
        (normalized[idx] as Record<string, unknown>).chatHistory = entries;
      }
    }
    // Preserve raw content for thread history messages (frontend parses them into cards).
    for (const idx of threadHistoryIndices) {
      if (idx < normalized.length) {
        const raw = sliced[idx] as Record<string, unknown>;
        const rawText =
          typeof raw.content === "string"
            ? raw.content
            : Array.isArray(raw.content)
              ? (raw.content as Array<Record<string, unknown>>)
                  .filter((b) => b.type === "text" && typeof b.text === "string")
                  .map((b) => b.text as string)
                  .join("")
              : "";
        (normalized[idx] as Record<string, unknown>).threadHistoryRaw = rawText;
      }
    }
    // Apply audioUrl to the sanitized (normalized) messages.
    for (const [idx, url] of audioUrlByIndex) {
      if (idx < normalized.length) {
        (normalized[idx] as Record<string, unknown>).audioUrl = url;
      }
    }
    // Apply imageUrl to the sanitized (normalized) messages.
    for (const [idx, url] of imageUrlByIndex) {
      if (idx < normalized.length) {
        (normalized[idx] as Record<string, unknown>).imageUrl = url;
      }
    }
    const maxHistoryBytes = getMaxChatHistoryMessagesBytes();
    const perMessageHardCap = Math.min(CHAT_HISTORY_MAX_SINGLE_MESSAGE_BYTES, maxHistoryBytes);
    const replaced = replaceOversizedChatHistoryMessages({
      messages: normalized,
      maxSingleMessageBytes: perMessageHardCap,
    });
    const capped = capArrayByJsonBytes(replaced.messages, maxHistoryBytes).items;
    const bounded = enforceChatHistoryFinalBudget({ messages: capped, maxBytes: maxHistoryBytes });
    const placeholderCount = replaced.replacedCount + bounded.placeholderCount;
    if (placeholderCount > 0) {
      chatHistoryPlaceholderEmitCount += placeholderCount;
      context.logGateway.debug(
        `chat.history omitted oversized payloads placeholders=${placeholderCount} total=${chatHistoryPlaceholderEmitCount}`,
      );
    }
    let thinkingLevel = entry?.thinkingLevel;
    if (!thinkingLevel) {
      // [FORK-PATCH-26] ThinkingDefault Shortcut — falls back to agents.defaults.thinkingDefault when session has no level set. See patches/README.md #26.
      const configured = cfg.agents?.defaults?.thinkingDefault;
      if (configured) {
        thinkingLevel = configured;
      } else {
        const sessionAgentId = resolveSessionAgentId({ sessionKey, config: cfg });
        const { provider, model } = resolveSessionModelRef(cfg, entry, sessionAgentId);
        const catalog = await context.loadGatewayModelCatalog();
        thinkingLevel = resolveThinkingDefault({
          cfg,
          provider,
          model,
          catalog,
        });
      }
    }
    const verboseLevel = entry?.verboseLevel ?? cfg.agents?.defaults?.verboseDefault;
    respond(true, {
      sessionKey,
      sessionId,
      messages: bounded.messages,
      thinkingLevel,
      verboseLevel,
    });
  },
  "chat.abort": ({ params, respond, context }) => {
    if (!validateChatAbortParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.abort params: ${formatValidationErrors(validateChatAbortParams.errors)}`,
        ),
      );
      return;
    }
    const { sessionKey: rawSessionKey, runId } = params as {
      sessionKey: string;
      runId?: string;
    };

    const ops = createChatAbortOps(context);

    if (!runId) {
      const res = abortChatRunsForSessionKeyWithPartials({
        context,
        ops,
        sessionKey: rawSessionKey,
        abortOrigin: "rpc",
        stopReason: "rpc",
      });
      respond(true, { ok: true, aborted: res.aborted, runIds: res.runIds });
      return;
    }

    const active = context.chatAbortControllers.get(runId);
    if (!active) {
      respond(true, { ok: true, aborted: false, runIds: [] });
      return;
    }
    if (active.sessionKey !== rawSessionKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "runId does not match sessionKey"),
      );
      return;
    }

    const partialText = context.chatRunBuffers.get(runId);
    const res = abortChatRunById(ops, {
      runId,
      sessionKey: rawSessionKey,
      stopReason: "rpc",
    });
    if (res.aborted && partialText && partialText.trim()) {
      persistAbortedPartials({
        context,
        sessionKey: rawSessionKey,
        snapshots: [
          {
            runId,
            sessionId: active.sessionId,
            text: partialText,
            abortOrigin: "rpc",
          },
        ],
      });
    }
    respond(true, {
      ok: true,
      aborted: res.aborted,
      runIds: res.aborted ? [runId] : [],
    });
  },
  "chat.send": async ({ params, respond, context, client }) => {
    if (!validateChatSendParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.send params: ${formatValidationErrors(validateChatSendParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      sessionKey: string;
      message: string;
      thinking?: string;
      deliver?: boolean;
      attachments?: Array<{
        type?: string;
        mimeType?: string;
        fileName?: string;
        content?: unknown;
      }>;
      timeoutMs?: number;
      idempotencyKey: string;
      mirror?: boolean;
    };
    const sanitizedMessageResult = sanitizeChatSendMessageInput(p.message);
    if (!sanitizedMessageResult.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, sanitizedMessageResult.error),
      );
      return;
    }
    const inboundMessage = sanitizedMessageResult.message;
    const stopCommand = isChatStopCommandText(inboundMessage);
    const normalizedAttachments = normalizeRpcAttachmentsToChatAttachments(p.attachments);
    const rawMessage = inboundMessage.trim();
    if (!rawMessage && normalizedAttachments.length === 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "message or attachment required"),
      );
      return;
    }
    let parsedMessage = inboundMessage;
    let parsedImages: ChatImageContent[] = [];
    let parsedAudioPaths: string[] = [];
    let parsedImageMediaUrls: string[] = [];
    if (normalizedAttachments.length > 0) {
      try {
        const parsed = await parseMessageWithAttachments(inboundMessage, normalizedAttachments, {
          maxBytes: 5_000_000,
          log: context.logGateway,
        });
        parsedMessage = parsed.message;
        parsedImages = parsed.images;
        context.logGateway?.info?.(`[chat.send] attachments=${normalizedAttachments.length} images=${parsedImages.length}`);

        // Save images to disk so they can be served via /media endpoint
        for (const img of parsedImages) {
          try {
            const buffer = Buffer.from(img.data, "base64");
            const saved = await saveMediaBuffer(buffer, img.mimeType, "inbound", 5_000_000);
            const mediaUrl = `/media/${saved.id}`;
            parsedImageMediaUrls.push(mediaUrl);
            // Tag image with saved URL — survives base64 stripping in chat.history
            img.mediaUrl = mediaUrl;
          } catch (imgErr) {
            context.logGateway?.warn?.(`[chat.send] Failed to save inbound image: ${imgErr}`);
          }
        }

        const audio = await extractAudioAttachments(normalizedAttachments, {
          maxBytes: 20_000_000,
          log: context.logGateway,
        });
        for (const item of audio) {
          const buffer = Buffer.from(item.data, "base64");
          const saved = await saveMediaBuffer(buffer, item.mimeType, "inbound", 20_000_000, item.fileName);
          parsedAudioPaths.push(saved.path);
        }
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
        return;
      }
    }
    const rawSessionKey = p.sessionKey;
    const { cfg, entry, canonicalKey: sessionKey } = loadSessionEntry(rawSessionKey);

    // Transcribe audio attachments via tools.media.audio pipeline (e.g. ElevenLabs Scribe)
    // and replace the body with the transcript so the agent receives text, not a file path.
    if (parsedAudioPaths.length > 0 && !parsedMessage) {
      try {
        const { transcribeFirstAudio } = await import("../../media-understanding/audio-preflight.js");
        const audioCtx = {
          MediaPath: parsedAudioPaths[0],
          MediaPaths: parsedAudioPaths,
          MediaUrl: parsedAudioPaths[0],
          MediaUrls: parsedAudioPaths,
          MediaTypes: ["audio/webm"],
        };
        const transcript = await transcribeFirstAudio({ ctx: audioCtx, cfg });
        if (transcript) {
          parsedMessage = transcript;
        }
      } catch (err) {
        context.logGateway.warn(`chat.send: audio transcription failed: ${String(err)}`);
      }
    }

    const timeoutMs = resolveAgentTimeoutMs({
      cfg,
      overrideMs: p.timeoutMs,
    });
    const now = Date.now();
    const clientRunId = p.idempotencyKey;
    // [FORK-PATCH-4] Chat Mirror — without this, replies from chat UI on WA sessions
    // never reach WhatsApp. The agent event handler (server-chat.ts:420) checks
    // runContext.mirror to decide whether to call sendMessageWhatsApp(). If this
    // registration is missing, mirror is always undefined and WA delivery is skipped.
    // Lost during upstream merge — restored from commit aea535abf (Feb 3).
    registerAgentRunContext(clientRunId, { sessionKey, mirror: p.mirror });

    const sendPolicy = resolveSendPolicy({
      cfg,
      entry,
      sessionKey,
      channel: entry?.channel,
      chatType: entry?.chatType,
    });
    if (sendPolicy === "deny") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "send blocked by session policy"),
      );
      return;
    }

    if (stopCommand) {
      const res = abortChatRunsForSessionKeyWithPartials({
        context,
        ops: createChatAbortOps(context),
        sessionKey: rawSessionKey,
        abortOrigin: "stop-command",
        stopReason: "stop",
      });
      respond(true, { ok: true, aborted: res.aborted, runIds: res.runIds });
      return;
    }

    const cached = context.dedupe.get(`chat:${clientRunId}`);
    if (cached) {
      respond(cached.ok, cached.payload, cached.error, {
        cached: true,
      });
      return;
    }

    const activeExisting = context.chatAbortControllers.get(clientRunId);
    if (activeExisting) {
      respond(true, { runId: clientRunId, status: "in_flight" as const }, undefined, {
        cached: true,
        runId: clientRunId,
      });
      return;
    }

    try {
      const abortController = new AbortController();
      context.chatAbortControllers.set(clientRunId, {
        controller: abortController,
        sessionId: entry?.sessionId ?? clientRunId,
        sessionKey: rawSessionKey,
        startedAtMs: now,
        expiresAtMs: resolveChatRunExpiresAtMs({ now, timeoutMs }),
      });
      const ackPayload = {
        runId: clientRunId,
        status: "started" as const,
      };
      respond(true, ackPayload, undefined, { runId: clientRunId });

      const trimmedMessage = parsedMessage.trim();
      const injectThinking = Boolean(
        p.thinking && trimmedMessage && !trimmedMessage.startsWith("/"),
      );
      const commandBody = injectThinking ? `/think ${p.thinking} ${parsedMessage}` : parsedMessage;
      const clientInfo = client?.connect?.client;
      // Inject timestamp so agents know the current date/time.
      // Only BodyForAgent gets the timestamp — Body stays raw for UI display.
      // See: https://github.com/moltbot/moltbot/issues/3658
      const stampedMessage = injectTimestamp(parsedMessage, timestampOptsFromConfig(cfg));

      const ctx: MsgContext = {
        Body: parsedMessage,
        BodyForAgent: stampedMessage,
        BodyForCommands: commandBody,
        RawBody: parsedMessage,
        CommandBody: commandBody,
        SessionKey: sessionKey,
        Provider: INTERNAL_MESSAGE_CHANNEL,
        Surface: INTERNAL_MESSAGE_CHANNEL,
        OriginatingChannel: INTERNAL_MESSAGE_CHANNEL,
        ChatType: "direct",
        CommandAuthorized: true,
        MessageSid: clientRunId,
        SenderId: clientInfo?.id,
        SenderName: clientInfo?.displayName,
        SenderUsername: clientInfo?.displayName,
        GatewayClientScopes: client?.connect?.scopes,
        MediaPath: parsedAudioPaths[0],
        MediaUrl: parsedAudioPaths[0],
        MediaPaths: parsedAudioPaths.length > 0 ? parsedAudioPaths : undefined,
        MediaUrls: parsedAudioPaths.length > 0 ? parsedAudioPaths : undefined,
      };

      const agentId = resolveSessionAgentId({
        sessionKey,
        config: cfg,
      });
      const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
        cfg,
        agentId,
        channel: INTERNAL_MESSAGE_CHANNEL,
      });
      const finalReplyParts: string[] = [];
      const collectedMediaUrls: string[] = [];
      const dispatcher = createReplyDispatcher({
        ...prefixOptions,
        onError: (err) => {
          context.logGateway.warn(`webchat dispatch failed: ${formatForLog(err)}`);
        },
        deliver: async (payload, info) => {
          // Log every deliver call so we can see which kinds arrive
          context.logGateway.info(
            `[media-deliver] kind=${info.kind} hasMediaUrls=${Array.isArray(payload.mediaUrls)} mediaUrl=${payload.mediaUrl} text=${(payload.text ?? "").slice(0, 80)}`,
          );
          // Capture media hints from every payload BEFORE any early-return.
          captureMediaFromPayload(payload);
          const payloadText = payload.text?.trim() ?? "";

          // Only accumulate final text for the chat response
          if (info.kind !== "final") {
            return;
          }
          if (!payloadText) {
            return;
          }
          finalReplyParts.push(payloadText);
        },
      });

      let agentRunStarted = false;
      const captureMediaFromPayload = (payload: {
        text?: string;
        mediaUrl?: string;
        mediaUrls?: string[];
      }) => {
        if (Array.isArray(payload.mediaUrls)) {
          for (const url of payload.mediaUrls) {
            if (url && !collectedMediaUrls.includes(url)) {
              collectedMediaUrls.push(url);
            }
          }
        }
        if (payload.mediaUrl && !collectedMediaUrls.includes(payload.mediaUrl)) {
          collectedMediaUrls.push(payload.mediaUrl);
        }
        const text = payload.text?.trim() ?? "";
        if (!text) {
          return;
        }
        const mediaMatches = text.match(/MEDIA:\/[^\s`]+/g) ?? [];
        for (const marker of mediaMatches) {
          const mediaPath = marker.slice("MEDIA:".length).trim();
          if (mediaPath && !collectedMediaUrls.includes(mediaPath)) {
            collectedMediaUrls.push(mediaPath);
          }
        }
      };

      void dispatchInboundMessage({
        ctx,
        cfg,
        dispatcher,
        replyOptions: {
          runId: clientRunId,
          abortSignal: abortController.signal,
          images: parsedImages.length > 0 ? parsedImages : undefined,
          onAgentRunStart: (runId) => {
            agentRunStarted = true;
            const connId = typeof client?.connId === "string" ? client.connId : undefined;
            const wantsToolEvents = hasGatewayClientCap(
              client?.connect?.caps,
              GATEWAY_CLIENT_CAPS.TOOL_EVENTS,
            );
            if (connId && wantsToolEvents) {
              context.registerToolEventRecipient(runId, connId);
              // Register for any other active runs *in the same session* so
              // late-joining clients (e.g. page refresh mid-response) receive
              // in-progress tool events without leaking cross-session data.
              for (const [activeRunId, active] of context.chatAbortControllers) {
                if (activeRunId !== runId && active.sessionKey === p.sessionKey) {
                  context.registerToolEventRecipient(activeRunId, connId);
                }
              }
            }
          },
          onModelSelected,
        },
      })
        .then(() => {
          if (!agentRunStarted) {
            const combinedReply = finalReplyParts
              .map((part) => part.trim())
              .filter(Boolean)
              .join("\n\n")
              .trim();
            let message: Record<string, unknown> | undefined;
            if (combinedReply) {
              const { storePath: latestStorePath, entry: latestEntry } =
                loadSessionEntry(sessionKey);
              const sessionId = latestEntry?.sessionId ?? entry?.sessionId ?? clientRunId;
              const appended = appendAssistantTranscriptMessage({
                message: combinedReply,
                sessionId,
                storePath: latestStorePath,
                sessionFile: latestEntry?.sessionFile,
                agentId,
                createIfMissing: true,
              });
              if (appended.ok) {
                message = appended.message;
              } else {
                context.logGateway.warn(
                  `webchat transcript append failed: ${appended.error ?? "unknown error"}`,
                );
                const now = Date.now();
                message = {
                  role: "assistant",
                  content: [{ type: "text", text: combinedReply }],
                  timestamp: now,
                  // Keep this compatible with Pi stopReason enums even though this message isn't
                  // persisted to the transcript due to the append failure.
                  stopReason: "stop",
                  usage: { input: 0, output: 0, totalTokens: 0 },
                };
              }
            }
            // If TTS audio was generated, extract the filename for the /media/ endpoint
            // and attach it to the broadcast so the frontend can play it without regeneration.
            const mediaUrls = collectedMediaUrls.map((u) => {
              const parts = u.split("/");
              return `/media/${parts[parts.length - 1]}`;
            });
            const audioUrls = mediaUrls.filter((u) => /\.(mp3|opus|ogg|wav|webm)$/i.test(u));
            const imageUrls = mediaUrls.filter((u) => /\.(png|jpe?g|gif|webp)$/i.test(u));
            if (message) {
              if (audioUrls.length > 0) {
                (message).audioUrl = audioUrls[0];
              }
              if (imageUrls.length > 0) {
                (message).imageUrl = imageUrls[0];
              }
            }
            broadcastChatFinal({
              context,
              runId: clientRunId,
              sessionKey: rawSessionKey,
              message,
            });
            // Mirror to original channel if requested
            if (p.mirror && combinedReply) {
              try {
                const keyParts = p.sessionKey.split(":").filter(Boolean);
                // Format: agent:{agentId}:{channel}:{peerKind}:{peerId}
                if (keyParts.length >= 5 && keyParts[0] === "agent") {
                  const channel = keyParts[2];
                  const peerId = keyParts.slice(4).join(":");
                  if (channel === "whatsapp" && peerId) {
                    void import("../../web/outbound.js").then(({ sendMessageWhatsApp }) => {
                      sendMessageWhatsApp(peerId, combinedReply, { verbose: false })
                        .then(() =>
                          context.logGateway.info(`[mirror] sent to ${channel}:${peerId}`),
                        )
                        .catch((err) => context.logGateway.warn(`[mirror] failed: ${String(err)}`));
                    });
                  }
                }
              } catch (mirrorErr) {
                context.logGateway.warn(`[mirror] error: ${String(mirrorErr)}`);
              }
            }
          } else if (collectedMediaUrls.length > 0) {
            context.logGateway.info(
              `[media-emit] agentRunStarted=true, collectedMediaUrls=${JSON.stringify(collectedMediaUrls)}`,
            );
            // Agent run handled its own broadcast. Emit structured media hints so
            // the frontend can classify/render message cards without parsing paths.
            const mediaUrls = collectedMediaUrls.map((u) => {
              const parts = u.split("/");
              return `/media/${parts[parts.length - 1]}`;
            });
            const audioUrls = mediaUrls.filter((u) => /\.(mp3|opus|ogg|wav|webm)$/i.test(u));
            const imageUrls = mediaUrls.filter((u) => /\.(png|jpe?g|gif|webp)$/i.test(u));
            context.logGateway.info(
              `[media-emit] audioUrls=${JSON.stringify(audioUrls)} imageUrls=${JSON.stringify(imageUrls)}`,
            );

            if (audioUrls.length > 0) {
              const seq = nextChatSeq(
                { agentRunSeq: context.agentRunSeq },
                clientRunId,
              );
              context.broadcast("chat", {
                runId: clientRunId,
                sessionKey: rawSessionKey,
                seq,
                state: "audioReady" as const,
                audioUrl: audioUrls[0],
              });
            }

            if (imageUrls.length > 0) {
              const seq = nextChatSeq(
                { agentRunSeq: context.agentRunSeq },
                clientRunId,
              );
              context.broadcast("chat", {
                runId: clientRunId,
                sessionKey: rawSessionKey,
                seq,
                state: "imageReady" as const,
                imageUrl: imageUrls[0],
              });
            }
          } else if (agentRunStarted) {
            // Fallback: ACP dispatch path doesn't forward MEDIA markers through
            // the deliver callback (tool results are formatted as summaries).
            // Scan the session transcript for tool results with imageUrl in details.
            try {
              const { storePath: postRunStorePath, entry: postRunEntry } =
                loadSessionEntry(sessionKey);
              const postRunSessionId = postRunEntry?.sessionId ?? entry?.sessionId;
              if (postRunSessionId && postRunStorePath) {
                const recentMsgs = readSessionMessages(
                  postRunSessionId,
                  postRunStorePath,
                  postRunEntry?.sessionFile,
                );
                // Look for the last toolResult with details.imageUrl
                for (let i = recentMsgs.length - 1; i >= 0; i--) {
                  const msg = recentMsgs[i] as Record<string, unknown>;
                  if (msg.role !== "toolResult") {continue;}
                  const details = msg.details as Record<string, unknown> | undefined;
                  if (details?.imageUrl) {
                    const imageUrl = details.imageUrl as string;
                    context.logGateway.info(
                      `[media-emit] extracted imageUrl from session transcript: ${imageUrl}`,
                    );
                    const seq = nextChatSeq(
                      { agentRunSeq: context.agentRunSeq },
                      clientRunId,
                    );
                    context.broadcast("chat", {
                      runId: clientRunId,
                      sessionKey: rawSessionKey,
                      seq,
                      state: "imageReady" as const,
                      imageUrl,
                    });
                    break;
                  }
                }
              }
            } catch (scanErr) {
              context.logGateway.warn(
                `[media-emit] session transcript scan failed: ${String(scanErr)}`,
              );
            }
          }
          context.dedupe.set(`chat:${clientRunId}`, {
            ts: Date.now(),
            ok: true,
            payload: { runId: clientRunId, status: "ok" as const },
          });
        })
        .catch((err) => {
          const error = errorShape(ErrorCodes.UNAVAILABLE, String(err));
          context.dedupe.set(`chat:${clientRunId}`, {
            ts: Date.now(),
            ok: false,
            payload: {
              runId: clientRunId,
              status: "error" as const,
              summary: String(err),
            },
            error,
          });
          broadcastChatError({
            context,
            runId: clientRunId,
            sessionKey: rawSessionKey,
            errorMessage: String(err),
          });
        })
        .finally(() => {
          context.chatAbortControllers.delete(clientRunId);
        });
    } catch (err) {
      const error = errorShape(ErrorCodes.UNAVAILABLE, String(err));
      const payload = {
        runId: clientRunId,
        status: "error" as const,
        summary: String(err),
      };
      context.dedupe.set(`chat:${clientRunId}`, {
        ts: Date.now(),
        ok: false,
        payload,
        error,
      });
      respond(false, payload, error, {
        runId: clientRunId,
        error: formatForLog(err),
      });
    }
  },
  "chat.inject": async ({ params, respond, context }) => {
    if (!validateChatInjectParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.inject params: ${formatValidationErrors(validateChatInjectParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      sessionKey: string;
      message: string;
      label?: string;
    };

    // Load session to find transcript file
    const rawSessionKey = p.sessionKey;
    const { cfg, storePath, entry } = loadSessionEntry(rawSessionKey);
    const sessionId = entry?.sessionId;
    if (!sessionId || !storePath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "session not found"));
      return;
    }

    const appended = appendAssistantTranscriptMessage({
      message: p.message,
      label: p.label,
      sessionId,
      storePath,
      sessionFile: entry?.sessionFile,
      agentId: resolveSessionAgentId({ sessionKey: rawSessionKey, config: cfg }),
      createIfMissing: false,
    });
    if (!appended.ok || !appended.messageId || !appended.message) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to write transcript: ${appended.error ?? "unknown error"}`,
        ),
      );
      return;
    }

    // Broadcast to webchat for immediate UI update
    const chatPayload = {
      runId: `inject-${appended.messageId}`,
      sessionKey: rawSessionKey,
      seq: 0,
      state: "final" as const,
      message: stripInlineDirectiveTagsFromMessageForDisplay(
        stripEnvelopeFromMessage(appended.message) as Record<string, unknown>,
      ),
    };
    context.broadcast("chat", chatPayload);
    context.nodeSendToSession(rawSessionKey, "chat", chatPayload);

    respond(true, { ok: true, messageId: appended.messageId });
  },
};
