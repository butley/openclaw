import "./paths-BJV7vkaX.js";
import { p as theme } from "./globals-BM8hKFm0.js";
import "./utils-DPPFsC2y.js";
import { qi as parseTimeoutMs } from "./reply-CwTwC1oS.js";
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
import { t as runTui } from "./tui-B8a-3UjJ.js";
//#region src/cli/tui-cli.ts
function registerTuiCli(program) {
	program.command("tui").description("Open a terminal UI connected to the Gateway").option("--url <url>", "Gateway WebSocket URL (defaults to gateway.remote.url when configured)").option("--token <token>", "Gateway token (if required)").option("--password <password>", "Gateway password (if required)").option("--session <key>", "Session key (default: \"main\", or \"global\" when scope is global)").option("--deliver", "Deliver assistant replies", false).option("--thinking <level>", "Thinking level override").option("--message <text>", "Send an initial message after connecting").option("--timeout-ms <ms>", "Agent timeout in ms (defaults to agents.defaults.timeoutSeconds)").option("--history-limit <n>", "History entries to load", "200").addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/tui", "docs.openclaw.ai/cli/tui")}\n`).action(async (opts) => {
		try {
			const timeoutMs = parseTimeoutMs(opts.timeoutMs);
			if (opts.timeoutMs !== void 0 && timeoutMs === void 0) defaultRuntime.error(`warning: invalid --timeout-ms "${String(opts.timeoutMs)}"; ignoring`);
			const historyLimit = Number.parseInt(String(opts.historyLimit ?? "200"), 10);
			await runTui({
				url: opts.url,
				token: opts.token,
				password: opts.password,
				session: opts.session,
				deliver: Boolean(opts.deliver),
				thinking: opts.thinking,
				message: opts.message,
				timeoutMs,
				historyLimit: Number.isNaN(historyLimit) ? void 0 : historyLimit
			});
		} catch (err) {
			defaultRuntime.error(String(err));
			defaultRuntime.exit(1);
		}
	});
}
//#endregion
export { registerTuiCli };
