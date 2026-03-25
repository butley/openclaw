import "./globals-1g9PhnTZ.js";
import { g as resolveStateDir } from "./paths-dQ_clcF4.js";
import "./theme-H80Q3Qtv.js";
import { p as defaultRuntime } from "./subsystem-CVaAzJWY.js";
import "./boolean-Cxf2THfz.js";
import { G as formatHelpExamples, jg as loadConfig } from "./auth-profiles-C_hWnnsG.js";
import { f as resolveDefaultAgentId } from "./agent-scope-ciM67gYz.js";
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
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
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
