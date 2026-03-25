import "./globals-1g9PhnTZ.js";
import "./paths-dQ_clcF4.js";
import { r as theme } from "./theme-H80Q3Qtv.js";
import { p as defaultRuntime } from "./subsystem-CVaAzJWY.js";
import "./boolean-Cxf2THfz.js";
import { Gs as callGateway, Hp as GATEWAY_CLIENT_NAMES, Mh as isLoopbackHost, U as withProgress, Vp as GATEWAY_CLIENT_MODES, Ws as buildGatewayConnectionDetails, Xi as formatTimeAgo } from "./auth-profiles-C_hWnnsG.js";
import "./agent-scope-ciM67gYz.js";
import "./utils-hRMQE3lI.js";
import "./boundary-file-read-BoNLDurR.js";
import "./logger-Dz2ir4Xz.js";
import "./exec-oLHRjz5-.js";
import "./github-copilot-token-BlHBUXZs.js";
import "./registry-BGvHaTSg.js";
import "./skills-WwJ-cgxf.js";
import "./frontmatter-COEYX5xL.js";
import "./env-overrides-eH6HaD80.js";
import "./version-BlUhcaFh.js";
import "./search-manager-OoPMhEwb.js";
import "./plugins-CVp4JUox.js";
import "./query-expansion-BiHEyx7G.js";
import "./redact-BWjgs076.js";
import "./errors-D5INWvGS.js";
import "./fetch-D5SuoyGB.js";
import "./path-alias-guards-BWsWlD0g.js";
import "./cmd-argv-DWNHU-dd.js";
import "./delivery-queue-Dqzoxn1f.js";
import "./paths-DPIeb3JQ.js";
import "./session-cost-usage-hVTPrj3b.js";
import "./prompt-style-BzvcdUK-.js";
import "./links-ee1fYZM6.js";
import "./cli-utils-Cffeb5c8.js";
import { i as listDevicePairing, t as approveDevicePairing, u as summarizeDeviceTokens } from "./device-pairing-CzXbuLAG.js";
import { n as renderTable, t as getTerminalTableWidth } from "./table-DmABQmtM.js";
//#region src/cli/devices-cli.ts
const FALLBACK_NOTICE = "Direct scope access failed; using local fallback.";
const devicesCallOpts = (cmd, defaults) => cmd.option("--url <url>", "Gateway WebSocket URL (defaults to gateway.remote.url when configured)").option("--token <token>", "Gateway token (if required)").option("--password <password>", "Gateway password (password auth)").option("--timeout <ms>", "Timeout in ms", String(defaults?.timeoutMs ?? 1e4)).option("--json", "Output JSON", false);
const callGatewayCli = async (method, opts, params) => withProgress({
	label: `Devices ${method}`,
	indeterminate: true,
	enabled: opts.json !== true
}, async () => await callGateway({
	url: opts.url,
	token: opts.token,
	password: opts.password,
	method,
	params,
	timeoutMs: Number(opts.timeout ?? 1e4),
	clientName: GATEWAY_CLIENT_NAMES.CLI,
	mode: GATEWAY_CLIENT_MODES.CLI
}));
function normalizeErrorMessage(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
function shouldUseLocalPairingFallback(opts, error) {
	if (!normalizeErrorMessage(error).toLowerCase().includes("pairing required")) return false;
	if (typeof opts.url === "string" && opts.url.trim().length > 0) return false;
	const connection = buildGatewayConnectionDetails();
	if (connection.urlSource !== "local loopback") return false;
	try {
		return isLoopbackHost(new URL(connection.url).hostname);
	} catch {
		return false;
	}
}
function redactLocalPairedDevice(device) {
	const { tokens, ...rest } = device;
	return {
		...rest,
		tokens: summarizeDeviceTokens(tokens)
	};
}
async function listPairingWithFallback(opts) {
	try {
		return parseDevicePairingList(await callGatewayCli("device.pair.list", opts, {}));
	} catch (error) {
		if (!shouldUseLocalPairingFallback(opts, error)) throw error;
		if (opts.json !== true) defaultRuntime.log(theme.warn(FALLBACK_NOTICE));
		const local = await listDevicePairing();
		return {
			pending: local.pending,
			paired: local.paired.map((device) => redactLocalPairedDevice(device))
		};
	}
}
async function approvePairingWithFallback(opts, requestId) {
	try {
		return await callGatewayCli("device.pair.approve", opts, { requestId });
	} catch (error) {
		if (!shouldUseLocalPairingFallback(opts, error)) throw error;
		if (opts.json !== true) defaultRuntime.log(theme.warn(FALLBACK_NOTICE));
		const approved = await approveDevicePairing(requestId);
		if (!approved) return null;
		return {
			requestId,
			device: redactLocalPairedDevice(approved.device)
		};
	}
}
function parseDevicePairingList(value) {
	const obj = typeof value === "object" && value !== null ? value : {};
	return {
		pending: Array.isArray(obj.pending) ? obj.pending : [],
		paired: Array.isArray(obj.paired) ? obj.paired : []
	};
}
function selectLatestPendingRequest(pending) {
	if (!pending?.length) return null;
	return pending.reduce((latest, current) => {
		const latestTs = typeof latest.ts === "number" ? latest.ts : 0;
		return (typeof current.ts === "number" ? current.ts : 0) > latestTs ? current : latest;
	});
}
function formatTokenSummary(tokens) {
	if (!tokens || tokens.length === 0) return "none";
	return tokens.map((t) => `${t.role}${t.revokedAtMs ? " (revoked)" : ""}`).toSorted((a, b) => a.localeCompare(b)).join(", ");
}
function resolveRequiredDeviceRole(opts) {
	const deviceId = String(opts.device ?? "").trim();
	const role = String(opts.role ?? "").trim();
	if (deviceId && role) return {
		deviceId,
		role
	};
	defaultRuntime.error("--device and --role required");
	defaultRuntime.exit(1);
	return null;
}
function registerDevicesCli(program) {
	const devices = program.command("devices").description("Device pairing and auth tokens");
	devicesCallOpts(devices.command("list").description("List pending and paired devices").action(async (opts) => {
		const list = await listPairingWithFallback(opts);
		if (opts.json) {
			defaultRuntime.log(JSON.stringify(list, null, 2));
			return;
		}
		if (list.pending?.length) {
			const tableWidth = getTerminalTableWidth();
			defaultRuntime.log(`${theme.heading("Pending")} ${theme.muted(`(${list.pending.length})`)}`);
			defaultRuntime.log(renderTable({
				width: tableWidth,
				columns: [
					{
						key: "Request",
						header: "Request",
						minWidth: 10
					},
					{
						key: "Device",
						header: "Device",
						minWidth: 16,
						flex: true
					},
					{
						key: "Role",
						header: "Role",
						minWidth: 8
					},
					{
						key: "IP",
						header: "IP",
						minWidth: 12
					},
					{
						key: "Age",
						header: "Age",
						minWidth: 8
					},
					{
						key: "Flags",
						header: "Flags",
						minWidth: 8
					}
				],
				rows: list.pending.map((req) => ({
					Request: req.requestId,
					Device: req.displayName || req.deviceId,
					Role: req.role ?? "",
					IP: req.remoteIp ?? "",
					Age: typeof req.ts === "number" ? formatTimeAgo(Date.now() - req.ts) : "",
					Flags: req.isRepair ? "repair" : ""
				}))
			}).trimEnd());
		}
		if (list.paired?.length) {
			const tableWidth = getTerminalTableWidth();
			defaultRuntime.log(`${theme.heading("Paired")} ${theme.muted(`(${list.paired.length})`)}`);
			defaultRuntime.log(renderTable({
				width: tableWidth,
				columns: [
					{
						key: "Device",
						header: "Device",
						minWidth: 16,
						flex: true
					},
					{
						key: "Roles",
						header: "Roles",
						minWidth: 12,
						flex: true
					},
					{
						key: "Scopes",
						header: "Scopes",
						minWidth: 12,
						flex: true
					},
					{
						key: "Tokens",
						header: "Tokens",
						minWidth: 12,
						flex: true
					},
					{
						key: "IP",
						header: "IP",
						minWidth: 12
					}
				],
				rows: list.paired.map((device) => ({
					Device: device.displayName || device.deviceId,
					Roles: device.roles?.length ? device.roles.join(", ") : "",
					Scopes: device.scopes?.length ? device.scopes.join(", ") : "",
					Tokens: formatTokenSummary(device.tokens),
					IP: device.remoteIp ?? ""
				}))
			}).trimEnd());
		}
		if (!list.pending?.length && !list.paired?.length) defaultRuntime.log(theme.muted("No device pairing entries."));
	}));
	devicesCallOpts(devices.command("remove").description("Remove a paired device entry").argument("<deviceId>", "Paired device id").action(async (deviceId, opts) => {
		const trimmed = deviceId.trim();
		if (!trimmed) {
			defaultRuntime.error("deviceId is required");
			defaultRuntime.exit(1);
			return;
		}
		const result = await callGatewayCli("device.pair.remove", opts, { deviceId: trimmed });
		if (opts.json) {
			defaultRuntime.log(JSON.stringify(result, null, 2));
			return;
		}
		defaultRuntime.log(`${theme.warn("Removed")} ${theme.command(trimmed)}`);
	}));
	devicesCallOpts(devices.command("clear").description("Clear paired devices from the gateway table").option("--pending", "Also reject all pending pairing requests", false).option("--yes", "Confirm destructive clear", false).action(async (opts) => {
		if (!opts.yes) {
			defaultRuntime.error("Refusing to clear pairing table without --yes");
			defaultRuntime.exit(1);
			return;
		}
		const list = parseDevicePairingList(await callGatewayCli("device.pair.list", opts, {}));
		const removedDeviceIds = [];
		const rejectedRequestIds = [];
		const paired = Array.isArray(list.paired) ? list.paired : [];
		for (const device of paired) {
			const deviceId = typeof device.deviceId === "string" ? device.deviceId.trim() : "";
			if (!deviceId) continue;
			await callGatewayCli("device.pair.remove", opts, { deviceId });
			removedDeviceIds.push(deviceId);
		}
		if (opts.pending) {
			const pending = Array.isArray(list.pending) ? list.pending : [];
			for (const req of pending) {
				const requestId = typeof req.requestId === "string" ? req.requestId.trim() : "";
				if (!requestId) continue;
				await callGatewayCli("device.pair.reject", opts, { requestId });
				rejectedRequestIds.push(requestId);
			}
		}
		if (opts.json) {
			defaultRuntime.log(JSON.stringify({
				removedDevices: removedDeviceIds,
				rejectedPending: rejectedRequestIds
			}, null, 2));
			return;
		}
		defaultRuntime.log(`${theme.warn("Cleared")} ${removedDeviceIds.length} paired device${removedDeviceIds.length === 1 ? "" : "s"}`);
		if (opts.pending) defaultRuntime.log(`${theme.warn("Rejected")} ${rejectedRequestIds.length} pending request${rejectedRequestIds.length === 1 ? "" : "s"}`);
	}));
	devicesCallOpts(devices.command("approve").description("Approve a pending device pairing request").argument("[requestId]", "Pending request id").option("--latest", "Approve the most recent pending request", false).action(async (requestId, opts) => {
		let resolvedRequestId = requestId?.trim();
		if (!resolvedRequestId || opts.latest) resolvedRequestId = selectLatestPendingRequest((await listPairingWithFallback(opts)).pending)?.requestId?.trim();
		if (!resolvedRequestId) {
			defaultRuntime.error("No pending device pairing requests to approve");
			defaultRuntime.exit(1);
			return;
		}
		const result = await approvePairingWithFallback(opts, resolvedRequestId);
		if (!result) {
			defaultRuntime.error("unknown requestId");
			defaultRuntime.exit(1);
			return;
		}
		if (opts.json) {
			defaultRuntime.log(JSON.stringify(result, null, 2));
			return;
		}
		const deviceId = result?.device?.deviceId;
		defaultRuntime.log(`${theme.success("Approved")} ${theme.command(deviceId ?? "ok")} ${theme.muted(`(${resolvedRequestId})`)}`);
	}));
	devicesCallOpts(devices.command("reject").description("Reject a pending device pairing request").argument("<requestId>", "Pending request id").action(async (requestId, opts) => {
		const result = await callGatewayCli("device.pair.reject", opts, { requestId });
		if (opts.json) {
			defaultRuntime.log(JSON.stringify(result, null, 2));
			return;
		}
		const deviceId = result?.deviceId;
		defaultRuntime.log(`${theme.warn("Rejected")} ${theme.command(deviceId ?? "ok")}`);
	}));
	devicesCallOpts(devices.command("rotate").description("Rotate a device token for a role").requiredOption("--device <id>", "Device id").requiredOption("--role <role>", "Role name").option("--scope <scope...>", "Scopes to attach to the token (repeatable)").action(async (opts) => {
		const required = resolveRequiredDeviceRole(opts);
		if (!required) return;
		const result = await callGatewayCli("device.token.rotate", opts, {
			deviceId: required.deviceId,
			role: required.role,
			scopes: Array.isArray(opts.scope) ? opts.scope : void 0
		});
		defaultRuntime.log(JSON.stringify(result, null, 2));
	}));
	devicesCallOpts(devices.command("revoke").description("Revoke a device token for a role").requiredOption("--device <id>", "Device id").requiredOption("--role <role>", "Role name").action(async (opts) => {
		const required = resolveRequiredDeviceRole(opts);
		if (!required) return;
		const result = await callGatewayCli("device.token.revoke", opts, {
			deviceId: required.deviceId,
			role: required.role
		});
		defaultRuntime.log(JSON.stringify(result, null, 2));
	}));
}
//#endregion
export { registerDevicesCli };
