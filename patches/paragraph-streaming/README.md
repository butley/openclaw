# Paragraph Streaming Patch

**Status:** Local patch (WIP on branch `streaming-wip`)
**Commit:** `e6f586b31`

## What It Does

Adds `/stream` (`/str`) command to control paragraph-by-paragraph delivery on WhatsApp. Instead of sending one long message, responses are split on `\n\n` and delivered with configurable reading-time delays and typing indicators between paragraphs.

Also adds `/verbose light` mode for tool-narration-only output.

## Stream Levels

| Level | Delay | Range | Command |
|-------|-------|-------|---------|
| `off` | 0 | — | `/str off` |
| `fast` | 20ms/char | 2-6s | `/str fast` |
| `on` | 40ms/char | 4-10s | `/str on` |
| `slow` | 70ms/char | 6-15s | `/str slow` |
| custom | Nms/char | 1-20s | `/str 55` (1-200 range) |

Default: `off` (standard single-message delivery).

## How It Works

### Architecture (CRITICAL — read before modifying)

The agent runner has **block streaming** enabled (`blockStreaming: true` in config). This means text arrives as multiple `kind=block` payloads (roughly paragraph-sized), NOT as a single `kind=final` payload.

**The delay runs in `process-message.ts`** (the deliver callback), between block events:
1. Block 1 arrives → delivered immediately (no delay for first block)
2. Block 2 arrives → typing indicator + delay proportional to Block 1's length → delivered
3. Block N arrives → typing indicator + delay proportional to Block N-1's length → delivered
4. Final arrives → `sendAvailable` clears typing indicator

**`deliver-reply.ts` also has a delay loop** as a fallback path. This runs when text arrives as a single `kind=final` payload (if block streaming is ever disabled). Currently this path does NOT execute because blocks arrive individually, each containing 1 paragraph — so `textChunks` inside `deliverWebReply` always has length 1. **Do not remove** — it is the safety net for the non-block-streaming path.

### Key mechanism: effectiveChunkMode

- When `streamLevel === "off"`: `effectiveChunkMode = "length"` → text delivered as one message
- When streaming is on: `effectiveChunkMode = chunkMode` (from config, typically `"newline"`) → text split on `\n\n`

### Block streaming vs delivery layer

| Component | Role |
|-----------|------|
| Agent runner block streaming | Emits text as `kind=block` events (paragraph-ish chunks) |
| `process-message.ts` deliver callback | Delays between blocks, typing indicators |
| `deliver-reply.ts` (deliverWebReply) | Splits `kind=final` text on `\n\n` (fallback path) |
| `chunkByParagraph` (chunk.ts) | Actual paragraph splitting logic |

### Upstream block streaming override

Upstream has `disableBlockStreaming: true` (hardcoded). Fork changes to:
```ts
disableBlockStreaming: !blockStreamingEnabled || sessionStreamLevel === "off"
```

## Files Modified

### WhatsApp-only (src/web/) — no impact on other channels

| File | Change |
|------|--------|
| `web/auto-reply/monitor/process-message.ts` | Block delay loop, `readSessionStreamLevel`, `resolveStreamDelayMs`, `effectiveChunkMode`, `prevBlockText` tracking, tool narration formatting, `sendAvailable` after delivery |
| `web/auto-reply/deliver-reply.ts` | `streamDelayMs` callback param, fallback delay loop between chunks |
| `web/inbound/monitor.ts` | `sendAvailable` function (clears typing via presence "available") |
| `web/inbound/types.ts` | `sendAvailable` on `WebInboundMessage` interface |

### Shared (src/auto-reply/) — additive only, no breaking changes

| File | Change |
|------|--------|
| `auto-reply/thinking.ts` | `StreamLevel` type, `normalizeStreamLevel`, `VerboseLevel: "light"` |
| `auto-reply/reply/directives.ts` | `extractStreamDirective`, regex `[A-Za-z0-9-]` |
| `auto-reply/reply/directive-handling.parse.ts` | Stream directive in parse chain |
| `auto-reply/reply/directive-handling.persist.ts` | Persist `streamLevel` to session store |
| `auto-reply/reply/directive-handling.impl.ts` | Ack messages for `/str` + `/verbose light` |
| `auto-reply/reply/get-reply-directives.ts` | Stream in resolve chain |
| `auto-reply/reply/get-reply-directives-apply.ts` | Stream in directive-only detection + persist before early return |
| `auto-reply/reply/get-reply-directives-utils.ts` | `hasStreamDirective: false` in clear |
| `auto-reply/status.ts` | `verbose:light` in status card + help text |

### Other

| File | Change |
|------|--------|
| `config/sessions/types.ts` | `streamLevel?: string` on `SessionEntry` |
| `tui/commands.ts` + `tui-command-handlers.ts` | Verbose completions/usage text |
| `agents/pi-embedded-subscribe.ts` | `"light"` in `shouldEmitToolResult` |

## Config Requirements

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

Both required. Without `blockStreaming: true`, blocks are suppressed. Without `chunkMode: "newline"`, the block chunker doesn't split on paragraphs.

## Known Code Smells

1. **`readSessionStreamLevel` called twice in `process-message.ts`** — once outside dispatch (as `sessionStreamLevel`), once inside callback (as `sessionStream`). The inner one should use the outer variable.
2. **`_resolvedStreamLevel` in `get-reply-directives.ts`** — declared but never used. Dead variable.
3. **Delay loop in `deliver-reply.ts` is currently dead code** — blocks arrive 1-at-a-time so `index > 0` is never true. Kept as fallback. Do NOT remove.
4. **`persistInlineDirectives` may be called twice** — added call before directive-only early return; upstream may already handle this.

## Grep Verification

```bash
grep -q "streamDelayMs" src/web/auto-reply/deliver-reply.ts && echo "OK" || echo "MISSING"
grep -q "effectiveChunkMode" src/web/auto-reply/monitor/process-message.ts && echo "OK" || echo "MISSING"
grep -q "resolveStreamDelayMs" src/web/auto-reply/monitor/process-message.ts && echo "OK" || echo "MISSING"
grep -q "extractStreamDirective" src/auto-reply/reply/directives.ts && echo "OK" || echo "MISSING"
grep -q "normalizeStreamLevel" src/auto-reply/thinking.ts && echo "OK" || echo "MISSING"
grep -q "sendAvailable" src/web/inbound/monitor.ts && echo "OK" || echo "MISSING"
```

## Gotchas (learned the hard way)

1. **Don't remove the block delay loop in `process-message.ts`** — it IS the real delay. Blocks arrive as individual `kind=block` events, not as a single `kind=final`.
2. **Don't remove the delay loop in `deliver-reply.ts`** — it is the fallback if block streaming is ever disabled.
3. **`matchLevelDirective` regex is shared across ALL directives** — changing it affects `/think`, `/verbose`, `/reasoning`, etc.
4. **`chunkMode: "newline"` has 2 effects** — block chunker `flushOnParagraph` AND delivery layer paragraph splitting. Cannot remove from config without breaking streaming.
5. **Coalescer in dock.ts (`DEFAULT_BLOCK_STREAMING_COALESCE`) must stay** — removing it breaks block event emission entirely.

## Changelog

- **2026-03-01:** Initial implementation on branch `streaming-wip` (commit `e6f586b31`)
