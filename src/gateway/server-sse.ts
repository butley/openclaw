// [FORK-PATCH-18] SSE Streaming Endpoint — entire file is a fork addition (~460 lines). See patches/README.md #18.
/**
 * SSE stream endpoint for Butley webchat.
 *
 * Provides a receive-only SSE stream that converts gateway internal events
 * to the Vercel AI SDK Data Stream Protocol (v1).
 *
 * Message sending still happens via the existing WS `chat.send` RPC.
 * This endpoint only handles the streaming response side.
 *
 * Flow:
 * 1. Frontend sends message via WS `chat.send` → gets { runId }
 * 2. Frontend opens GET /api/sse/stream?runId=xxx&sessionKey=xxx
 * 3. This endpoint subscribes to gatewayEventBus for matching events
 * 4. Converts events to AI SDK format and streams to browser
 * 5. HTTP backpressure prevents drops (no more dropIfSlow issues)
 *
 * This is a fork patch (butley/openclaw) — additive only.
 * Zero impact on existing WS broadcast or channel delivery.
 *
 * Protocol reference: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { gatewayEventBus } from "./server-broadcast.js";
const log = createSubsystemLogger("gateway/sse");
const reasoningDebugEnabled = process.env.OPENCLAW_DEBUG_REASONING === "1";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChatEventPayload {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  message?: {
    role: string;
    content: Array<{ type: string; text?: string; thinking?: string }>;
    timestamp: number;
  };
  errorMessage?: string;
}

interface AgentEventPayload {
  runId: string;
  sessionKey?: string;
  stream: string;
  data?: Record<string, unknown>;
}

// ─── SSE Helpers ────────────────────────────────────────────────────────────

function tryFlush(res: ServerResponse): void {
  const r = res as ServerResponse & { flush?: () => void };
  if (typeof r.flush === "function") {
    r.flush();
  }
}

function sseWrite(res: ServerResponse, data: Record<string, unknown>): boolean {
  if (res.writableEnded || res.destroyed) {
    console.warn(`[sse] sseWrite skipped: writableEnded=${res.writableEnded} destroyed=${res.destroyed} type=${data.type}`);
    return false;
  }
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    tryFlush(res);
    return true;
  } catch (err) {
    console.warn(`[sse] sseWrite error: type=${data.type} err=${err}`);
    return false;
  }
}

function ssePing(res: ServerResponse): void {
  if (res.writableEnded) {
    return;
  }
  res.write(":ping\n\n");
  tryFlush(res);
}

function sseEnd(res: ServerResponse): void {
  if (res.writableEnded) {
    return;
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

// ─── AI SDK Data Stream Protocol Emitters ───────────────────────────────────

function emitTextStart(res: ServerResponse, counter: { n: number }): string {
  const id = `text_${++counter.n}`;
  sseWrite(res, { type: "text-start", id });
  return id;
}

function emitTextDelta(res: ServerResponse, id: string, delta: string): void {
  sseWrite(res, { type: "text-delta", id, delta });
}

function emitTextEnd(res: ServerResponse, id: string): void {
  sseWrite(res, { type: "text-end", id });
}

function emitReasoningStart(res: ServerResponse, counter: { n: number }): string {
  const id = `reasoning_${++counter.n}`;
  sseWrite(res, { type: "reasoning-start", id });
  return id;
}

function emitReasoningDelta(res: ServerResponse, id: string, delta: string): void {
  sseWrite(res, { type: "reasoning-delta", id, delta });
}

function emitReasoningEnd(res: ServerResponse, id: string): void {
  sseWrite(res, { type: "reasoning-end", id });
}

// ─── Request Handler ────────────────────────────────────────────────────────

/**
 * Handle GET /api/sse/stream?runId=xxx&sessionKey=xxx
 *
 * Opens an SSE stream that emits AI SDK Data Stream Protocol events
 * for the given runId. The client must have already sent the message
 * via WS `chat.send` and received the runId.
 *
 * Headers required:
 *   Accept: text/event-stream
 *
 * Query params:
 *   runId: string — the run ID from chat.send response
 *   sessionKey: string — the session key
 *
 * Returns: SSE stream in AI SDK Data Stream Protocol v1
 */
