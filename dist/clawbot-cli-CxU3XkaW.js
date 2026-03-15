import { p as theme } from "./globals-Bv4ZcVWM.js";
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
import { t as formatDocsLink } from "./links-D9bLZY_S.js";
import "./device-bootstrap-CpDoB8Cr.js";
import { registerQrCli } from "./qr-cli-C7aiEyBJ.js";
//#region src/cli/clawbot-cli.ts
function registerClawbotCli(program) {
	registerQrCli(program.command("clawbot").description("Legacy clawbot command aliases").addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/clawbot", "docs.openclaw.ai/cli/clawbot")}\n`));
}
//#endregion
export { registerClawbotCli };
