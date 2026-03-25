import "./paths-tuenh9TL.js";
import "./globals-cEUy0WVg.js";
import "./theme-CipOb_We.js";
import "./utils-B1xPTYn-.js";
import "./reply-BRIrPGWy.js";
import "./agent-scope-D85sFDRQ.js";
import "./subsystem-Du2dCfuD.js";
import "./openclaw-root-B76Z4doY.js";
import "./logger-CTiHjjqB.js";
import "./exec-C6U2qsJQ.js";
import "./github-copilot-token-deWTDWZu.js";
import "./boolean-D8Ha5nYV.js";
import "./env-DWcyui2j.js";
import "./env-overrides-B59mbP3-.js";
import "./registry-3SOFgkh6.js";
import "./skills-CObtH1pm.js";
import "./frontmatter-D-zbDLA0.js";
import "./plugins-B3EU9SbO.js";
import "./query-expansion-D7MNjl_J.js";
import "./redact-BnV2ewAv.js";
import "./path-alias-guards-CGklijb0.js";
import "./fetch-Dp4lHtjH.js";
import "./errors-BVotJzwa.js";
import "./cmd-argv-BjL6p-dP.js";
import "./delivery-queue-CYy8h7nH.js";
import "./paths-B4q5wccl.js";
import "./session-cost-usage-DTqf62Zp.js";
import "./prompt-style-BJRiCD0E.js";
import "./links-TpjR6UKS.js";
import "./cli-utils-Bal-Phw0.js";
import "./runtime-guard-_R9gl1xw.js";
import "./note-CioqV5Id.js";
import "./daemon-install-plan.shared-D7_9J7V7.js";
import { n as buildGatewayInstallPlan, r as gatewayInstallErrorHint, t as resolveGatewayInstallToken } from "./gateway-install-token-_bABqKgP.js";
import { r as isGatewayDaemonRuntime } from "./daemon-runtime-C4_-bMd5.js";
import "./runtime-parse-B7MHNKjD.js";
import "./launchd-BwHL4IZ9.js";
import { n as resolveGatewayService } from "./service-DUsMTOWn.js";
import { i as isSystemdUserServiceAvailable } from "./systemd-BiGGKSFE.js";
import { n as ensureSystemdUserLingerNonInteractive } from "./systemd-linger-D3LGHoNj.js";
//#region src/commands/onboard-non-interactive/local/daemon-install.ts
async function installGatewayDaemonNonInteractive(params) {
	const { opts, runtime, port } = params;
	if (!opts.installDaemon) return { installed: false };
	const daemonRuntimeRaw = opts.daemonRuntime ?? "node";
	const systemdAvailable = process.platform === "linux" ? await isSystemdUserServiceAvailable() : true;
	if (process.platform === "linux" && !systemdAvailable) {
		runtime.log("Systemd user services are unavailable; skipping service install. Use a direct shell run (`openclaw gateway run`) or rerun without --install-daemon on this session.");
		return {
			installed: false,
			skippedReason: "systemd-user-unavailable"
		};
	}
	if (!isGatewayDaemonRuntime(daemonRuntimeRaw)) {
		runtime.error("Invalid --daemon-runtime (use node or bun)");
		runtime.exit(1);
		return { installed: false };
	}
	const service = resolveGatewayService();
	const tokenResolution = await resolveGatewayInstallToken({
		config: params.nextConfig,
		env: process.env
	});
	for (const warning of tokenResolution.warnings) runtime.log(warning);
	if (tokenResolution.unavailableReason) {
		runtime.error([
			"Gateway install blocked:",
			tokenResolution.unavailableReason,
			"Fix gateway auth config/token input and rerun onboarding."
		].join(" "));
		runtime.exit(1);
		return { installed: false };
	}
	const { programArguments, workingDirectory, environment } = await buildGatewayInstallPlan({
		env: process.env,
		port,
		runtime: daemonRuntimeRaw,
		warn: (message) => runtime.log(message),
		config: params.nextConfig
	});
	try {
		await service.install({
			env: process.env,
			stdout: process.stdout,
			programArguments,
			workingDirectory,
			environment
		});
	} catch (err) {
		runtime.error(`Gateway service install failed: ${String(err)}`);
		runtime.log(gatewayInstallErrorHint());
		return { installed: false };
	}
	await ensureSystemdUserLingerNonInteractive({ runtime });
	return { installed: true };
}
//#endregion
export { installGatewayDaemonNonInteractive };
