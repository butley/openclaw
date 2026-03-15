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
// Access globalThis[KEY] via getter functions to avoid ESM import hoisting race:
// when two chunks import this module, both evaluate `const existing = globalThis[KEY]`
// before either writes to globalThis, causing both to create separate state.
// By using getters, we always read the LATEST value from globalThis.
const AGENT_EVENTS_KEY = "__openclaw_agentEvents__";
type AgentEventsState = {
  seqByRun: Map<string, number>;
  listeners: Set<(evt: AgentEventPayload) => void>;
  runContextById: Map<string, AgentRunContext>;
};
function getAgentEventsState(): AgentEventsState {
  let s = (globalThis as Record<string, unknown>)[AGENT_EVENTS_KEY] as AgentEventsState | undefined;
  if (!s) {
    s = {
      seqByRun: new Map<string, number>(),
      listeners: new Set<(evt: AgentEventPayload) => void>(),
      runContextById: new Map<string, AgentRunContext>(),
    };
    (globalThis as Record<string, unknown>)[AGENT_EVENTS_KEY] = s;
  }
  return s;
}
// Lazy accessors — always resolve from globalThis at call time
const getSeqByRun = () => getAgentEventsState().seqByRun;
const getListeners = () => getAgentEventsState().listeners;
const getRunContextById = () => getAgentEventsState().runContextById;

export function registerAgentRunContext(runId: string, context: AgentRunContext) {
  if (!runId) {
    return;
  }
  const existing = getRunContextById().get(runId);
  if (!existing) {
    getRunContextById().set(runId, { ...context });
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
  return getRunContextById().get(runId);
}

export function clearAgentRunContext(runId: string) {
  getRunContextById().delete(runId);
}

export function resetAgentRunContextForTest() {
  getRunContextById().clear();
}

export function emitAgentEvent(event: Omit<AgentEventPayload, "seq" | "ts">) {
  const nextSeq = (getSeqByRun().get(event.runId) ?? 0) + 1;
  getSeqByRun().set(event.runId, nextSeq);
  const context = getRunContextById().get(event.runId);
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
  if (event.stream === "tool" || event.stream === "thinking") {
    console.log(`[agent-events] emitting ${event.stream}: listeners=${getListeners().size} runId=${event.runId} session=${sessionKey?.substring(0,40)} stateId=${(getAgentEventsState() as any).__debugId ?? 'none'}`);
    if (!(getAgentEventsState() as any).__debugId) (getAgentEventsState() as any).__debugId = Math.random().toString(36).slice(2,8);
  }
  const currentListeners = getListeners();
  for (const listener of currentListeners) {
    try {
      listener(enriched);
    } catch (err) {
      console.error(`[agent-events] listener threw: stream=${event.stream} err=${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export function onAgentEvent(listener: (evt: AgentEventPayload) => void) {
  getListeners().add(listener);
  if (!(getAgentEventsState() as any).__debugId) (getAgentEventsState() as any).__debugId = Math.random().toString(36).slice(2,8);
  console.log(`[agent-events] registered listener: total=${getListeners().size} stateId=${(getAgentEventsState() as any).__debugId}`);
  return () => getListeners().delete(listener);
}
