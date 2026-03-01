# Verbose Light Patch (#13)

**Status:** Active — branch `alpha`
**Scope:** Cross-channel (formatting is WA-optimized)

## What It Does

Adds `light` level to `/verbose` that shows **end-of-tool narrations** with context-aware formatting:

```
⚙️ launchctl list | grep PID (0.1s)
📦 git log --oneline -2 (0.1s)
🔍 grep "12 custom" README.md (0.1s)
📂 USER.md (1-3) (0.1s)
✏️ 2026-03-01.md (279 chars) (0.1s)
🧠 "butley frontend" [qmd] → 2 results (0.8s)
```

No tool output, no verbose logs — just concise one-liners showing what's happening.

## Verbose Levels

| Level | Behavior | Command |
|-------|----------|---------|
| `off` | No tool output | `/verbose off` |
| `light` | Tool narration only (emoji + command + duration) | `/verbose light` |
| `on` | Tool results + verbose logs | `/verbose on` |
| `full` | Everything including tool output | `/verbose full` |

## Architecture

### Narration Pipeline

1. **Tool START** → suppressed in light mode (`isLightVerbose` check in `handlers.tools.ts`)
2. **Tool END** → `emitToolEndSummary()` fires with duration + result context
3. **`emitToolEndSummary`** (`pi-embedded-subscribe.ts`) → builds narration from `formatToolAggregate` + enrichment (memory provider/count)
4. **`formatToolNarrationForChannel`** (`dispatch-from-config.ts`) → reformats for messaging:
   - Extracts actual command from raw text (after `\n\n`)
   - Context-aware emoji based on tool type + command content
   - Path shortening (deep paths → filename)
   - Chain splitting (first command before `&&` or `;`)
   - Arrow/noise cleanup
   - Duration repositioning to end

### Emoji Map

| Tool/Command | Emoji |
|-------------|-------|
| `launchctl`, `systemctl`, `restart`, `kill` | ⚙️ |
| `git` | 📦 |
| `npm`, `build`, `make` | 🔨 |
| `grep`, `search`, `find` | 🔍 |
| `python`, `node`, `bun` | 🐍 |
| `cat`, `head`, `tail`, `sed`, `awk` | 📄 |
| Other exec | 🛠️ |
| `read` | 📂 |
| `write`, `edit` | ✏️ |
| `web_search`, `web_fetch` | 🌐 |
| `memory_search`, `memory_get` | 🧠 |
| `image` | 🖼️ |
| `message` | 💬 |

### Memory Search Enrichment

`emitToolEndSummary` parses `sanitizedResult` for `memory_search` to extract:
- `provider` → `[qmd]` or `[local]`
- `results.length` → `→ N results`

### Duration Tracking

Duration comes from `toolStartData.startTime` (set at tool start, read at tool end).
Displayed as `(Xs)` suffix, e.g. `(0.1s)`, `(38.5s)`.
Extracted from full raw text before firstLine truncation (fixes multi-paragraph raw where duration is after `\n\n`).

## Files Modified

### Agent runner (narration at END)

| File | Change |
|------|--------|
| `agents/pi-embedded-subscribe.ts` | `emitToolEndSummary()`, `isLightVerbose()`, memory result enrichment |
| `agents/pi-embedded-subscribe.handlers.tools.ts` | Suppress START for light, emit END with duration |
| `agents/pi-embedded-subscribe.handlers.types.ts` | `emitToolEndSummary?`, `isLightVerbose?` on context types |

### Formatting (delivery layer)

| File | Change |
|------|--------|
| `auto-reply/reply/dispatch-from-config.ts` | `formatToolNarrationForChannel()` — emoji, paths, chains, arrows, duration |

### Shared (verbose level support)

| File | Change |
|------|--------|
| `auto-reply/thinking.ts` | `VerboseLevel` type includes `"light"` |
| `auto-reply/status.ts` | `verbose:light` in status card |
| `auto-reply/reply/directive-handling.impl.ts` | Ack message for light mode |
| `agents/pi-embedded-subscribe.ts` | `shouldEmitToolResult` returns `true` for `"light"` |
| `tui/commands.ts` | Verbose completions include `"light"` |
| `tui/tui-command-handlers.ts` | Usage text updated |

## Grep Verification

```bash
grep -q 'isLightVerbose' src/agents/pi-embedded-subscribe.handlers.tools.ts && echo "OK" || echo "MISSING"
grep -q 'emitToolEndSummary' src/agents/pi-embedded-subscribe.ts && echo "OK" || echo "MISSING"
grep -q 'formatToolNarrationForChannel' src/auto-reply/reply/dispatch-from-config.ts && echo "OK" || echo "MISSING"
grep -q '"light"' src/auto-reply/thinking.ts && echo "OK" || echo "MISSING"
```

## Gotchas

- **Duration on first tool call**: First tool in a run may have `verboseLevel` from previous run state. Subsequent tools are correct.
- **Multi-paragraph raw**: Upstream wraps exec commands as `meta\n\n\`command\``. Duration may be in the second paragraph — extracted before firstLine split.
- **`formatToolNarration` in `process-message.ts`**: Dead code — tool results don't flow through the WA deliver callback. They go through `dispatch-from-config.ts` → `routeReply`.

## Changelog

- **2026-03-01:** Initial light level support (commit `e6f586b31`)
- **2026-03-01:** Moved narration to tool END with duration tracking, context-aware formatting, memory enrichment (commits `8995952a1`, `7ad3176f9`)
