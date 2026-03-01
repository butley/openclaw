# Patch: WhatsApp Paragraph Streaming + /stream Command

**Status:** WIP
**Branch:** `streaming-wip`
**Commit:** `e6f586b31`

## What it does

Adds per-session `/stream` (alias `/str`) command to control how WhatsApp messages are delivered:

- **off** — entire response as one message
- **on** — paragraph-by-paragraph with 40ms/char reading delay
- **fast** — 20ms/char delay
- **slow** — 70ms/char delay
- **\<number\>** — custom ms/char (1–200)

Also includes `/verbose light` for tool narration (inline mono summaries).

## How it works

The delivery layer (`deliver-reply.ts`) splits text on `\n\n` when streaming is active and paces each paragraph with a typing indicator + proportional delay. When streaming is off, delivery sends as one message (`chunkMode: "length"`).

This is NOT agent-runner block streaming — the agent generates the full text, then delivery handles the pacing.

## Files modified (17)

| File | Purpose |
|------|---------|
| `src/auto-reply/thinking.ts` | `StreamLevel` type + `normalizeStreamLevel` accepts numbers (1-200) |
| `src/auto-reply/reply/directives.ts` | `matchLevelDirective` regex `[A-Za-z0-9-]` + `extractStreamDirective` |
| `src/auto-reply/reply/directive-handling.impl.ts` | Stream ack messages (incl. custom ms/char) |
| `src/auto-reply/reply/directive-handling.parse.ts` | Parse `/stream` directive from message body |
| `src/auto-reply/reply/directive-handling.persist.ts` | Persist `streamLevel` to session store |
| `src/auto-reply/reply/get-reply-directives.ts` | Wire `_resolvedStreamLevel` + `hasStreamDirective` |
| `src/auto-reply/reply/get-reply-directives-apply.ts` | Apply stream directive in reply flow |
| `src/auto-reply/reply/get-reply-directives-utils.ts` | Default `hasStreamDirective: false` |
| `src/auto-reply/status.ts` | Show stream level in `/status` |
| `src/config/sessions/types.ts` | `streamLevel` field on session entry |
| `src/tui/commands.ts` | `/stream` in TUI command list |
| `src/tui/tui-command-handlers.ts` | TUI stream command handler |
| `src/agents/pi-embedded-subscribe.ts` | `verbose: "light"` enables tool result emission |
| `src/web/auto-reply/deliver-reply.ts` | `streamDelayMs` param + typing + delay between chunks |
| `src/web/auto-reply/monitor/process-message.ts` | `effectiveChunkMode` + `streamDelayMs` + `readSessionStreamLevel` + `sendAvailable` + `onReplyStart` |
| `src/web/inbound/monitor.ts` | `sendAvailable` presence function |
| `src/web/inbound/types.ts` | `sendAvailable` on `WebInboundMessage` type |

## Grep verification

```bash
grep -r "resolveStreamDelayMs" src/web/auto-reply/monitor/process-message.ts
grep -r "effectiveChunkMode" src/web/auto-reply/monitor/process-message.ts
grep -r "streamDelayMs" src/web/auto-reply/deliver-reply.ts
grep -r "sendAvailable" src/web/inbound/monitor.ts
grep -r "custom:" src/auto-reply/thinking.ts
grep -r "A-Za-z0-9" src/auto-reply/reply/directives.ts
grep -r "normalizeStreamLevel" src/auto-reply/thinking.ts
```

## Config requirements

```json
{
  "channels": {
    "whatsapp": {
      "blockStreaming": true,
      "chunkMode": "newline"
    }
  }
}
```

## Known gotchas

1. `readSessionStreamLevel` must NOT re-normalize `custom:N` values — `parseInt("custom:55")` = NaN
2. `matchLevelDirective` regex must include `0-9` — numbers in args were silently dropped
3. Delivery layer does the splitting, not block streaming — agent text arrives too fast
4. `effectiveChunkMode` must be `"length"` when off — prevents unwanted paragraph splitting
5. `onReplyStart: params.msg.sendComposing` must be present — typing indicator for initial processing
