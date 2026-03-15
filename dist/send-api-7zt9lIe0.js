import { t as __exportAll } from "./rolldown-runtime-DUslC3ob.js";
import { d as normalizeE164, x as toWhatsappJid } from "./utils-B2AOQkdJ.js";
import { n as recordChannelActivity } from "./channel-activity-DVuTt2Mq.js";
import { t as resolveBrazilianJid } from "./brazil-jid-resolver-CTtbjVDr.js";
import fsSync from "node:fs";
import path from "node:path";
//#region src/web/inbound/contact-names.ts
/**
* Global contact name cache, populated from incoming messages (pushName).
* Persisted to disk so it survives gateway restarts.
* Used by outbound to resolve phone numbers to display names for @mentions.
*/
const contactNames = /* @__PURE__ */ new Map();
let cacheFilePath = null;
let savePending = false;
function defaultCachePath() {
	return path.join(process.env.HOME ?? "/home/ubuntu", ".openclaw/credentials/whatsapp/default/contact-names.json");
}
/** Load persisted contact names from disk. Called once at startup. */
function loadContactNameCache(filePath) {
	cacheFilePath = filePath ?? defaultCachePath();
	try {
		const data = fsSync.readFileSync(cacheFilePath, "utf8");
		const parsed = JSON.parse(data);
		for (const [phone, name] of Object.entries(parsed)) contactNames.set(phone, name);
	} catch {}
}
function scheduleSave() {
	if (savePending || !cacheFilePath) return;
	savePending = true;
	setTimeout(() => {
		savePending = false;
		try {
			const obj = {};
			for (const [k, v] of contactNames) obj[k] = v;
			fsSync.writeFileSync(cacheFilePath, JSON.stringify(obj, null, 2));
		} catch {}
	}, 5e3);
}
/**
* Record a contact's display name (typically from pushName on incoming messages).
*/
function noteContactName(e164, name) {
	if (!e164 || !name) return;
	const normalized = normalizeE164(e164);
	if (normalized) {
		if (contactNames.get(normalized) !== name) {
			contactNames.set(normalized, name);
			scheduleSave();
		}
	}
}
/**
* Reverse lookup: find a phone number (E164) by display name.
* Case-insensitive match. Returns the first match found.
*/
function getContactPhone(name) {
	const lower = name.toLowerCase();
	for (const [phone, contactName] of contactNames.entries()) if (contactName.toLowerCase() === lower) return phone;
	for (const [phone, contactName] of contactNames.entries()) if (contactName.toLowerCase().startsWith(lower)) return phone;
}
/**
* Read the LID for a phone number from the WhatsApp auth directory's lid-mapping files.
* Returns the LID JID (e.g., "264351109914877@lid") or undefined if not found.
*/
function readLidForPhone(phone, authDir) {
	const digits = phone.replace(/[^\d]/g, "");
	if (!digits) return;
	const dirs = authDir ? [authDir] : [];
	const defaultDir = path.join(process.env.HOME ?? "/home/ubuntu", ".openclaw/credentials/whatsapp/default");
	if (!dirs.includes(defaultDir)) dirs.push(defaultDir);
	for (const dir of dirs) {
		const filePath = path.join(dir, `lid-mapping-${digits}.json`);
		try {
			const data = fsSync.readFileSync(filePath, "utf8");
			const lid = JSON.parse(data);
			if (lid) return `${lid}@lid`;
		} catch {}
	}
}
//#endregion
//#region src/web/inbound/send-api.ts
var send_api_exports = /* @__PURE__ */ __exportAll({
	createWebSendApi: () => createWebSendApi,
	processOutboundMentions: () => processOutboundMentions
});
function recordWhatsAppOutbound(accountId) {
	recordChannelActivity({
		channel: "whatsapp",
		accountId,
		direction: "outbound"
	});
}
function resolveOutboundMessageId(result) {
	return typeof result === "object" && result && "key" in result ? String(result.key?.id ?? "unknown") : "unknown";
}
/**
* Process @mentions in outbound text for WhatsApp:
*
* 1. @+553196348700 or @553196348700 → resolve to display name, add JID to mentions
* 2. @Lucas or @Guilherme → reverse-lookup phone from contact cache, add JID to mentions
*
* The text keeps human-readable @Name; Baileys mentions array gets the JIDs.
*/
function processOutboundMentions(text) {
	const mentions = [];
	let result = text;
	const addMention = (digits) => {
		const jid = readLidForPhone(digits) ?? `${digits}@s.whatsapp.net`;
		if (!mentions.includes(jid)) mentions.push(jid);
	};
	const phonePattern = /@(\+?\d{10,15})\b/g;
	const phoneMatches = [];
	let match;
	while ((match = phonePattern.exec(text)) !== null) {
		const raw = match[1];
		const digits = raw.replace(/^\+/, "");
		const e164 = normalizeE164(raw) ?? `+${digits}`;
		phoneMatches.push({
			full: match[0],
			digits,
			e164
		});
		addMention(digits);
	}
	for (const m of phoneMatches) {
		const lidJid = readLidForPhone(m.digits);
		if (lidJid) {
			const lidNum = lidJid.replace(/@.*/, "");
			result = result.replace(m.full, `@${lidNum}`);
		}
	}
	const namePattern = /@([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9_ ]{0,30})\b/g;
	const nameMatches = [];
	while ((match = namePattern.exec(result)) !== null) {
		const name = match[1].trim();
		if (name) nameMatches.push({
			full: match[0],
			name
		});
	}
	for (const m of nameMatches) {
		const phone = getContactPhone(m.name);
		if (phone) {
			const digits = phone.replace(/^\+/, "");
			const lidJid = readLidForPhone(digits);
			if (lidJid) {
				const lidNum = lidJid.replace(/@.*/, "");
				result = result.replace(m.full, `@${lidNum}`);
				addMention(digits);
			} else addMention(digits);
		}
	}
	return {
		text: result,
		mentions
	};
}
function createWebSendApi(params) {
	const resolveJid = async (to) => {
		const jid = toWhatsappJid(to);
		if (!params.sock.onWhatsApp) return jid;
		try {
			return await resolveBrazilianJid({ onWhatsApp: params.sock.onWhatsApp }, jid);
		} catch (err) {
			console.warn("[send-api] Brazil JID resolution failed, using original:", err instanceof Error ? err.message : err);
			return jid;
		}
	};
	return {
		sendMessage: async (to, text, mediaBuffer, mediaType, sendOptions) => {
			const jid = await resolveJid(to);
			let payload;
			if (mediaBuffer && mediaType) if (mediaType.startsWith("image/")) payload = {
				image: mediaBuffer,
				caption: text || void 0,
				mimetype: mediaType
			};
			else if (mediaType.startsWith("audio/")) payload = {
				audio: mediaBuffer,
				ptt: true,
				mimetype: mediaType
			};
			else if (mediaType.startsWith("video/")) {
				const gifPlayback = sendOptions?.gifPlayback;
				payload = {
					video: mediaBuffer,
					caption: text || void 0,
					mimetype: mediaType,
					...gifPlayback ? { gifPlayback: true } : {}
				};
			} else payload = {
				document: mediaBuffer,
				fileName: sendOptions?.fileName?.trim() || "file",
				caption: text || void 0,
				mimetype: mediaType
			};
			else {
				const processed = processOutboundMentions(text);
				payload = processed.mentions.length > 0 ? {
					text: processed.text,
					mentions: processed.mentions
				} : { text };
			}
			const result = await params.sock.sendMessage(jid, payload);
			recordWhatsAppOutbound(sendOptions?.accountId ?? params.defaultAccountId);
			return { messageId: resolveOutboundMessageId(result) };
		},
		sendPoll: async (to, poll) => {
			const jid = await resolveJid(to);
			const result = await params.sock.sendMessage(jid, { poll: {
				name: poll.question,
				values: poll.options,
				selectableCount: poll.maxSelections ?? 1
			} });
			recordWhatsAppOutbound(params.defaultAccountId);
			return { messageId: resolveOutboundMessageId(result) };
		},
		sendReaction: async (chatJid, messageId, emoji, fromMe, participant) => {
			const jid = await resolveJid(chatJid);
			await params.sock.sendMessage(jid, { react: {
				text: emoji,
				key: {
					remoteJid: jid,
					id: messageId,
					fromMe,
					participant: participant ? toWhatsappJid(participant) : void 0
				}
			} });
		},
		sendComposingTo: async (to) => {
			const jid = await resolveJid(to);
			await params.sock.sendPresenceUpdate("composing", jid);
		}
	};
}
//#endregion
export { noteContactName as i, send_api_exports as n, loadContactNameCache as r, createWebSendApi as t };
