import { g as normalizeAccountId, h as DEFAULT_ACCOUNT_ID } from "./session-key-CbP51u9x.js";
import { V as formatPairingApproveHint } from "./channel-config-helpers-DXyHWBVJ.js";
import { Bn as parseTelegramReplyToMessageId, Jt as projectCredentialSnapshotFields, Qa as resolveTelegramGroupToolPolicy, Ta as listTelegramDirectoryPeersFromConfig, Vn as parseTelegramThreadId, Yt as resolveConfiguredFromCredentialStatuses, Za as resolveTelegramGroupRequireMention, io as resolveTelegramAccount, m as TelegramConfigSchema, no as listTelegramAccountIds, ro as resolveDefaultTelegramAccountId, to as inspectTelegramAccount, wa as listTelegramDirectoryGroupsFromConfig, ys as getChatChannelMeta } from "./thread-bindings-0Uc4GeBT.js";
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
import { B as clearAccountEntryFields, H as setAccountEnabledInConfigSection, V as deleteAccountFromConfigSection } from "./zod-schema.core-De203jOD.js";
import "./redact-BuzJ8kUo.js";
import "./http-registry-BsB8N5w2.js";
import "./pairing-token-DX0HaDzb.js";
import "./ssrf--5Fh_apX.js";
import "./fetch-guard-B43Ufsg7.js";
import { i as resolveDefaultGroupPolicy, r as resolveAllowlistProviderRuntimeGroupPolicy } from "./runtime-group-policy-BhNZLxAr.js";
import "./registry-SHl7cuYc.js";
import "./http-body-Cgn9Rlev.js";
import { t as emptyPluginConfigSchema } from "./config-schema-CSqB9hID.js";
import { o as buildTokenChannelStatusSummary } from "./status-helpers-C9MEGkHs.js";
import "./provider-env-vars-CYpJ3fRA.js";
import { D as applyAccountNameToChannelSection, k as migrateBaseNameToDefaultAccount } from "./helpers-NVV84Qoy.js";
import { i as buildChannelConfigSchema } from "./config-schema-421FYwb5.js";
import { t as PAIRING_APPROVED_MESSAGE } from "./pairing-message-D-ddA7Nz.js";
import "./shared-C_OICyTm.js";
import { i as telegramOnboardingAdapter, n as looksLikeTelegramTargetId, r as normalizeTelegramMessagingTarget, t as collectTelegramStatusIssues } from "./telegram-CCMD33PB.js";
//#region src/channels/plugins/outbound/direct-text-media.ts
function resolvePayloadMediaUrls(payload) {
	return payload.mediaUrls?.length ? payload.mediaUrls : payload.mediaUrl ? [payload.mediaUrl] : [];
}
async function sendPayloadMediaSequence(params) {
	let lastResult;
	for (let i = 0; i < params.mediaUrls.length; i += 1) {
		const mediaUrl = params.mediaUrls[i];
		if (!mediaUrl) continue;
		lastResult = await params.send({
			text: i === 0 ? params.text : "",
			mediaUrl,
			index: i,
			isFirst: i === 0
		});
	}
	return lastResult;
}
//#endregion
//#region src/channels/plugins/outbound/telegram.ts
async function sendTelegramPayloadMessages(params) {
	const telegramData = params.payload.channelData?.telegram;
	const quoteText = typeof telegramData?.quoteText === "string" ? telegramData.quoteText : void 0;
	const text = params.payload.text ?? "";
	const mediaUrls = resolvePayloadMediaUrls(params.payload);
	const payloadOpts = {
		...params.baseOpts,
		quoteText
	};
	if (mediaUrls.length === 0) return await params.send(params.to, text, {
		...payloadOpts,
		buttons: telegramData?.buttons
	});
	return await sendPayloadMediaSequence({
		text,
		mediaUrls,
		send: async ({ text, mediaUrl, isFirst }) => await params.send(params.to, text, {
			...payloadOpts,
			mediaUrl,
			...isFirst ? { buttons: telegramData?.buttons } : {}
		})
	}) ?? {
		messageId: "unknown",
		chatId: params.to
	};
}
//#endregion
export { DEFAULT_ACCOUNT_ID, PAIRING_APPROVED_MESSAGE, TelegramConfigSchema, applyAccountNameToChannelSection, buildChannelConfigSchema, buildTokenChannelStatusSummary, clearAccountEntryFields, collectTelegramStatusIssues, deleteAccountFromConfigSection, emptyPluginConfigSchema, formatPairingApproveHint, getChatChannelMeta, inspectTelegramAccount, listTelegramAccountIds, listTelegramDirectoryGroupsFromConfig, listTelegramDirectoryPeersFromConfig, looksLikeTelegramTargetId, migrateBaseNameToDefaultAccount, normalizeAccountId, normalizeTelegramMessagingTarget, parseTelegramReplyToMessageId, parseTelegramThreadId, projectCredentialSnapshotFields, resolveAllowlistProviderRuntimeGroupPolicy, resolveConfiguredFromCredentialStatuses, resolveDefaultGroupPolicy, resolveDefaultTelegramAccountId, resolveTelegramAccount, resolveTelegramGroupRequireMention, resolveTelegramGroupToolPolicy, sendTelegramPayloadMessages, setAccountEnabledInConfigSection, telegramOnboardingAdapter };
