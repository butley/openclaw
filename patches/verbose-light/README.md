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

### Narration Pipeline (2-stage)

**Stage 1 — Agent runner** (`pi-embedded-subscribe.ts` + `handlers.tools.ts`):
1. Tool START → suppressed in light mode (`isLightVerbose` check)
2. Tool END → `emitToolEndSummary()` fires with:
   - `formatToolAggregate()` output (upstream label + meta)
   - Duration from `toolStartData.startTime`
   - Result enrichment (memory provider/count)
   - Error flag

**Stage 2 — Delivery formatting** (`dispatch-from-config.ts` + `process-message.ts`):
1. `formatToolNarrationForChannel()` reformats the raw narration:
   - Extract actual command from `\n\n`-separated raw
   - Context-aware emoji override
   - Path shortening, chain splitting, noise cleanup
   - Duration repositioning to end
2. `process-message.ts` deliver callback wraps in backticks for WA mono rendering

**Key insight:** Tool results flow through `dispatch-from-config.ts` → `routeReply` → `process-message.ts` deliver callback. The deliver callback IS reached (not dead code) — it adds the backtick wrapping.

### Emoji Map

| Tool/Command | Emoji | Upstream |
|-------------|-------|----------|
| `launchctl`, `systemctl`, `restart`, `kill` | ⚙️ | 🛠️ |
| `git` | 📦 | 🛠️ |
| `npm`, `build`, `make` | 🔨 | 🛠️ |
| `grep`, `search`, `find` | 🔍 | 🛠️ |
| `python`, `node`, `bun` | 🐍 | 🛠️ |
| `cat`, `head`, `tail`, `sed`, `awk` | 📄 | 🛠️ |
| Other exec | 🛠️ | 🛠️ |
| `read` | 📂 | 📖 |
| `write`, `edit` | ✏️ | ✍️/📝 |
| `web_search`, `web_fetch` | 🌐 | 🔎/📄 |
| `memory_search`, `memory_get` | 🧠 | 🧠/📓 |
| `image` | 🖼️ | 🖼️ |
| `message` | 💬 | ✉️ |

### Tools NOT yet covered (use default 🧩)

| Tool | Upstream Emoji | Suggested |
|------|---------------|-----------|
| `process` | 🧰 | 🧰 |
| `browser` | 🌐 | 🌐 |
| `canvas` | 🖼️ | 🎨 |
| `nodes` | 📱 | 📱 |
| `cron` | ⏰ | ⏰ |
| `gateway` | 🔌 | 🔌 |
| `sessions_spawn` | 🧑🔧 | 🚀 |
| `subagents` | 🤖 | 🤖 |
| `session_status` | 📊 | 📊 |
| `whatsapp_login` | 🟢 | 🟢 |

### Memory Search Enrichment

`emitToolEndSummary` parses `sanitizedResult` for `memory_search` to extract:
- `provider` → `[qmd]` or `[local]`
- `results.length` → `→ N results`

Result info flows as suffix in raw text, then `formatToolNarrationForChannel` extracts via regex and repositions.

### Duration Tracking

Duration comes from `toolStartData.startTime` (set in `handleToolExecutionStart`, read in `handleToolExecutionEnd`).
Displayed as `(Xs)` suffix. Extracted from full raw text **before** firstLine truncation (fixes multi-paragraph raw where duration is after `\n\n`).

## Files Modified

### Agent runner (narration at END)

| File | Change |
|------|--------|
| `agents/pi-embedded-subscribe.ts` | `emitToolEndSummary()`, `isLightVerbose()`, memory enrichment |
| `agents/pi-embedded-subscribe.handlers.tools.ts` | Suppress START for light, emit END with duration |
| `agents/pi-embedded-subscribe.handlers.types.ts` | `emitToolEndSummary?`, `isLightVerbose?` on both context types |

### Formatting (delivery layer)

| File | Change |
|------|--------|
| `auto-reply/reply/dispatch-from-config.ts` | `formatToolNarrationForChannel()` — emoji, paths, chains, arrows, duration |
| `web/auto-reply/monitor/process-message.ts` | Backtick wrapping for `kind === "tool"` payloads + `[tool-narration-raw]` debug log |

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

