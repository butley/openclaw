import { h as resolveWhatsAppAccount } from "./channel-config-helpers-DXyHWBVJ.js";
import { Jr as jsonResult, Kr as ToolAuthorizationError, La as resolveWhatsAppOutboundTarget, Xr as readReactionParams, Zr as readStringParam, qr as createActionGate } from "./thread-bindings-0Uc4GeBT.js";
import "./paths-WR8OhEmw.js";
import "./github-copilot-token-BGYH4ltJ.js";
import "./logger-C9fkmDdb.js";
import "./tmp-openclaw-dir-DRPiOszV.js";
import "./globals-DMfGJ_36.js";
import "./utils-DfdxfpoM.js";
import "./subsystem-CfLo2GBS.js";
import "./fetch-DftkrN27.js";
import "./exec-Btxwbj1p.js";
import "./thinking-CSUA5PYQ.js";
import "./query-expansion-s2jldUV4.js";
import "./logger-BYeF241k.js";
import "./zod-schema.core-De203jOD.js";
import "./redact-BuzJ8kUo.js";
import "./http-registry-BsB8N5w2.js";
import "./pairing-token-DX0HaDzb.js";
import "./ssrf--5Fh_apX.js";
import "./fetch-guard-B43Ufsg7.js";
import "./registry-SHl7cuYc.js";
import "./http-body-Cgn9Rlev.js";
import { r as sendReactionWhatsApp } from "./outbound-Bk_cs4FT.js";
import "./brazil-jid-resolver-CDQW4PyA.js";
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
