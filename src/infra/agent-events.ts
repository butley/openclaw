import type { VerboseLevel } from "../auto-reply/thinking.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import "./inbound-events.js";

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

type AgentEventsState = {
  seqByRun: Map<string, number>;
  listeners: Set<(evt: AgentEventPayload) => void>;
  runContextById: Map<string, AgentRunContext>;
};

const AGENT_EVENTS_STATE_KEY = "__openclaw_agentEvents__";
const log = createSubsystemLogger("infra/agent-events");
const reasoningDebugEnabled = process.env.OPENCLAW_DEBUG_REASONING === "1";

function getState(): AgentEventsState {
  const globalState = globalThis as typeof globalThis & {
    [AGENT_EVENTS_STATE_KEY]?: AgentEventsState;
  };
  if (!globalState[AGENT_EVENTS_STATE_KEY]) {
    globalState[AGENT_EVENTS_STATE_KEY] = {
      seqByRun: new Map<string, number>(),
      listeners: new Set<(evt: AgentEventPayload) => void>(),
      runContextById: new Map<string, AgentRunContext>(),
    };
  }
  return globalState[AGENT_EVENTS_STATE_KEY];
}

export function registerAgentRunContext(runId: string, context: AgentRunContext) {
  if (!runId) {
    return;
  }
  const { runContextById } = getState();
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
  return getState().runContextById.get(runId);
}

export function clearAgentRunContext(runId: string) {
  getState().runContextById.delete(runId);
}

export function resetAgentRunContextForTest() {
  getState().runContextById.clear();
}

export function emitAgentEvent(event: Omit<AgentEventPayload, "seq" | "ts">) {
  const { seqByRun, runContextById, listeners } = getState();
  const nextSeq = (seqByRun.get(event.runId) ?? 0) + 1;
  seqByRun.set(event.runId, nextSeq);
  const context = runContextById.get(event.runId);
  const eventSessionKey =
    typeof event.sessionKey === "string" && event.sessionKey.trim() ? event.sessionKey : undefined;
  // [FORK-PATCH-6] isControlUiVisible — preserve session routing even when control UI is hidden.
  const sessionKey = eventSessionKey ?? context?.sessionKey;
  const enriched: AgentEventPayload = {
    ...event,
    sessionKey,
    seq: nextSeq,
    ts: Date.now(),
  };
  if (reasoningDebugEnabled && event.stream === "thinking") {
    const rawDeltaLen =
      typeof event.data?.rawDelta === "string"
        ? event.data.rawDelta.length
        : typeof event.data?.delta === "string"
          ? event.data.delta.length
          : 0;
    log.info(
      `[reasoning:event] runId=${event.runId} seq=${nextSeq} sessionKey=${sessionKey ?? "NONE"} ctxSession=${context?.sessionKey ?? "NONE"} listeners=${listeners.size} rawDeltaLen=${rawDeltaLen}`,
    );
  }
  for (const listener of listeners) {
    try {
      listener(enriched);
    } catch {
      /* ignore */
    }
  }
}

export function onAgentEvent(listener: (evt: AgentEventPayload) => void) {
  const { listeners } = getState();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
