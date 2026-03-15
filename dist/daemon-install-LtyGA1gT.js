import "./globals-Bv4ZcVWM.js";
import "./paths-BfR2LXbA.js";
import "./subsystem-JJ8bgFw2.js";
import "./boolean-DTgd5CzD.js";
import "./auth-profiles-C0kh5mIB.js";
import "./agent-scope-C4S7fG5T.js";
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
import "./note-HV2zZJAV.js";
import "./daemon-install-plan.shared-B-Il-Vr1.js";
import "./runtime-guard-f5IxSOtq.js";
import { n as buildGatewayInstallPlan, r as gatewayInstallErrorHint, t as resolveGatewayInstallToken } from "./gateway-install-token-7ays6SpE.js";
import { r as isGatewayDaemonRuntime } from "./daemon-runtime-C3k8ZAj5.js";
import { i as isSystemdUserServiceAvailable } from "./systemd-DXsGlfGs.js";
import { n as resolveGatewayService } from "./service-BZhRiTaM.js";
import { n as ensureSystemdUserLingerNonInteractive } from "./systemd-linger-LznV-8u0.js";
//#region src/commands/onboard-non-interactive/local/daemon-install.ts
async function installGatewayDaemonNonInteractive(params) {
	const { opts, runtime, port } = params;
	if (!opts.installDaemon) return;
	const daemonRuntimeRaw = opts.daemonRuntime ?? "node";
	const systemdAvailable = process.platform === "linux" ? await isSystemdUserServiceAvailable() : true;
	if (process.platform === "linux" && !systemdAvailable) {
		runtime.log("Systemd user services are unavailable; skipping service install.");
		return;
	}
	if (!isGatewayDaemonRuntime(daemonRuntimeRaw)) {
		runtime.error("Invalid --daemon-runtime (use node or bun)");
		runtime.exit(1);
		return;
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
		return;
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
		return;
	}
	await ensureSystemdUserLingerNonInteractive({ runtime });
}
//#endregion
export { installGatewayDaemonNonInteractive };
