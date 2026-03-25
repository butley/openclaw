import { t as danger } from "./globals-1g9PhnTZ.js";
import "./paths-dQ_clcF4.js";
import { r as theme } from "./theme-H80Q3Qtv.js";
import { p as defaultRuntime } from "./subsystem-CVaAzJWY.js";
import "./boolean-Cxf2THfz.js";
import "./auth-profiles-C_hWnnsG.js";
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
import { t as formatDocsLink } from "./links-ee1fYZM6.js";
import "./cli-utils-Cffeb5c8.js";
import { n as callGatewayFromCli, t as addGatewayClientOptions } from "./gateway-rpc-CVTEnL7k.js";
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