export function handleSseStream(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");

  // Only handle our specific path
  if (url.pathname !== "/api/sse/stream") {
    return false;
  }

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return true;
  }

  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed. Use GET." }));
    return true;
  }

  const runId = url.searchParams.get("runId");
  const sessionKey = url.searchParams.get("sessionKey");
  // Persistent mode: no runId = stream ALL events for this sessionKey
  const persistentMode = !runId;

  if (!sessionKey) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "sessionKey query param is required" }));
    return true;
  }

  // ── SSE headers ──
  // Note: Do NOT include `Connection: keep-alive` — it's a hop-by-hop header
  // forbidden in HTTP/2 (RFC 7540 §8.1.2.2). Browsers reject it with
  // ERR_HTTP2_PROTOCOL_ERROR when accessed through HTTP/2 reverse proxies (Tailscale, Cloudflare).
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    "x-vercel-ai-ui-message-stream": "v1",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });

  // Force headers to be sent immediately (critical for SSE through proxies)
  res.flushHeaders();

  // ── State ──
  let activeTextId: string | null = null;
  let activeReasoningId: string | null = null;
  let lastTextLen = 0;
  let lastReasoningLen = 0;
  let finished = false;
  // Per-connection counters (avoid sharing state across concurrent SSE streams)
  const textCounter = { n: 0 };
  const reasoningCounter = { n: 0 };
  // Tracks the active runId in persistent mode so we can emit "start" when a new run begins.
  // In non-persistent mode this stays null (run is known at connection time).
  let currentRunId: string | null = null;

  if (persistentMode) {
    // Persistent mode: connection open before any run exists.
    // Emit "connected" to signal the stream is ready — not "start" (which implies a run began).
    sseWrite(res, { type: "connected", sessionKey });
  } else {
    // Non-persistent mode: connection is for a specific known run — emit start immediately.
    sseWrite(res, { type: "start", messageId: runId });
  }

  // Keep-alive ping every 15s
  const pingInterval = setInterval(() => ssePing(res), 15_000);

  // Timeout safety: close after 5 minutes (per-run mode only)
  // Persistent mode stays open indefinitely (ping keeps alive)
  const timeout = persistentMode
    ? null
    : setTimeout(
        () => {
          if (!finished) {
            sseWrite(res, { type: "error", errorText: "Stream timeout (5 minutes)" });
            sseEnd(res);
            cleanup();
          }
        },
        5 * 60 * 1000,
      );

  // ── Cleanup ──
  const sseOpenedAt = Date.now();
  let sseEventCount = 0;

  function cleanup() {
    const durationSec = ((Date.now() - sseOpenedAt) / 1000).toFixed(1);
    console.warn(
      `[sse] connection closed: sessionKey=${sessionKey} duration=${durationSec}s events=${sseEventCount} runActive=${currentRunId !== null} lastTextLen=${lastTextLen}`,
    );
    finished = true;
    clearInterval(pingInterval);
    if (timeout) {
      clearTimeout(timeout);
    }
    gatewayEventBus.removeListener("chat", onChatEvent);
    gatewayEventBus.removeListener("agent", onAgentEvent);
    gatewayEventBus.removeListener("message.inbound", onInboundMessage);
  }

  // Close on client disconnect
  req.on("close", cleanup);

  // ── Helpers ──
  function closeActiveText() {
    if (activeTextId) {
      emitTextEnd(res, activeTextId);
      activeTextId = null;
    }
  }

  function closeActiveReasoning() {
    if (activeReasoningId) {
      emitReasoningEnd(res, activeReasoningId);
      activeReasoningId = null;
    }
  }

  /**
   * Called at the end of every run (final / error / aborted).
   * Persistent mode: reset per-run state so the connection is ready for the next run.
   * Non-persistent mode: close the SSE stream and clean up.
   */
  function handleRunEnd() {
    if (persistentMode) {
      activeTextId = null;
      activeReasoningId = null;
      lastTextLen = 0;
      lastReasoningLen = 0;
      currentRunId = null;
    } else {
      sseEnd(res);
      cleanup();
    }
  }

  // ── Event handlers ──
  function onChatEvent(payload: ChatEventPayload) {
    if (finished) {
      return;
    }
    sseEventCount++;
    const payloadSessionKey = (payload as Record<string, unknown>).sessionKey as string | undefined;
    // Exact session match for text deltas — only stream text from the session
    // the SSE subscriber is viewing. Prefix match (agent:main:*) leaks text
    // from other channels (e.g., Slack runs appearing in WA chat UI).
    if (payloadSessionKey !== sessionKey) {
      return;
    }

    if (payload.state === "delta") {
      // Persistent mode: detect new run and emit "start" with the real runId.
      // This is the correct point to signal "a message is beginning" — not at connection open.
      if (persistentMode && payload.runId && payload.runId !== currentRunId) {
        currentRunId = payload.runId;
        sseWrite(res, { type: "start", messageId: currentRunId });
      }

      // Extract text from content array
      const content = payload.message?.content;
      if (!content) {
        return;
      }

      for (const block of content) {
        if (block.type === "text" && block.text) {
          // Gateway sends FULL accumulated text in each delta.
          // Extract only the new portion.
          const fullText = block.text;
          if (fullText.length <= lastTextLen) {
            continue;
          }

          const newText = fullText.slice(lastTextLen);
          lastTextLen = fullText.length;

          // Close reasoning if text starts (thinking → text transition)
          closeActiveReasoning();

          if (!activeTextId) {
            activeTextId = emitTextStart(res, textCounter);
          }
          emitTextDelta(res, activeTextId, newText);
        }
      }
    } else if (payload.state === "final") {
      closeActiveText();
      closeActiveReasoning();
      sseWrite(res, { type: "finish-step" });
      sseWrite(res, { type: "finish" });
      handleRunEnd();
    } else if (payload.state === "error") {
      sseWrite(res, { type: "error", errorText: payload.errorMessage ?? "Unknown error" });
      handleRunEnd();
    } else if (payload.state === "aborted") {
      sseWrite(res, { type: "abort", reason: "aborted" });
      handleRunEnd();
    }
  }

  function onAgentEvent(payload: AgentEventPayload) {
    if (finished) {
      return;
    }
    const agentSessionKey = payload.sessionKey;
    // Exact session match — only stream tools/thinking from the session the
    // SSE subscriber is viewing. Prefix match leaked events from other channels
    // (e.g., Slack tool calls appearing in WA chat UI).
    if (agentSessionKey !== sessionKey) {
      return;
    }

    // Persistent mode: detect new run from agent events (thinking/tool can arrive
    // before the first chat delta). Emit "start" so the frontend gets the correct
    // run lifecycle signal before any content.
    if (persistentMode && payload.runId && payload.runId !== currentRunId) {
      currentRunId = payload.runId;
      sseWrite(res, { type: "start", messageId: currentRunId });
    }

    // ── Thinking / Reasoning ──
    if (payload.stream === "thinking") {
      // Prefer rawDelta/rawText (unformatted, no "Reasoning:" prefix or _italic_ wrapping).
      // Fall back to delta/text for backward compat with older gateway code.
      const delta =
        typeof payload.data?.rawDelta === "string"
          ? payload.data.rawDelta
          : typeof payload.data?.delta === "string"
            ? payload.data.delta
            : null;
      const fullText =
        typeof payload.data?.rawText === "string"
          ? payload.data.rawText
          : typeof payload.data?.text === "string"
            ? payload.data.text
            : null;

      // Use delta directly if available; otherwise extract from full text
      const newContent = delta
        ? delta
        : fullText && fullText.length > lastReasoningLen
          ? fullText.slice(lastReasoningLen)
          : null;
      if (reasoningDebugEnabled) {
        log.info(
          `[reasoning:sse] runId=${payload.runId} sessionKey=${agentSessionKey ?? "NONE"} fullLen=${fullText?.length ?? 0} deltaLen=${delta?.length ?? 0} emitLen=${newContent?.length ?? 0} active=${activeReasoningId ? "yes" : "no"} lastReasoningLen=${lastReasoningLen}`,
        );
      }

      if (newContent) {
        // Close any open text block before reasoning. Reset lastTextLen because
        // the provider resets its accumulated text between turns.
        closeActiveText();
        lastTextLen = 0;

        if (!activeReasoningId) {
          activeReasoningId = emitReasoningStart(res, reasoningCounter);
        }
        if (fullText) {
          lastReasoningLen = fullText.length;
        }
        emitReasoningDelta(res, activeReasoningId, newContent);
      }
    }

    // ── Tool events ──
    if (payload.stream === "tool") {
      const phase = payload.data?.phase as string | undefined;
      const toolName = (payload.data?.tool ?? payload.data?.name ?? "tool") as string;
      const toolCallId = (payload.data?.toolCallId ??
        payload.data?.id ??
        `tool_${Date.now()}`) as string;

      if (phase === "start") {
        closeActiveText();
        closeActiveReasoning();
        // Reset text/reasoning tracking — the provider resets its accumulated text
        // between tool call turns (lastStreamedAssistantCleaned = undefined), so
        // the gateway buffer starts fresh after each tool. Without this reset,
        // lastTextLen stays high from the previous turn and new text gets skipped.
        lastTextLen = 0;
        lastReasoningLen = 0;

        const args = payload.data?.args ?? payload.data?.input ?? {};
        sseWrite(res, { type: "tool-input-start", toolCallId, toolName });
        sseWrite(res, { type: "tool-input-available", toolCallId, toolName, input: args });
      } else if (phase === "result" || phase === "end") {
        const result = payload.data?.result ?? payload.data?.output ?? {};
        sseWrite(res, { type: "tool-output-available", toolCallId, output: result });
      }
    }
  }

  // ── Inbound user messages (cross-channel: WA/TG → chat UI) ──
  // Normalize session key variants: "whatsapp:direct:+N" and "whatsapp:dm:+N"
  // refer to the same main session but use different formats depending on context.
  const normalizeSessionKey = (key: string) =>
    key.replace(/:direct:/, ":dm:");

  const onInboundMessage = (payload: Record<string, unknown>) => {
    const evtSessionKey = typeof payload?.sessionKey === "string" ? payload.sessionKey : null;
    if (!evtSessionKey || normalizeSessionKey(evtSessionKey) !== normalizeSessionKey(sessionKey)) {
      return;
    }
    sseWrite(res, {
      type: "user-message",
      messageId: (payload.messageId as string) ?? null,
      content: (payload.content as string) ?? "",
      from: (payload.from as string) ?? "",
      senderName: (payload.senderName as string) ?? "",
      channel: (payload.channel as string) ?? "",
      timestamp: (payload.timestamp as number) ?? Date.now(),
    });
  };

  // ── Subscribe to event bus ──
  gatewayEventBus.on("chat", onChatEvent);
  gatewayEventBus.on("agent", onAgentEvent);
  gatewayEventBus.on("message.inbound", onInboundMessage);

  return true; // handled
}
