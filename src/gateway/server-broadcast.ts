import { EventEmitter } from "node:events";
import { MAX_BUFFERED_BYTES } from "./server-constants.js";
import type { GatewayWsClient } from "./server/ws-types.js";
import { logWs, shouldLogWs, summarizeAgentEventForWsLog } from "./ws-log.js";

/**
 * Global event bus for SSE consumers. Emits the same events as WS broadcast
 * but without dropIfSlow — SSE uses HTTP backpressure instead.
 * Listeners receive (event: string, payload: unknown).
 *
 * IMPORTANT: Uses globalThis singleton to survive bundler chunk duplication.
 * The bundler may split server-broadcast.ts into multiple chunks (e.g.
 * gateway-cli-DrjKHMYb.js and gateway-cli-KUZQqdiC.js), each getting its
 * own module-level `new EventEmitter()`. Without globalThis, broadcast()
 * emits on one instance while SSE listens on another → events never arrive.
 * Same class of bug as WA active-listener (#23027).
 */
// [FORK-PATCH-31] SSE EventBus Singleton — globalThis singleton survives bundler chunk duplication. See patches/README.md #31.
const GATEWAY_EVENT_BUS_KEY = "__openclaw_gatewayEventBus__";
const existingBus = (globalThis as Record<string, unknown>)[GATEWAY_EVENT_BUS_KEY] as EventEmitter | undefined;
if (existingBus) {
  console.warn("[sse] gatewayEventBus reused from globalThis — second chunk loaded (bundler dedup confirmed)");
}
export const gatewayEventBus: EventEmitter = existingBus ??
  (() => {
    const bus = new EventEmitter();
    (globalThis as Record<string, unknown>)[GATEWAY_EVENT_BUS_KEY] = bus;
    return bus;
  })();
gatewayEventBus.setMaxListeners(100); // support multiple concurrent SSE streams

const ADMIN_SCOPE = "operator.admin";
const APPROVALS_SCOPE = "operator.approvals";
const PAIRING_SCOPE = "operator.pairing";

const EVENT_SCOPE_GUARDS: Record<string, string[]> = {
  "exec.approval.requested": [APPROVALS_SCOPE],
  "exec.approval.resolved": [APPROVALS_SCOPE],
  "device.pair.requested": [PAIRING_SCOPE],
  "device.pair.resolved": [PAIRING_SCOPE],
  "node.pair.requested": [PAIRING_SCOPE],
  "node.pair.resolved": [PAIRING_SCOPE],
};

export type GatewayBroadcastStateVersion = {
  presence?: number;
  health?: number;
};

export type GatewayBroadcastOpts = {
  dropIfSlow?: boolean;
  stateVersion?: GatewayBroadcastStateVersion;
};

export type GatewayBroadcastFn = (
  event: string,
  payload: unknown,
  opts?: GatewayBroadcastOpts,
) => void;

export type GatewayBroadcastToConnIdsFn = (
  event: string,
  payload: unknown,
  connIds: ReadonlySet<string>,
  opts?: GatewayBroadcastOpts,
) => void;

function hasEventScope(client: GatewayWsClient, event: string): boolean {
  const required = EVENT_SCOPE_GUARDS[event];
  if (!required) {
    return true;
  }
  const role = client.connect.role ?? "operator";
  if (role !== "operator") {
    return false;
  }
  const scopes = Array.isArray(client.connect.scopes) ? client.connect.scopes : [];
  if (scopes.includes(ADMIN_SCOPE)) {
    return true;
  }
  return required.some((scope) => scopes.includes(scope));
}

export function createGatewayBroadcaster(params: { clients: Set<GatewayWsClient> }) {
  let seq = 0;

  const broadcastInternal = (
    event: string,
    payload: unknown,
    opts?: GatewayBroadcastOpts,
    targetConnIds?: ReadonlySet<string>,
  ) => {
    // Always emit on event bus for SSE consumers — independent of WS client count.
    // Must happen before the clients.size === 0 guard so SSE keeps receiving events
    // even when no WS clients are connected (e.g. WS disconnect while SSE stays open).
    // Targeted broadcasts (broadcastToConnIds) are WS-only and skip the event bus.
    if (!targetConnIds) {
      gatewayEventBus.emit(event, payload);
    }

    if (params.clients.size === 0) {
      return;
    }
    const isTargeted = Boolean(targetConnIds);
    const eventSeq = isTargeted ? undefined : ++seq;
    const frame = JSON.stringify({
      type: "event",
      event,
      payload,
      seq: eventSeq,
      stateVersion: opts?.stateVersion,
    });
    if (shouldLogWs()) {
      const logMeta: Record<string, unknown> = {
        event,
        seq: eventSeq ?? "targeted",
        clients: params.clients.size,
        targets: targetConnIds ? targetConnIds.size : undefined,
        dropIfSlow: opts?.dropIfSlow,
        presenceVersion: opts?.stateVersion?.presence,
        healthVersion: opts?.stateVersion?.health,
      };
      if (event === "agent") {
        Object.assign(logMeta, summarizeAgentEventForWsLog(payload));
      }
      logWs("out", "event", logMeta);
    }

    for (const c of params.clients) {
      if (targetConnIds && !targetConnIds.has(c.connId)) {
        continue;
      }
      if (!hasEventScope(c, event)) {
        continue;
      }
      const slow = c.socket.bufferedAmount > MAX_BUFFERED_BYTES;
      if (slow && opts?.dropIfSlow) {
        continue;
      }
      if (slow) {
        try {
          c.socket.close(1008, "slow consumer");
        } catch {
          /* ignore */
        }
        continue;
      }
      try {
        c.socket.send(frame);
      } catch {
        /* ignore */
      }
    }
  };

  const broadcast: GatewayBroadcastFn = (event, payload, opts) =>
    broadcastInternal(event, payload, opts);

  const broadcastToConnIds: GatewayBroadcastToConnIdsFn = (event, payload, connIds, opts) => {
    if (connIds.size === 0) {
      return;
    }
    broadcastInternal(event, payload, opts, connIds);
  };

  return { broadcast, broadcastToConnIds };
}
