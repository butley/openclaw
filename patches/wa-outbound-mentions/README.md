# WhatsApp Outbound @Mention Support (LID Resolution)

**Patch:** `whatsapp-outbound-mentions.patch`
**Commits:** `50eabdbe1`, `890b91946`, `7a9a78d30`, `0b797aacd`
**Date:** 2026-02-08

## Problem

WhatsApp migrated group mentions from phone JIDs (`553196348700@s.whatsapp.net`) to LIDs (Linked IDs, e.g., `264351109914877@lid`). When a bot sends `@+553196348700` with `mentions: ["553196348700@s.whatsapp.net"]`, WhatsApp renders it as plain text — not a clickable mention.

## Solution

### 1. Contact Name Cache (`src/web/inbound/contact-names.ts`) — NEW FILE

Persistent cache mapping phone numbers to display names, populated from incoming messages' `pushName` field. Provides:
- `noteContactName(phone, name)` — record a contact (auto-saves to disk)
- `loadContactNameCache()` — load cache from disk on startup
- `getContactName(phone)` — phone → name lookup
- `getContactPhone(name)` — reverse name → phone lookup (case-insensitive, prefix match)
- `readLidForPhone(phone)` — reads LID from Baileys' `lid-mapping-{phone}.json` files

Cache persists to `~/.openclaw/credentials/whatsapp/default/contact-names.json` and survives gateway restarts.

### 2. Outbound Mention Processing (`src/web/inbound/send-api.ts`) — MODIFIED

New exported `processOutboundMentions(text)` function that:

1. **Detects `@+phone` / `@phone` patterns** → resolves phone to LID → replaces text with `@LID_NUMBER` → adds `LID@lid` to Baileys mentions array
2. **Detects `@Name` patterns** → reverse-lookups name → phone via contact cache → resolves to LID → replaces text with `@LID_NUMBER` → adds to mentions array

Applied in two code paths:
- `send-api.ts` text payload (message tool / sendMessageWhatsApp)
- `monitor.ts` inline reply callback (auto-reply / deliver-reply)

### 3. Cache Population & Loading (`src/web/inbound/monitor.ts`) — MODIFIED

- `noteContactName(senderE164, senderName)` called on every incoming message
- `loadContactNameCache()` called on gateway startup (WhatsApp connect)
- Inline `reply()` callback now uses `processOutboundMentions()` for proper mention rendering

## Key Discovery

WhatsApp requires **both** for clickable mentions in groups:
- `mentionedJid` array in contextInfo → must use `LID@lid` format
- Message text → must contain `@LID_NUMBER` (WhatsApp client auto-replaces with display name)

Using phone JID (`@s.whatsapp.net`) or display name (`@Lucas`) in either field does NOT produce clickable mentions.

## Files

| File | Status | Description |
|------|--------|-------------|
| `src/web/inbound/contact-names.ts` | NEW | Persistent contact name cache + LID resolver |
| `src/web/inbound/send-api.ts` | MODIFIED | processOutboundMentions() — exported, used in text payload path |
| `src/web/inbound/monitor.ts` | MODIFIED | loadContactNameCache() on startup, noteContactName() on inbound, processOutboundMentions() on inline reply |

## Apply to Vanilla OpenClaw

```bash
cd /path/to/openclaw
git apply patches/whatsapp-outbound-mentions/whatsapp-outbound-mentions.patch
pnpm run build
systemctl --user restart openclaw-gateway.service
```

## Limitations

- Contact names populate only after receiving at least one message from each contact (persisted across restarts)
- LID mapping files must exist in the Baileys auth directory (created automatically during normal WhatsApp operation)
- If no LID mapping exists for a phone number, falls back to `phone@s.whatsapp.net` (mention linked but shows number instead of name)
