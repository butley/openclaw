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
  isControlUiVisible?: boolean;
};

// [FORK-PATCH] Lazy globalThis singleton — survive bundler chunk duplication.
// Without this, registerAgentRunContext in one chunk writes to a different Map
// than emitAgentEvent reads from in another chunk → thinking events lose sessionKey.
const AGENT_EVENTS_KEY = "__openclaw_agentEvents__" as const;
type AgentEventsState = {
  seqByRun: Map<string, number>;
  listeners: Set<(evt: AgentEventPayload) => void>;
  runContextById: Map<string, AgentRunContext>;
};
function getState(): AgentEventsState {
  const g = globalThis as Record<string, unknown>;
  let s = g[AGENT_EVENTS_KEY] as AgentEventsState | undefined;
  if (!s) {
    s = {
      seqByRun: new Map(),
      listeners: new Set(),
      runContextById: new Map(),
    };
    g[AGENT_EVENTS_KEY] = s;
  }
  return s;
}

export function registerAgentRunContext(runId: string, context: AgentRunContext) {
  if (!runId) {
    return;
  }
  const map = getState().runContextById;
  const existing = map.get(runId);
  if (!existing) {
    map.set(runId, { ...context });
    return;
  }
  if (context.sessionKey && existing.sessionKey !== context.sessionKey) {
    existing.sessionKey = context.sessionKey;
  }
  if (context.verboseLevel && existing.verboseLevel !== context.verboseLevel) {
    existing.verboseLevel = context.verboseLevel;
  }
  if (context.isHeartbeat !== undefined && existing.isHeartbeat !== context.isHeartbeat) {
    existing.isHeartbeat = context.isHeartbeat;
  }
  if (context.mirror !== undefined && existing.mirror !== context.mirror) {
    existing.mirror = context.mirror;
  }
  if (context.isControlUiVisible !== undefined) {
    existing.isControlUiVisible = context.isControlUiVisible;
  }
}

export function getAgentRunContext(runId: string) {
  return getState().runContextById.get(runId);
}

export function clearAgentRunContext(runId: string) {
  getState().runContextById.delete(runId);
}

export function resetAgentRunContextForTest() {
  getState().runContextById.clear();
}

export function emitAgentEvent(event: Omit<AgentEventPayload, "seq" | "ts">) {
  const state = getState();
  const nextSeq = (state.seqByRun.get(event.runId) ?? 0) + 1;
  state.seqByRun.set(event.runId, nextSeq);
  const context = state.runContextById.get(event.runId);
  const sessionKey =
    typeof event.sessionKey === "string" && event.sessionKey.trim()
      ? event.sessionKey
      : context?.sessionKey;
  const enriched: AgentEventPayload = {
    ...event,
    sessionKey,
    seq: nextSeq,
    ts: Date.now(),
  };
  const currentListeners = state.listeners;
  for (const listener of currentListeners) {
    try {
      listener(enriched);
    } catch {
      /* ignore */
    }
  }
}

export function onAgentEvent(listener: (evt: AgentEventPayload) => void) {
  getState().listeners.add(listener);
  return () => getState().listeners.delete(listener);
}
