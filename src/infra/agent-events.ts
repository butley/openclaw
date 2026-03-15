import type { VerboseLevel } from "../auto-reply/thinking.js";

export type AgentEventStream = "lifecycle" | "tool" | "assistant" | "error" | (string & {});

export type AgentEventPayload = {
  runId: string;
  seq: number;
  stream: AgentEventStream;
  ts: number;
  data: Record<string, unknown>;
  sessionKey?: string;
};

export type AgentRunContext = {
  sessionKey?: string;
  verboseLevel?: VerboseLevel;
  isHeartbeat?: boolean;
  mirror?: boolean;
  /** Whether control UI clients should receive chat/agent updates for this run. */
  isControlUiVisible?: boolean;
};

// Keep per-run counters so streams stay strictly monotonic per runId.
// [FORK-PATCH-5] globalThis singletons — survive bundler chunk duplication.
// Same pattern as Patch #31 (SSE EventBus). Without this, emitAgentEvent() in one chunk
// emits to a different listeners Set than onAgentEvent() registered in another chunk,
// causing tool events, thinking, and chat deltas to silently vanish.
const AGENT_EVENTS_KEY = "__openclaw_agentEvents__";
type AgentEventsState = {
  seqByRun: Map<string, number>;
  listeners: Set<(evt: AgentEventPayload) => void>;
  runContextById: Map<string, AgentRunContext>;
};
const existing = (globalThis as Record<string, unknown>)[AGENT_EVENTS_KEY] as AgentEventsState | undefined;
const state: AgentEventsState = existing ?? {
  seqByRun: new Map<string, number>(),
  listeners: new Set<(evt: AgentEventPayload) => void>(),
  runContextById: new Map<string, AgentRunContext>(),
};
if (!existing) {
  (globalThis as Record<string, unknown>)[AGENT_EVENTS_KEY] = state;
}
const seqByRun = state.seqByRun;
const listeners = state.listeners;
const runContextById = state.runContextById;

export function registerAgentRunContext(runId: string, context: AgentRunContext) {
  if (!runId) {
    return;
  }
  const existing = runContextById.get(runId);
  if (!existing) {
    runContextById.set(runId, { ...context });
    return;
  }
  if (context.sessionKey && existing.sessionKey !== context.sessionKey) {
    existing.sessionKey = context.sessionKey;
  }
  if (context.verboseLevel && existing.verboseLevel !== context.verboseLevel) {
    existing.verboseLevel = context.verboseLevel;
  }
  if (context.isControlUiVisible !== undefined) {
    existing.isControlUiVisible = context.isControlUiVisible;
  }
  if (context.isHeartbeat !== undefined && existing.isHeartbeat !== context.isHeartbeat) {
    existing.isHeartbeat = context.isHeartbeat;
  }
  if (context.mirror !== undefined && existing.mirror !== context.mirror) {
    existing.mirror = context.mirror;
  }
}

export function getAgentRunContext(runId: string) {
  return runContextById.get(runId);
}

export function clearAgentRunContext(runId: string) {
  runContextById.delete(runId);
}

export function resetAgentRunContextForTest() {
  runContextById.clear();
}

export function emitAgentEvent(event: Omit<AgentEventPayload, "seq" | "ts">) {
  const nextSeq = (seqByRun.get(event.runId) ?? 0) + 1;
  seqByRun.set(event.runId, nextSeq);
  const context = runContextById.get(event.runId);
  const isControlUiVisible = context?.isControlUiVisible ?? true;
  const eventSessionKey =
    typeof event.sessionKey === "string" && event.sessionKey.trim() ? event.sessionKey : undefined;
  // [FORK-PATCH-16] Always propagate sessionKey — upstream strips it when isControlUiVisible=false,
  // but our SSE endpoint needs sessionKey to match events to subscribers. Without it, all tool
  // events and chat deltas from WA-originated runs arrive with sessionKey=undefined and get
  // dropped by SSE session filters.
  const sessionKey = eventSessionKey ?? context?.sessionKey;
  const enriched: AgentEventPayload = {
    ...event,
    sessionKey,
    seq: nextSeq,
    ts: Date.now(),
  };
  for (const listener of listeners) {
    try {
      listener(enriched);
    } catch {
      /* ignore */
    }
  }
}

export function onAgentEvent(listener: (evt: AgentEventPayload) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
