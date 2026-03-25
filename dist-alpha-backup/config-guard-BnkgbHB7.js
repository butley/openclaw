import "./paths-tuenh9TL.js";
import { P as shouldMigrateStateFromPath } from "./globals-cEUy0WVg.js";
import { n as isRich, r as theme, t as colorize } from "./theme-CipOb_We.js";
import { S as shortenHomePath } from "./utils-B1xPTYn-.js";
import { p_ as readConfigFileSnapshot } from "./reply-BRIrPGWy.js";
import "./agent-scope-D85sFDRQ.js";
import "./subsystem-Du2dCfuD.js";
import "./openclaw-root-B76Z4doY.js";
import "./logger-CTiHjjqB.js";
import "./exec-C6U2qsJQ.js";
import "./github-copilot-token-deWTDWZu.js";
import { t as formatCliCommand } from "./command-format-76HdMaIV.js";
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
import "./note-CioqV5Id.js";
import { n as formatConfigIssueLines } from "./issue-format-bpxa797r.js";
import { t as loadAndMaybeMigrateDoctorConfig } from "./doctor-config-flow-BlmoVQqW.js";
//#region src/cli/program/config-guard.ts
const ALLOWED_INVALID_COMMANDS = new Set([
	"doctor",
	"logs",
	"health",
	"help",
	"status"
]);
const ALLOWED_INVALID_GATEWAY_SUBCOMMANDS = new Set([
	"status",
	"probe",
	"health",
	"discover",
	"call",
	"install",
	"uninstall",
	"start",
	"stop",
	"restart"
]);
let didRunDoctorConfigFlow = false;
let configSnapshotPromise = null;
function resetConfigGuardStateForTests() {
	didRunDoctorConfigFlow = false;
	configSnapshotPromise = null;
}
async function getConfigSnapshot() {
	if (process.env.VITEST === "true") return readConfigFileSnapshot();
	configSnapshotPromise ??= readConfigFileSnapshot();
	return configSnapshotPromise;
}
async function ensureConfigReady(params) {
	const commandPath = params.commandPath ?? [];
	if (!didRunDoctorConfigFlow && shouldMigrateStateFromPath(commandPath)) {
		didRunDoctorConfigFlow = true;
		const runDoctorConfigFlow = async () => loadAndMaybeMigrateDoctorConfig({
			options: { nonInteractive: true },
			confirm: async () => false
		});
		if (!params.suppressDoctorStdout) await runDoctorConfigFlow();
		else {
			const originalStdoutWrite = process.stdout.write.bind(process.stdout);
			const originalSuppressNotes = process.env.OPENCLAW_SUPPRESS_NOTES;
			process.stdout.write = (() => true);
			process.env.OPENCLAW_SUPPRESS_NOTES = "1";
			try {
				await runDoctorConfigFlow();
			} finally {
				process.stdout.write = originalStdoutWrite;
				if (originalSuppressNotes === void 0) delete process.env.OPENCLAW_SUPPRESS_NOTES;
				else process.env.OPENCLAW_SUPPRESS_NOTES = originalSuppressNotes;
			}
		}
	}
	const snapshot = await getConfigSnapshot();
	const commandName = commandPath[0];
	const subcommandName = commandPath[1];
	const allowInvalid = commandName ? ALLOWED_INVALID_COMMANDS.has(commandName) || commandName === "gateway" && subcommandName && ALLOWED_INVALID_GATEWAY_SUBCOMMANDS.has(subcommandName) : false;
	const issues = snapshot.exists && !snapshot.valid ? formatConfigIssueLines(snapshot.issues, "-", { normalizeRoot: true }) : [];
	const legacyIssues = snapshot.legacyIssues.length > 0 ? formatConfigIssueLines(snapshot.legacyIssues, "-") : [];
	if (!(snapshot.exists && !snapshot.valid)) return;
	const rich = isRich();
	const muted = (value) => colorize(rich, theme.muted, value);
	const error = (value) => colorize(rich, theme.error, value);
	const heading = (value) => colorize(rich, theme.heading, value);
	const commandText = (value) => colorize(rich, theme.command, value);
	params.runtime.error(heading("Config invalid"));
	params.runtime.error(`${muted("File:")} ${muted(shortenHomePath(snapshot.path))}`);
	if (issues.length > 0) {
		params.runtime.error(muted("Problem:"));
		params.runtime.error(issues.map((issue) => `  ${error(issue)}`).join("\n"));
	}
	if (legacyIssues.length > 0) {
		params.runtime.error(muted("Legacy config keys detected:"));
		params.runtime.error(legacyIssues.map((issue) => `  ${error(issue)}`).join("\n"));
	}
	params.runtime.error("");
	params.runtime.error(`${muted("Run:")} ${commandText(formatCliCommand("openclaw doctor --fix"))}`);
	if (!allowInvalid) params.runtime.exit(1);
}
const __test__ = { resetConfigGuardStateForTests };
//#endregion
export { __test__, ensureConfigReady };
