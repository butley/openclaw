import { g as resolveStateDir } from "./paths-BJV7vkaX.js";
import "./globals-BM8hKFm0.js";
import "./utils-DPPFsC2y.js";
import { b_ as loadConfig, q as formatHelpExamples } from "./reply-CwTwC1oS.js";
import { f as resolveDefaultAgentId } from "./agent-scope-bBcv3AIJ.js";
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
import "./links-CLy2YkK3.js";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
//#region src/cli/qmd-cli.ts
/**
* Extract `--agent <id>` from argv, returning the agent id and the remaining
* args that should be forwarded to qmd.  We do this manually so we don't need
* commander's passThroughOptions (which requires enablePositionalOptions on the
* parent) and so unknown qmd flags aren't swallowed.
*/
function extractAgentArg(argv) {
	const rest = [];
	let agentId = null;
	let i = 0;
	while (i < argv.length) {
		const arg = argv[i];
		if ((arg === "--agent" || arg === "-a") && i + 1 < argv.length) {
			agentId = argv[i + 1];
			i += 2;
		} else if (arg?.startsWith("--agent=")) {
			agentId = arg.slice(8);
			i += 1;
		} else {
			rest.push(arg);
			i += 1;
		}
	}
	return {
		agentId,
		rest
	};
}
function resolveAgent(agentId) {
	if (agentId) return agentId.trim();
	try {
		return resolveDefaultAgentId(loadConfig());
	} catch {
		return "main";
	}
}
function resolveXdgCacheHome(agentId) {
	const stateDir = resolveStateDir(process.env, os.homedir);
	return path.join(stateDir, "agents", agentId, "qmd", "xdg-cache");
}
function findQmdBinary() {
	if (process.env.OPENCLAW_QMD_BIN) return process.env.OPENCLAW_QMD_BIN;
	return "qmd";
}
function registerQmdCli(program) {
	program.command("qmd").description("Proxy qmd commands with agent-scoped XDG_CACHE_HOME").addHelpText("after", () => `\n${formatHelpExamples([
		["openclaw qmd status --index index", "Show qmd index status."],
		["openclaw qmd query \"search term\"", "Run a semantic query."],
		["openclaw qmd embed --index index", "Re-embed the index."],
		["openclaw qmd --agent work status --index index", "Use a different agent's index."]
	])}\n`).option("--agent <id>", "Agent ID whose qmd index to use (default: default agent)").allowUnknownOption(true).allowExcessArguments(true).action(() => {
		const argv = process.argv;
		const qmdIdx = argv.findIndex((arg, i) => i >= 2 && arg === "qmd");
		const { agentId: parsedAgent, rest: qmdArgs } = extractAgentArg(qmdIdx >= 0 ? argv.slice(qmdIdx + 1) : []);
		const xdgCacheHome = resolveXdgCacheHome(resolveAgent(parsedAgent));
		const qmdBin = findQmdBinary();
		const result = spawnSync(qmdBin, qmdArgs, {
			env: {
				...process.env,
				XDG_CACHE_HOME: xdgCacheHome
			},
			stdio: "inherit",
			shell: false
		});
		if (result.error) {
			defaultRuntime.error(`qmd: failed to spawn '${qmdBin}': ${result.error.message}\nMake sure qmd is installed and available in PATH.`);
			defaultRuntime.exit(1);
			return;
		}
		const code = result.status ?? 1;
		if (code !== 0) defaultRuntime.exit(code);
	});
}
//#endregion
export { registerQmdCli };
