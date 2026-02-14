import type { AnyMessageContent, WAPresence } from "@whiskeysockets/baileys";
import type { ActiveWebSendOptions } from "../active-listener.js";
import { recordChannelActivity } from "../../infra/channel-activity.js";
import { normalizeE164, toWhatsappJid } from "../../utils.js";
import { resolveBrazilianJid } from "./brazil-jid-resolver.js";
import { getContactPhone, readLidForPhone } from "./contact-names.js";

/**
 * Process @mentions in outbound text for WhatsApp:
 *
 * 1. @+553196348700 or @553196348700 → resolve to display name, add JID to mentions
 * 2. @Lucas or @Guilherme → reverse-lookup phone from contact cache, add JID to mentions
 *
 * The text keeps human-readable @Name; Baileys mentions array gets the JIDs.
 */
export function processOutboundMentions(text: string): { text: string; mentions: string[] } {
  const mentions: string[] = [];
  let result = text;

  const addMention = (digits: string) => {
    // Prefer LID format for group mentions (WhatsApp requires LID for clickable mentions)
    const lidJid = readLidForPhone(digits);
    const jid = lidJid ?? `${digits}@s.whatsapp.net`;
    if (!mentions.includes(jid)) {
      mentions.push(jid);
    }
  };

  // Pass 1: @+phone or @phone patterns → replace with name, collect JID
  const phonePattern = /@(\+?\d{10,15})\b/g;
  const phoneMatches: Array<{ full: string; digits: string; e164: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = phonePattern.exec(text)) !== null) {
    const raw = match[1];
    const digits = raw.replace(/^\+/, "");
    const e164 = normalizeE164(raw) ?? `+${digits}`;
    phoneMatches.push({ full: match[0], digits, e164 });
    addMention(digits);
  }
  for (const m of phoneMatches) {
    // WhatsApp requires @LID_NUMBER in text for clickable mentions in groups
    const lidJid = readLidForPhone(m.digits);
    if (lidJid) {
      const lidNum = lidJid.replace(/@.*/, "");
      result = result.replace(m.full, `@${lidNum}`);
    }
    // If no LID, keep the phone number as-is
  }

  // Pass 2: @Name patterns (non-numeric) → reverse-lookup phone → resolve LID → replace with @LID
  const namePattern = /@([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9_ ]{0,30})\b/g;
  const nameMatches: Array<{ full: string; name: string }> = [];
  while ((match = namePattern.exec(result)) !== null) {
    const name = match[1].trim();
    if (name) {
      nameMatches.push({ full: match[0], name });
    }
  }
  for (const m of nameMatches) {
    const phone = getContactPhone(m.name);
    if (phone) {
      const digits = phone.replace(/^\+/, "");
      const lidJid = readLidForPhone(digits);
      if (lidJid) {
        const lidNum = lidJid.replace(/@.*/, "");
        // WhatsApp expects @LID_NUMBER in text for proper mention rendering
        result = result.replace(m.full, `@${lidNum}`);
        addMention(digits);
      } else {
        addMention(digits);
      }
    }
  }

  return { text: result, mentions };
}

export function createWebSendApi(params: {
  sock: {
    sendMessage: (jid: string, content: AnyMessageContent) => Promise<unknown>;
    sendPresenceUpdate: (presence: WAPresence, jid?: string) => Promise<unknown>;
    onWhatsApp?: (jid: string) => Promise<Array<{ exists?: boolean; jid?: string }>>;
  };
  defaultAccountId: string;
}) {
  const resolveJid = async (to: string): Promise<string> => {
    const jid = toWhatsappJid(to);
    if (!params.sock.onWhatsApp) {
      return jid;
    }
    // Resolve Brazilian numbers that may have legacy 8-digit registration
    try {
      return await resolveBrazilianJid({ onWhatsApp: params.sock.onWhatsApp }, jid);
    } catch (err) {
      console.warn(
        "[send-api] Brazil JID resolution failed, using original:",
        err instanceof Error ? err.message : err,
      );
      return jid;
    }
  };

  return {
    sendMessage: async (
      to: string,
      text: string,
      mediaBuffer?: Buffer,
      mediaType?: string,
      sendOptions?: ActiveWebSendOptions,
    ): Promise<{ messageId: string }> => {
      const jid = await resolveJid(to);
      let payload: AnyMessageContent;
      if (mediaBuffer && mediaType) {
        if (mediaType.startsWith("image/")) {
          payload = {
            image: mediaBuffer,
            caption: text || undefined,
            mimetype: mediaType,
          };
        } else if (mediaType.startsWith("audio/")) {
          payload = { audio: mediaBuffer, ptt: true, mimetype: mediaType };
        } else if (mediaType.startsWith("video/")) {
          const gifPlayback = sendOptions?.gifPlayback;
          payload = {
            video: mediaBuffer,
            caption: text || undefined,
            mimetype: mediaType,
            ...(gifPlayback ? { gifPlayback: true } : {}),
          };
        } else {
          const fileName = sendOptions?.fileName?.trim() || "file";
          payload = {
            document: mediaBuffer,
            fileName,
            caption: text || undefined,
            mimetype: mediaType,
          };
        }
      } else {
        const processed = processOutboundMentions(text);
        payload =
          processed.mentions.length > 0
            ? { text: processed.text, mentions: processed.mentions }
            : { text };
      }
      const result = await params.sock.sendMessage(jid, payload);
      const accountId = sendOptions?.accountId ?? params.defaultAccountId;
      recordChannelActivity({
        channel: "whatsapp",
        accountId,
        direction: "outbound",
      });
      const messageId =
        typeof result === "object" && result && "key" in result
          ? String((result as { key?: { id?: string } }).key?.id ?? "unknown")
          : "unknown";
      return { messageId };
    },
    sendPoll: async (
      to: string,
      poll: { question: string; options: string[]; maxSelections?: number },
    ): Promise<{ messageId: string }> => {
      const jid = await resolveJid(to);
      const result = await params.sock.sendMessage(jid, {
        poll: {
          name: poll.question,
          values: poll.options,
          selectableCount: poll.maxSelections ?? 1,
        },
      } as AnyMessageContent);
      recordChannelActivity({
        channel: "whatsapp",
        accountId: params.defaultAccountId,
        direction: "outbound",
      });
      const messageId =
        typeof result === "object" && result && "key" in result
          ? String((result as { key?: { id?: string } }).key?.id ?? "unknown")
          : "unknown";
      return { messageId };
    },
    sendReaction: async (
      chatJid: string,
      messageId: string,
      emoji: string,
      fromMe: boolean,
      participant?: string,
    ): Promise<void> => {
      const jid = await resolveJid(chatJid);
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
      } as AnyMessageContent);
    },
    sendComposingTo: async (to: string): Promise<void> => {
      const jid = await resolveJid(to);
      await params.sock.sendPresenceUpdate("composing", jid);
    },
  } as const;
}
