# P2 — Brazil JID Resolution

**Branch:** `feat/rebase-3.22`
**Type:** Own file + send hook
**Files:** `extensions/whatsapp/src/inbound/brazil-jid-resolver.ts` (new), `extensions/whatsapp/src/send.ts` (hook)

## Problem

Brazilian mobile numbers transitioned from 8→9 digits (~2012-2016). WhatsApp accounts may be registered with either format. Sending to the wrong format = silent delivery failure.

Example: `+5511999998888` (9-digit) vs `551199998888` (8-digit legacy).

## Solution

Uses Baileys' `onWhatsApp()` to query which format is actually registered, caches result for 7 days. Called in the send path before delivery.

## Files

| File | Role |
|------|------|
| `extensions/whatsapp/src/inbound/brazil-jid-resolver.ts` | NEW — resolver module (queries variants, caches results) |
| `extensions/whatsapp/src/send.ts` | Import + call `resolveJidWithBrazil()` before sending |

## Merge Resilience

**Zero conflict** — own file. Only hook is a single import + call in `send.ts`.

## Verify

```bash
test -f extensions/whatsapp/src/inbound/brazil-jid-resolver.ts && echo "OK" || echo "MISSING"
grep -q 'resolveJidWithBrazil' extensions/whatsapp/src/send.ts && echo "OK" || echo "MISSING"
```

## Author

Bob — Brazilian +55 delivery failures (2026-02).