## Known Bugs

1. **Regex typo in edit cleanup:** `/^ins+/` should be `/^in\s+/` — "ins..." matched instead of "in " (space). Minor: only affects edit narrations starting with "in".

2. **Bash comments in actualCmd:** When exec command starts with `# comment`, the comment leaks into narration. E.g. `# Check: what does...` becomes the narration text. Should strip `#` comments from actualCmd.

3. **Debug logging still active:**
   - `console.log("[narration-transform]", ...)` in `dispatch-from-config.ts` — IIFE wrapper around formatToolNarrationForChannel
   - `ctx.log.debug("[LIGHT-DEBUG]", ...)` in `handlers.tools.ts` — tool end debug
   - Remove both before merging to production.

## Pending Improvements

### P0 — Should fix

- [ ] **Fix regex typo:** `/^ins+/` → `/^in\s+/` in edit emoji block
- [ ] **Strip bash comments from actualCmd:** `actualCmd.replace(/#[^\n]*/g, "").trim()` before using
- [ ] **Remove debug logging:** Both `[narration-transform]` and `[LIGHT-DEBUG]`

### P1 — Nice to have

- [ ] **Add missing tool emojis:** `process` (🧰), `browser` (🌐), `canvas` (🎨), `nodes` (📱), `cron` (⏰), `gateway` (🔌), `sessions_spawn` (🚀), `subagents` (🤖), `session_status` (📊)
- [ ] **Tool narration batching:** When model calls 3+ tools in parallel, batch into single message: `📦 git log + 🔍 grep "x" + 📂 read Y (0.2s total)`
- [ ] **Enrichment for other tools:** `web_search` → result count, `exec` → exit code on error, `sessions_spawn` → agent name
- [ ] **Read: show file size context:** `📂 USER.md (1-3 of 69 lines)` vs just `(1-3)`
- [ ] **Edit: show what changed:** `✏️ USER.md (+2/-1 lines)` instead of `(279 chars)`

### P2 — Future

- [ ] **Duration thresholds:** Only show duration for tools > 0.5s (skip `(0.0s)` noise)
- [ ] **Error narrations:** `🔍 grep "missing" README.md ❌ not found (0.1s)` — currently shows ❌ but no error context
- [ ] **Per-channel formatting:** Current formatter is channel-agnostic but WA-optimized. Other channels might want different emoji/formatting
- [ ] **Narration aggregation window:** Buffer narrations for 200ms and deliver as single message to reduce WA message spam
- [ ] **Start indicator for slow tools:** Show `⏳ memory search...` at START for tools > 2s, then replace with final narration at END
- [ ] **`process-message.ts` cleanup:** The `formatToolNarration()` function there is partially dead code (tool-specific formatting). Only the backtick wrapper and `[tool-narration-raw]` log are active. The old `formatToolNarration()` can be removed.

## Gotchas

- **Duration on first tool call**: First tool in a run may inherit `verboseLevel` from a prior run. Subsequent tools read the current session value correctly. Root cause: `params.verboseLevel` is set at subscriber creation time.
- **Multi-paragraph raw**: Upstream wraps exec commands as `meta\n\n\`command\` (duration)`. Duration is in the second paragraph — must be extracted from full raw before firstLine split.
- **`process-message.ts` IS reached**: Despite tool results going through `dispatch-from-config.ts` → `routeReply`, the WA deliver callback in `process-message.ts` runs AFTER and adds backtick wrapping. It's NOT dead code.
- **QMD crash affects provider tag**: When QMD reranker crashes (context size error), memory falls back to `[local]` with 0 results. Not a formatting bug — QMD operational issue.

## Changelog

- **2026-03-01:** Initial light level support (commit `e6f586b31`)
- **2026-03-01:** Moved narration to tool END with duration tracking, context-aware formatting, memory enrichment (commit `8995952a1`)
- **2026-03-01:** Polished formatting — actual commands, chain splitting, edit cleanup, quotes on memory (commit `7ad3176f9`)
- **2026-03-01:** README rewrite with full architecture + analysis (commit `5b94d76f3`)
