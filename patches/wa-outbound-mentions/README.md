# P14 — WhatsApp Outbound @Mention Support

**Branch:** `feat/rebase-3.22`
**Type:** Isolated transform
**Files:** `extensions/whatsapp/src/inbound/send-api.ts`, `extensions/whatsapp/src/inbound/contact-names.ts` (new)

## What It Does

Processes `@+phone` / `@Name` patterns in outbound WA messages → resolves to LID (Linked ID) → replaces text with `@LID_NUMBER` → adds `LID@lid` to Baileys mentions array. Makes @mentions render as green clickable highlights.

## Key Discovery

WhatsApp requires BOTH for clickable mentions:
- `mentionedJid` array → must use `LID@lid` format
- Message text → must contain `@LID_NUMBER`

Phone JID (`@s.whatsapp.net`) or display name in either field does NOT work.

## Contact Name Cache

`contact-names.ts` — persistent cache mapping phone→name, populated from `pushName` on incoming messages. Provides reverse `name→phone` lookup and LID resolution from Baileys mapping files.

## ⚠️ Known Bug

False positives in DMs: `processOutboundMentions` injects all `@` occurrences as mentions without validating they're real JIDs. Fix needed: validate against session contact list.

## Merge Resilience

**Zero conflict** — own file for cache. Hook in `send-api.ts` is isolated.

## Verify

```bash
grep -q 'processOutboundMentions' extensions/whatsapp/src/inbound/send-api.ts && echo "OK" || echo "MISSING"
```

## Author

Bob — WA @mentions formatting.
