//#region src/cli/outbound-send-mapping.ts
function createOutboundSendDepsFromCliSource(deps) {
	return {
		sendWhatsApp: deps.sendMessageWhatsApp,
		sendTelegram: deps.sendMessageTelegram,
		sendDiscord: deps.sendMessageDiscord,
		sendSlack: deps.sendMessageSlack,
		sendSignal: deps.sendMessageSignal,
		sendIMessage: deps.sendMessageIMessage
	};
}
//#endregion
//#region src/cli/deps.ts
let whatsappSenderRuntimePromise = null;
let telegramSenderRuntimePromise = null;
let discordSenderRuntimePromise = null;
let slackSenderRuntimePromise = null;
let signalSenderRuntimePromise = null;
let imessageSenderRuntimePromise = null;
function loadWhatsAppSenderRuntime() {
	whatsappSenderRuntimePromise ??= import("./deps-send-whatsapp.runtime-BQsuG0vb.js");
	return whatsappSenderRuntimePromise;
}
function loadTelegramSenderRuntime() {
	telegramSenderRuntimePromise ??= import("./deps-send-telegram.runtime-DIaxyNHg.js");
	return telegramSenderRuntimePromise;
}
function loadDiscordSenderRuntime() {
	discordSenderRuntimePromise ??= import("./deps-send-discord.runtime-CJ7oKP1a.js");
	return discordSenderRuntimePromise;
}
function loadSlackSenderRuntime() {
	slackSenderRuntimePromise ??= import("./deps-send-slack.runtime-DKUKiurQ.js");
	return slackSenderRuntimePromise;
}
function loadSignalSenderRuntime() {
	signalSenderRuntimePromise ??= import("./deps-send-signal.runtime-_0uDUL7Z.js");
	return signalSenderRuntimePromise;
}
function loadIMessageSenderRuntime() {
	imessageSenderRuntimePromise ??= import("./deps-send-imessage.runtime-DvPCwAd5.js");
	return imessageSenderRuntimePromise;
}
function createDefaultDeps() {
	return {
		sendMessageWhatsApp: async (...args) => {
			const { sendMessageWhatsApp } = await loadWhatsAppSenderRuntime();
			return await sendMessageWhatsApp(...args);
		},
		sendMessageTelegram: async (...args) => {
			const { sendMessageTelegram } = await loadTelegramSenderRuntime();
			return await sendMessageTelegram(...args);
		},
		sendMessageDiscord: async (...args) => {
			const { sendMessageDiscord } = await loadDiscordSenderRuntime();
			return await sendMessageDiscord(...args);
		},
		sendMessageSlack: async (...args) => {
			const { sendMessageSlack } = await loadSlackSenderRuntime();
			return await sendMessageSlack(...args);
		},
		sendMessageSignal: async (...args) => {
			const { sendMessageSignal } = await loadSignalSenderRuntime();
			return await sendMessageSignal(...args);
		},
		sendMessageIMessage: async (...args) => {
			const { sendMessageIMessage } = await loadIMessageSenderRuntime();
			return await sendMessageIMessage(...args);
		}
	};
}
function createOutboundSendDeps(deps) {
	return createOutboundSendDepsFromCliSource(deps);
}
//#endregion
export { createOutboundSendDeps as n, createOutboundSendDepsFromCliSource as r, createDefaultDeps as t };
