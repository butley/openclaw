import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLAWDBOT_DIR = path.join(process.env.HOME, '.npm-global/lib/node_modules/clawdbot/dist');
const FILE_PATH = path.join(CLAWDBOT_DIR, 'auto-reply/reply/dispatch-from-config.js');

let content = fs.readFileSync(FILE_PATH, 'utf-8');

// Check if already patched
if (content.includes('emitInboundMessageEvent')) {
  console.log('   ⚠ Already patched, skipping');
  process.exit(0);
}

// 1. Add import after the tts.js import
const importLine = 'import { emitInboundMessageEvent } from "../../infra/inbound-events.js";';
content = content.replace(
  /import \{ maybeApplyTtsToPayload, normalizeTtsAutoMode \} from "\.\.\/\.\.\/tts\/tts\.js";/,
  `import { maybeApplyTtsToPayload, normalizeTtsAutoMode } from "../../tts/tts.js";\n${importLine}`
);

// 2. Add emit call before hookRunner
const emitCode = `
    // PATCH: Emit inbound message event for WebSocket broadcast
    const timestampForEmit = typeof ctx.Timestamp === "number" && Number.isFinite(ctx.Timestamp) ? ctx.Timestamp : undefined;
    const messageIdForEmit = ctx.MessageSidFull ?? ctx.MessageSid ?? ctx.MessageSidFirst ?? ctx.MessageSidLast;
    const contentForEmit = typeof ctx.BodyForCommands === "string" ? ctx.BodyForCommands : typeof ctx.RawBody === "string" ? ctx.RawBody : typeof ctx.Body === "string" ? ctx.Body : "";
    const channelIdForEmit = (ctx.OriginatingChannel ?? ctx.Surface ?? ctx.Provider ?? "").toLowerCase();
    const conversationIdForEmit = ctx.OriginatingTo ?? ctx.To ?? ctx.From ?? undefined;
    emitInboundMessageEvent({
        messageId: messageIdForEmit,
        sessionKey,
        channel: channelIdForEmit,
        accountId: ctx.AccountId,
        from: ctx.From ?? "",
        senderName: ctx.SenderName,
        content: contentForEmit,
        timestamp: timestampForEmit,
        chatType: ctx.ChatType === "group" ? "group" : "dm",
        conversationId: conversationIdForEmit,
        threadId: ctx.MessageThreadId,
        hasMedia: Boolean(ctx.MediaType || ctx.MediaTypes?.length),
        mediaType: ctx.MediaType,
        metadata: { to: ctx.To, provider: ctx.Provider, surface: ctx.Surface, senderId: ctx.SenderId, senderUsername: ctx.SenderUsername, senderE164: ctx.SenderE164 },
    });
`;

content = content.replace(
  /(\s+const hookRunner = getGlobalHookRunner\(\);)/,
  emitCode + '$1'
);

fs.writeFileSync(FILE_PATH, content);
console.log('   Patched successfully');
