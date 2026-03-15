import "./globals-Bv4ZcVWM.js";
import { g as resolveStateDir } from "./paths-BfR2LXbA.js";
import { p as defaultRuntime } from "./subsystem-JJ8bgFw2.js";
import "./boolean-DTgd5CzD.js";
import { G as formatHelpExamples, Rg as loadConfig } from "./auth-profiles-C0kh5mIB.js";
import { f as resolveDefaultAgentId } from "./agent-scope-C4S7fG5T.js";
import "./utils-CtED9zde.js";
import "./boundary-file-read-B1ga_qm2.js";
import "./logger-BUMgVwAa.js";
import "./exec-W1AIRZPs.js";
import "./github-copilot-token-Dgt86bL5.js";
import "./registry-BfhkiWvO.js";
import "./skills-Cb5J3NWM.js";
import "./frontmatter-D0K3qXQH.js";
import "./env-overrides-6kya__R2.js";
import "./version-DcA9ITyc.js";
import "./search-manager-DSd7jCvQ.js";
import "./plugins-LGMtobye.js";
import "./query-expansion-CU62AsAp.js";
import "./redact-gt8ZHLqM.js";
import "./cli-utils-Cs2-IJRN.js";
import "./fetch-KA2Mm62U.js";
import "./path-alias-guards-B3hD8xdj.js";
import "./delivery-queue-_GnNO_Fd.js";
import "./paths--60oHXZP.js";
import "./session-cost-usage-DoUewFvY.js";
import "./prompt-style-CvOiDahx.js";
import "./links-D9bLZY_S.js";
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
