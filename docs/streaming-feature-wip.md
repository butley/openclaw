# WhatsApp Streaming Feature (WIP)

**Branch:** `alpha` (butley/openclaw fork)
**Last updated:** 2026-03-01

---

## Overview

Controls how WhatsApp messages are delivered: all at once or paragraph-by-paragraph with reading-time delays.

## User Commands

| Command                       | Effect                                         |
| ----------------------------- | ---------------------------------------------- |
| `/stream off` or `/str off`   | Send entire response as one message            |
| `/stream on` or `/str on`     | Paragraph streaming, 40ms/char delay (default) |
| `/stream fast` or `/str fast` | Paragraph streaming, 20ms/char delay           |
| `/stream slow` or `/str slow` | Paragraph streaming, 70ms/char delay           |
| `/stream 55` or `/str 55`     | Paragraph streaming, custom 55ms/char delay    |

Numbers accept 1–200 (ms per character).

## How It Works

### Stream Off (default)

- Agent generates full response
- Delivery layer sends as **one WhatsApp message** (only splits if exceeding 4000 char limit)
- `chunkMode: "length"` used in delivery
- No typing indicator delays

### Stream On / Fast / Slow / Custom

- Agent generates full response
- Delivery layer splits text on `\n\n` (paragraph boundaries) via `chunkMode: "newline"`
- Each paragraph sent as a **separate WhatsApp message**
- Between paragraphs: typing indicator (`composing`) + proportional delay
- After last paragraph: `sendAvailable` clears typing indicator

### Delay Calculation

Delay is based on the **previous paragraph's length** (reading time for what was just sent):

| Level    | Formula      | Min | Max |
| -------- | ------------ | --- | --- |
| fast     | chars × 20ms | 2s  | 6s  |
| on       | chars × 40ms | 4s  | 10s |
| slow     | chars × 70ms | 6s  | 15s |
| custom:N | chars × Nms  | 1s  | 20s |

- First paragraph: no delay (sent immediately)
- Typing indicator refreshes every 3s during delay to stay visible

## Architecture

### Key Insight

The streaming effect is achieved in the **delivery layer** (`deliver-reply.ts`), NOT via the agent runner's block streaming. The agent generates the complete text, then the delivery layer splits and paces it.

### Config Requirements

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

- `chunkMode: "newline"` — enables paragraph splitting in delivery AND `flushOnParagraph` in block chunker
- `blockStreaming: true` — enables block streaming capability for the channel

### Session Persistence

Stream level is stored per-session in `sessions.json` as `streamLevel` field. Values: `"off"`, `"fast"`, `"on"`, `"slow"`, `"custom:N"`.

### Files Modified

| File                                              | Change                                                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/auto-reply/thinking.ts`                      | `StreamLevel` type + `normalizeStreamLevel` accepts numbers                                                                                                |
| `src/auto-reply/reply/directives.ts`              | `matchLevelDirective` regex accepts `[A-Za-z0-9-]` for numeric args                                                                                        |
| `src/auto-reply/reply/directive-handling.impl.ts` | Ack message shows custom ms/char value                                                                                                                     |
| `src/web/auto-reply/monitor/process-message.ts`   | `effectiveChunkMode` conditional + `streamDelayMs` passed to delivery + `readSessionStreamLevel` handles `custom:` values + `sendAvailable` after delivery |
| `src/web/auto-reply/deliver-reply.ts`             | `streamDelayMs` param + typing indicator + delay loop between chunks                                                                                       |
| `src/web/inbound/monitor.ts`                      | `sendAvailable` presence function                                                                                                                          |
| `src/web/inbound/types.ts`                        | `sendAvailable` on `WebInboundMessage` type                                                                                                                |

### Gotchas

1. **`readSessionStreamLevel` must not re-normalize `custom:` values** — `normalizeStreamLevel("custom:55")` fails because `parseInt("custom:55")` = NaN. The stored value is already normalized.
2. **`matchLevelDirective` regex must include digits** — original `[A-Za-z-]` excluded numbers, so `/str 99` was detected as directive but raw level was `undefined`.
3. **Delivery layer does the splitting, not block streaming** — agent text arrives too fast for the block chunker to split meaningfully. The delivery layer's `chunkMarkdownTextWithMode` with `"newline"` mode handles paragraph splitting.
4. **`effectiveChunkMode` must be `"length"` when stream is off** — otherwise `chunkMode: "newline"` in config causes paragraph splitting even when user wants one message.

## TODO

- [ ] Make default stream level configurable per-agent (`agents.defaults.streamLevel`)
- [ ] Per-group stream level overrides
- [ ] Upstream PR (clean version without fork-specific code)
- [ ] Agent-to-agent bypass (skip delays when bot @mentions another agent)
