import "./globals-1g9PhnTZ.js";
import "./paths-dQ_clcF4.js";
import "./theme-H80Q3Qtv.js";
import { t as createSubsystemLogger } from "./subsystem-CVaAzJWY.js";
import "./boolean-Cxf2THfz.js";
import { jg as loadConfig, z as loadOpenClawPlugins } from "./auth-profiles-C_hWnnsG.js";
import { d as resolveAgentWorkspaceDir, f as resolveDefaultAgentId } from "./agent-scope-ciM67gYz.js";
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
