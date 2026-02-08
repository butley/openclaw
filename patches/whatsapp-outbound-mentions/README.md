# WhatsApp Outbound @Mention Support (LID Resolution)

**Patch:** `0001-feat-whatsapp-outbound-mention-support-with-LID-reso.patch`
**Commit:** `50eabdbe1` (butley/openclaw dev branch)
**Date:** 2026-02-08

## Problem

WhatsApp migrated group mentions from phone JIDs (`553196348700@s.whatsapp.net`) to LIDs (Linked IDs, e.g., `264351109914877@lid`). When a bot sends `@+553196348700` with `mentions: ["553196348700@s.whatsapp.net"]`, WhatsApp renders it as plain text — not a clickable mention.

## Solution

Three-part fix:

### 1. Contact Name Cache (`src/web/inbound/contact-names.ts`) — NEW FILE

In-memory cache mapping phone numbers to display names, populated from incoming messages' `pushName` field. Also provides:
- `getContactName(phone)` — phone → name lookup
- `getContactPhone(name)` — reverse name → phone lookup
- `readLidForPhone(phone)` — reads LID from Baileys' `lid-mapping-{phone}.json` files in the auth directory

### 2. Outbound Mention Processing (`src/web/inbound/send-api.ts`) — MODIFIED

New `processOutboundMentions(text)` function that:

1. **Detects `@+phone` / `@phone` patterns** → resolves phone to LID via mapping files → replaces text with `@LID_NUMBER` → adds `LID@lid` to Baileys mentions array
2. **Detects `@Name` patterns** → reverse-lookups name → phone via contact cache → resolves to LID → replaces text with `@LID_NUMBER` → adds to mentions array

The payload sent to Baileys becomes:
```json
{
  "text": "Hey @264351109914877, check this out",
  "mentions": ["264351109914877@lid"]
}
```

WhatsApp renders `@264351109914877` as `@Lucas` (clickable, blue) automatically.

### 3. Cache Population (`src/web/inbound/monitor.ts`) — MODIFIED

Added `noteContactName(senderE164, senderName)` call when processing incoming messages, so the contact cache gets populated as messages arrive.

## Key Discovery

WhatsApp requires **both**:
- `mentionedJid` array in contextInfo → must use `LID@lid` format
- Message text → must contain `@LID_NUMBER` (WhatsApp client replaces with display name)

Using phone JID (`@s.whatsapp.net`) or display name (`@Lucas`) in either field does NOT produce clickable mentions in groups.

## Limitations

- Contact cache is in-memory only — resets on gateway restart
- Names populate only after receiving at least one message from each contact
- LID mapping files must exist in the Baileys auth directory (created automatically by Baileys during normal operation)
- If no LID mapping exists for a phone number, falls back to `phone@s.whatsapp.net` (non-clickable)

## Files

| File | Status | Description |
|------|--------|-------------|
| `src/web/inbound/contact-names.ts` | NEW | Contact name cache + LID resolver |
| `src/web/inbound/send-api.ts` | MODIFIED | processOutboundMentions() in text payload path |
| `src/web/inbound/monitor.ts` | MODIFIED | noteContactName() on incoming messages |

## Apply

```bash
cd /path/to/openclaw
git apply patches/whatsapp-outbound-mentions/0001-feat-whatsapp-outbound-mention-support-with-LID-reso.patch
pnpm run build
systemctl --user restart openclaw-gateway.service
```
