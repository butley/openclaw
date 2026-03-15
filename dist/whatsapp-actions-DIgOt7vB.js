import "./globals-Bv4ZcVWM.js";
import "./paths-BfR2LXbA.js";
import "./subsystem-JJ8bgFw2.js";
import "./boolean-DTgd5CzD.js";
import { Id as createActionGate, Ld as jsonResult, Pd as ToolAuthorizationError, Rd as readReactionParams, ro as missingTargetError, zd as readStringParam } from "./auth-profiles-C0kh5mIB.js";
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
import { U as resolveWhatsAppAccount, ct as normalizeWhatsAppTarget, st as isWhatsAppGroupJid } from "./plugins-LGMtobye.js";
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
import { i as sendReactionWhatsApp } from "./outbound-CAqaYt5K.js";
import "./brazil-jid-resolver-CYPrxq8d.js";
//#region src/whatsapp/resolve-outbound-target.ts
function resolveWhatsAppOutboundTarget(params) {
	const trimmed = params.to?.trim() ?? "";
	const allowListRaw = (params.allowFrom ?? []).map((entry) => String(entry).trim()).filter(Boolean);
	const hasWildcard = allowListRaw.includes("*");
	const allowList = allowListRaw.filter((entry) => entry !== "*").map((entry) => normalizeWhatsAppTarget(entry)).filter((entry) => Boolean(entry));
	if (trimmed) {
		const normalizedTo = normalizeWhatsAppTarget(trimmed);
		if (!normalizedTo) return {
			ok: false,
			error: missingTargetError("WhatsApp", "<E.164|group JID>")
		};
		if (isWhatsAppGroupJid(normalizedTo)) return {
			ok: true,
			to: normalizedTo
		};
		if (hasWildcard || allowList.length === 0) return {
			ok: true,
			to: normalizedTo
		};
		if (allowList.includes(normalizedTo)) return {
			ok: true,
			to: normalizedTo
		};
		return {
			ok: false,
			error: missingTargetError("WhatsApp", "<E.164|group JID>")
		};
	}
	return {
		ok: false,
		error: missingTargetError("WhatsApp", "<E.164|group JID>")
	};
}
//#endregion
//#region src/agents/tools/whatsapp-target-auth.ts
function resolveAuthorizedWhatsAppOutboundTarget(params) {
	const account = resolveWhatsAppAccount({
		cfg: params.cfg,
		accountId: params.accountId
	});
	const resolution = resolveWhatsAppOutboundTarget({
		to: params.chatJid,
		allowFrom: account.allowFrom ?? [],
		mode: "implicit"
	});
	if (!resolution.ok) throw new ToolAuthorizationError(`WhatsApp ${params.actionLabel} blocked: chatJid "${params.chatJid}" is not in the configured allowFrom list for account "${account.accountId}".`);
	return {
		to: resolution.to,
		accountId: account.accountId
	};
}
//#endregion
//#region src/agents/tools/whatsapp-actions.ts
async function handleWhatsAppAction(params, cfg) {
	const action = readStringParam(params, "action", { required: true });
	const isActionEnabled = createActionGate(cfg.channels?.whatsapp?.actions);
	if (action === "react") {
		if (!isActionEnabled("reactions")) throw new Error("WhatsApp reactions are disabled.");
		const chatJid = readStringParam(params, "chatJid", { required: true });
		const messageId = readStringParam(params, "messageId", { required: true });
		const { emoji, remove, isEmpty } = readReactionParams(params, { removeErrorMessage: "Emoji is required to remove a WhatsApp reaction." });
		const participant = readStringParam(params, "participant");
		const accountId = readStringParam(params, "accountId");
		const fromMeRaw = params.fromMe;
		const fromMe = typeof fromMeRaw === "boolean" ? fromMeRaw : void 0;
		const resolved = resolveAuthorizedWhatsAppOutboundTarget({
			cfg,
			chatJid,
			accountId,
			actionLabel: "reaction"
		});
		const resolvedEmoji = remove ? "" : emoji;
		await sendReactionWhatsApp(resolved.to, messageId, resolvedEmoji, {
			verbose: false,
			fromMe,
			participant: participant ?? void 0,
			accountId: resolved.accountId
		});
		if (!remove && !isEmpty) return jsonResult({
			ok: true,
			added: emoji
		});
		return jsonResult({
			ok: true,
			removed: true
		});
	}
	throw new Error(`Unsupported WhatsApp action: ${action}`);
}
//#endregion
export { handleWhatsAppAction };
