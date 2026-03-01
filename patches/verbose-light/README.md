# Verbose Light Patch

**Status:** Local patch (on branch `streaming-wip`)
**Commit:** `e6f586b31` (shared with wa-paragraph-streaming)

## What It Does

Adds `light` level to `/verbose` command. When set, only tool narration is emitted (tool name + first line summary as inline mono), without full tool output or verbose logging.

## Verbose Levels

| Level | Behavior | Command |
|-------|----------|---------|
| `off` | No tool output, no verbose logs | `/verbose off` |
| `light` | Tool narration only (inline mono) | `/verbose light` |
| `on` | Tool results + verbose logs | `/verbose on` |
| `full` | Everything including tool output | `/verbose full` |

## How It Works

1. User sends `/verbose light`
2. `normalizeVerboseLevel` maps `"light"`, `"narration"`, `"narrate"` → `"light"`
3. `shouldEmitToolResult` returns `true` for `"light"` (tool names are shown)
4. Tool payload text is formatted as inline mono: `` `first line only` ``
5. `shouldEmitToolOutput` returns `false` for `"light"` (full output suppressed)

The inline mono formatting happens in `process-message.ts` (WA deliver callback):
```ts
if (info.kind === "tool" && payload.text) {
  const firstLine = payload.text.split("\n\n")[0].trim();
  payload = { ...payload, text: "`" + firstLine + "`" };
}
```

## Files Modified

### Shared (all channels)

| File | Change |
|------|--------|
| `auto-reply/thinking.ts` | `VerboseLevel` expanded with `"light"`, `normalizeVerboseLevel` accepts `"light"/"narration"/"narrate"` |
| `auto-reply/status.ts` | `verbose:light` in status card, help text updated |
| `auto-reply/reply/directive-handling.impl.ts` | Ack message: "Tool narration enabled (light mode)." |
| `agents/pi-embedded-subscribe.ts` | `shouldEmitToolResult` returns `true` for `"light"` |
| `tui/commands.ts` | Verbose completions: `["on", "off", "light", "full"]` |
| `tui/tui-command-handlers.ts` | Usage text: `/verbose <off|light|on|full>` |

### WhatsApp-only (tool formatting)

| File | Change |
|------|--------|
| `web/auto-reply/monitor/process-message.ts` | Inline mono formatting for `kind === "tool"` payloads |

**Note:** The tool formatting in `process-message.ts` is WA-specific. Other channels would need their own formatting if they adopt `/verbose light`.

## Grep Verification

```bash
grep -q '"light"' src/auto-reply/thinking.ts && echo "OK" || echo "MISSING"
grep -q 'verbose:light' src/auto-reply/status.ts && echo "OK" || echo "MISSING"
grep -q '"light"' src/agents/pi-embedded-subscribe.ts && echo "OK" || echo "MISSING"
```

## Changelog

- **2026-03-01:** Initial implementation (commit `e6f586b31`, shared with wa-paragraph-streaming)
