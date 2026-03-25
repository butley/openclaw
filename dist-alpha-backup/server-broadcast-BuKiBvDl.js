import { i as summarizeAgentEventForWsLog, n as logWs, r as shouldLogWs } from "./ws-log-5W5HiGvL.js";
import { EventEmitter } from "node:events";
//#region src/gateway/server-constants.ts
const MAX_PAYLOAD_BYTES = 25 * 1024 * 1024;
const MAX_BUFFERED_BYTES = 50 * 1024 * 1024;
const MAX_PREAUTH_PAYLOAD_BYTES = 64 * 1024;
let maxChatHistoryMessagesBytes = 6 * 1024 * 1024;
const getMaxChatHistoryMessagesBytes = () => maxChatHistoryMessagesBytes;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 3e3;
const getHandshakeTimeoutMs = () => {
	if (process.env.VITEST && process.env.OPENCLAW_TEST_HANDSHAKE_TIMEOUT_MS) {
		const parsed = Number(process.env.OPENCLAW_TEST_HANDSHAKE_TIMEOUT_MS);
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	return DEFAULT_HANDSHAKE_TIMEOUT_MS;
};
const TICK_INTERVAL_MS = 3e4;
const HEALTH_REFRESH_INTERVAL_MS = 6e4;
const DEDUPE_TTL_MS = 5 * 6e4;
const DEDUPE_MAX = 1e3;
//#endregion
//#region src/gateway/server-broadcast.ts
const GATEWAY_EVENT_BUS_KEY = "__openclaw_gatewayEventBus__";
function getGatewayEventBus() {
	const globalState = globalThis;
	if (!globalState[GATEWAY_EVENT_BUS_KEY]) {
		globalState[GATEWAY_EVENT_BUS_KEY] = new EventEmitter();
		globalState[GATEWAY_EVENT_BUS_KEY].setMaxListeners(100);
	}
	return globalState[GATEWAY_EVENT_BUS_KEY];
}
const gatewayEventBus = getGatewayEventBus();
const ADMIN_SCOPE = "operator.admin";
const APPROVALS_SCOPE = "operator.approvals";
const PAIRING_SCOPE = "operator.pairing";
const EVENT_SCOPE_GUARDS = {
	"exec.approval.requested": [APPROVALS_SCOPE],
	"exec.approval.resolved": [APPROVALS_SCOPE],
	"device.pair.requested": [PAIRING_SCOPE],
	"device.pair.resolved": [PAIRING_SCOPE],
	"node.pair.requested": [PAIRING_SCOPE],
	"node.pair.resolved": [PAIRING_SCOPE]
};
function hasEventScope(client, event) {
	const required = EVENT_SCOPE_GUARDS[event];
	if (!required) return true;
	if ((client.connect.role ?? "operator") !== "operator") return false;
	const scopes = Array.isArray(client.connect.scopes) ? client.connect.scopes : [];
	if (scopes.includes(ADMIN_SCOPE)) return true;
	return required.some((scope) => scopes.includes(scope));
}
function createGatewayBroadcaster(params) {
	let seq = 0;
	const broadcastInternal = (event, payload, opts, targetConnIds) => {
		if (!targetConnIds) gatewayEventBus.emit(event, payload);
		if (params.clients.size === 0) return;
		const eventSeq = Boolean(targetConnIds) ? void 0 : ++seq;
		const frame = JSON.stringify({
			type: "event",
			event,
			payload,
			seq: eventSeq,
			stateVersion: opts?.stateVersion
		});
		if (shouldLogWs()) {
			const logMeta = {
				event,
				seq: eventSeq ?? "targeted",
				clients: params.clients.size,
				targets: targetConnIds ? targetConnIds.size : void 0,
				dropIfSlow: opts?.dropIfSlow,
				presenceVersion: opts?.stateVersion?.presence,
				healthVersion: opts?.stateVersion?.health
			};
			if (event === "agent") Object.assign(logMeta, summarizeAgentEventForWsLog(payload));
			logWs("out", "event", logMeta);
		}
		for (const c of params.clients) {
			if (targetConnIds && !targetConnIds.has(c.connId)) continue;
			if (!hasEventScope(c, event)) continue;
			const slow = c.socket.bufferedAmount > MAX_BUFFERED_BYTES;
			if (slow && opts?.dropIfSlow) continue;
			if (slow) {
				try {
					c.socket.close(1008, "slow consumer");
				} catch {}
				continue;
			}
			try {
				c.socket.send(frame);
			} catch {}
		}
	};
	const broadcast = (event, payload, opts) => broadcastInternal(event, payload, opts);
	const broadcastToConnIds = (event, payload, connIds, opts) => {
		if (connIds.size === 0) return;
		broadcastInternal(event, payload, opts, connIds);
	};
	return {
		broadcast,
		broadcastToConnIds
	};
}
//#endregion
export { HEALTH_REFRESH_INTERVAL_MS as a, MAX_PREAUTH_PAYLOAD_BYTES as c, getMaxChatHistoryMessagesBytes as d, DEDUPE_TTL_MS as i, TICK_INTERVAL_MS as l, gatewayEventBus as n, MAX_BUFFERED_BYTES as o, DEDUPE_MAX as r, MAX_PAYLOAD_BYTES as s, createGatewayBroadcaster as t, getHandshakeTimeoutMs as u };
