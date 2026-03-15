import "./paths-BJV7vkaX.js";
import { p as theme, t as danger } from "./globals-BM8hKFm0.js";
import "./utils-DPPFsC2y.js";
import "./reply-CwTwC1oS.js";
import "./agent-scope-bBcv3AIJ.js";
import { p as defaultRuntime } from "./subsystem-BvX9dUUv.js";
import "./openclaw-root-DrFjwUcG.js";
import "./logger-DCuywXMd.js";
import "./exec-TuwQr-2y.js";
import "./github-copilot-token-D37fjdwy.js";
import "./boolean-CJxfhBkG.js";
import "./env-CxRUQUsA.js";
import "./env-overrides-CyhGSMpJ.js";
import "./registry-B62TT8EF.js";
import "./skills-DlDmGWv1.js";
import "./frontmatter-7FVJq8_7.js";
import "./plugins-DcM3N09V.js";
import "./query-expansion-CHR_rUXw.js";
import "./redact-B6xsEMyG.js";
import "./path-alias-guards-CdGRC4Iy.js";
import "./fetch-DDFoAqMq.js";
import "./cli-utils-bDNIASFn.js";
import "./delivery-queue-BoVxHNnx.js";
import "./paths-i-OZT6Ed.js";
import "./session-cost-usage-BXfE6h21.js";
import "./prompt-style-RdMoUk0e.js";
import { t as formatDocsLink } from "./links-CLy2YkK3.js";
import { n as callGatewayFromCli, t as addGatewayClientOptions } from "./gateway-rpc-C9g22Awn.js";
//#region src/cli/system-cli.ts
const normalizeWakeMode = (raw) => {
	const mode = typeof raw === "string" ? raw.trim() : "";
	if (!mode) return "next-heartbeat";
	if (mode === "now" || mode === "next-heartbeat") return mode;
	throw new Error("--mode must be now or next-heartbeat");
};
async function runSystemGatewayCommand(opts, action, successText) {
	try {
		const result = await action();
		if (opts.json || successText === void 0) defaultRuntime.log(JSON.stringify(result, null, 2));
		else defaultRuntime.log(successText);
	} catch (err) {
		defaultRuntime.error(danger(String(err)));
		defaultRuntime.exit(1);
	}
}
function registerSystemCli(program) {
	const system = program.command("system").description("System tools (events, heartbeat, presence)").addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/system", "docs.openclaw.ai/cli/system")}\n`);
	addGatewayClientOptions(system.command("event").description("Enqueue a system event and optionally trigger a heartbeat").requiredOption("--text <text>", "System event text").option("--mode <mode>", "Wake mode (now|next-heartbeat)", "next-heartbeat").option("--json", "Output JSON", false)).action(async (opts) => {
		await runSystemGatewayCommand(opts, async () => {
			const text = typeof opts.text === "string" ? opts.text.trim() : "";
			if (!text) throw new Error("--text is required");
			return await callGatewayFromCli("wake", opts, {
				mode: normalizeWakeMode(opts.mode),
				text
			}, { expectFinal: false });
		}, "ok");
	});
	const heartbeat = system.command("heartbeat").description("Heartbeat controls");
	addGatewayClientOptions(heartbeat.command("last").description("Show the last heartbeat event").option("--json", "Output JSON", false)).action(async (opts) => {
		await runSystemGatewayCommand(opts, async () => {
			return await callGatewayFromCli("last-heartbeat", opts, void 0, { expectFinal: false });
		});
	});
	addGatewayClientOptions(heartbeat.command("enable").description("Enable heartbeats").option("--json", "Output JSON", false)).action(async (opts) => {
		await runSystemGatewayCommand(opts, async () => {
			return await callGatewayFromCli("set-heartbeats", opts, { enabled: true }, { expectFinal: false });
		});
	});
	addGatewayClientOptions(heartbeat.command("disable").description("Disable heartbeats").option("--json", "Output JSON", false)).action(async (opts) => {
		await runSystemGatewayCommand(opts, async () => {
			return await callGatewayFromCli("set-heartbeats", opts, { enabled: false }, { expectFinal: false });
		});
	});
	addGatewayClientOptions(system.command("presence").description("List system presence entries").option("--json", "Output JSON", false)).action(async (opts) => {
		await runSystemGatewayCommand(opts, async () => {
			return await callGatewayFromCli("system-presence", opts, void 0, { expectFinal: false });
		});
	});
}
//#endregion
export { registerSystemCli };
