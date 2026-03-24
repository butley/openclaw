# P11 — WA Paragraph Streaming

**Branch:** `feat/rebase-3.22`
**Type:** Own helpers + hook
**Files:** `extensions/whatsapp/src/auto-reply/deliver-reply.ts` (hook), WA streaming utils

## What It Does

`/stream` (`/str`) command — paragraph-by-paragraph delivery on WhatsApp with configurable reading-time delays and typing indicators between paragraphs.

| Level | Delay | Command |
|-------|-------|---------|
| `off` | 0 | `/str off` |
| `fast` | 20ms/char (2-6s) | `/str fast` |
| `on` | 40ms/char (4-10s) | `/str on` |
| `slow` | 70ms/char (6-15s) | `/str slow` |
| custom | Nms/char (1-20s) | `/str 55` |

## Architecture

Agent runner has `blockStreaming: true`. Text arrives as `kind=block` events. Delay runs between blocks in `process-message.ts` deliver callback. `deliver-reply.ts` has a fallback delay loop for `kind=final` (safety net if block streaming disabled).

Requires config: `blockStreaming: true` + `chunkMode: "newline"`.

## Merge Resilience

**Zero conflict** — own helpers. Hook in `deliver-reply.ts` is additive.

## Verify

```bash
grep -q 'streamDelayMs' extensions/whatsapp/src/auto-reply/deliver-reply.ts && echo "OK" || echo "MISSING"
```

## Author

Bob — WA sends walls of text, paragraph streaming UX.
