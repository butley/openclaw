import "./globals-Bv4ZcVWM.js";
import "./paths-BfR2LXbA.js";
import { t as createSubsystemLogger } from "./subsystem-JJ8bgFw2.js";
import "./boolean-DTgd5CzD.js";
import { Rg as loadConfig, z as loadOpenClawPlugins } from "./auth-profiles-C0kh5mIB.js";
import { d as resolveAgentWorkspaceDir, f as resolveDefaultAgentId } from "./agent-scope-C4S7fG5T.js";
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
//#region src/plugins/cli.ts
const log = createSubsystemLogger("plugins");
function registerPluginCliCommands(program, cfg, env) {
	const config = cfg ?? loadConfig();
	const workspaceDir = resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config));
	const logger = {
		info: (msg) => log.info(msg),
		warn: (msg) => log.warn(msg),
		error: (msg) => log.error(msg),
		debug: (msg) => log.debug(msg)
	};
	const registry = loadOpenClawPlugins({
		config,
		workspaceDir,
		env,
		logger
	});
	const existingCommands = new Set(program.commands.map((cmd) => cmd.name()));
	for (const entry of registry.cliRegistrars) {
		if (entry.commands.length > 0) {
			const overlaps = entry.commands.filter((command) => existingCommands.has(command));
			if (overlaps.length > 0) {
				log.debug(`plugin CLI register skipped (${entry.pluginId}): command already registered (${overlaps.join(", ")})`);
				continue;
			}
		}
		try {
			const result = entry.register({
				program,
				config,
				workspaceDir,
				logger
			});
			if (result && typeof result.then === "function") result.catch((err) => {
				log.warn(`plugin CLI register failed (${entry.pluginId}): ${String(err)}`);
			});
			for (const command of entry.commands) existingCommands.add(command);
		} catch (err) {
			log.warn(`plugin CLI register failed (${entry.pluginId}): ${String(err)}`);
		}
	}
}
//#endregion
export { registerPluginCliCommands };
