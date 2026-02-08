import { recordChannelActivity } from "../../infra/channel-activity.js";
import { toWhatsappJid } from "../../utils.js";

// Brazil JID Resolution - START
import { resolveBrazilianJid } from "./brazil-jid-resolver.mjs";

async function resolveJid(sock, to) {
    const jid = toWhatsappJid(to);
    // Resolve Brazilian numbers that may have legacy 8-digit registration
    try {
        return await resolveBrazilianJid(sock, jid);
    } catch (err) {
        console.warn('[send-api] Brazil JID resolution failed, using original:', err.message);
        return jid;
    }
}
// Brazil JID Resolution - END

export function createWebSendApi(params) {
    return {
        sendMessage: async (to, text, mediaBuffer, mediaType, sendOptions) => {
            const jid = await resolveJid(params.sock, to);
            let payload;
            if (mediaBuffer && mediaType) {
                if (mediaType.startsWith("image/")) {
                    payload = {
                        image: mediaBuffer,
                        caption: text || undefined,
                        mimetype: mediaType,
                    };
                }
                else if (mediaType.startsWith("audio/")) {
                    payload = { audio: mediaBuffer, ptt: true, mimetype: mediaType };
                }
                else if (mediaType.startsWith("video/")) {
                    const gifPlayback = sendOptions?.gifPlayback;
                    payload = {
                        video: mediaBuffer,
                        caption: text || undefined,
                        mimetype: mediaType,
                        ...(gifPlayback ? { gifPlayback: true } : {}),
                    };
                }
                else {
                    payload = {
                        document: mediaBuffer,
                        fileName: "file",
                        caption: text || undefined,
                        mimetype: mediaType,
                    };
                }
            }
            else {
                payload = { text };
            }
            const result = await params.sock.sendMessage(jid, payload);
            const accountId = sendOptions?.accountId ?? params.defaultAccountId;
            recordChannelActivity({
                channel: "whatsapp",
                accountId,
                direction: "outbound",
            });
            const messageId = typeof result === "object" && result && "key" in result
                ? String(result.key?.id ?? "unknown")
                : "unknown";
            return { messageId };
        },
        sendPoll: async (to, poll) => {
            const jid = await resolveJid(params.sock, to);
            const result = await params.sock.sendMessage(jid, {
                poll: {
                    name: poll.question,
                    values: poll.options,
                    selectableCount: poll.maxSelections ?? 1,
                },
            });
            recordChannelActivity({
                channel: "whatsapp",
                accountId: params.defaultAccountId,
                direction: "outbound",
            });
            const messageId = typeof result === "object" && result && "key" in result
                ? String(result.key?.id ?? "unknown")
                : "unknown";
            return { messageId };
        },
        sendReaction: async (chatJid, messageId, emoji, fromMe, participant) => {
            const jid = await resolveJid(params.sock, chatJid);
            await params.sock.sendMessage(jid, {
                react: {
                    text: emoji,
                    key: {
                        remoteJid: jid,
                        id: messageId,
                        fromMe,
                        participant: participant ? toWhatsappJid(participant) : undefined,
                    },
                },
            });
        },
        sendComposingTo: async (to) => {
            const jid = await resolveJid(params.sock, to);
            await params.sock.sendPresenceUpdate("composing", jid);
        },
    };
}
