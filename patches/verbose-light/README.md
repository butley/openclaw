# Verbose Light Patch (#13)

**Status:** Active — branch `alpha`
**Scope:** Cross-channel (formatting is WA-optimized)
**Commits:** `8995952a1` → `5b133f232` (11 commits)

## What It Does

Adds `light` level to `/verbose` that shows **end-of-tool narrations** with context-aware formatting:

```
⚙️ launchctl list | grep PID (0.1s)
📦 git log --oneline -2 (0.1s)
🔍 grep "12 custom" README.md (0.1s)
🔨 npm run build (12.4s)
📂 USER.md (1-3) (0.1s)
✏️ USER.md +2/-1 lines, +50 chars (0.1s)
🌐 "openclaw github" → 3 results (1.0s)
🧠 "snowhouse partnership" [qmd] → 2 results (0.8s)
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
   - Result enrichment (memory provider/count, web_search count, edit line/char diff)
   - Error flag
   - Tool args (for edit enrichment)

**Stage 2 — Delivery formatting** (`dispatch-from-config.ts` + `process-message.ts`):
1. `formatToolNarrationForChannel()` reformats the raw narration:
   - Extract actual command from `\n\n`-separated raw text
   - Context-aware emoji override
   - Path shortening (deep paths → filename)
   - Chain splitting (skip `cd`, take meaningful command)
   - Heredoc truncation, pipe removal, redirect stripping
   - Arrow/noise cleanup (`->` → `→`, `(+N steps)`, `show first/last N lines`)
   - Duration repositioning to end
   - Tool-specific cleanup (edit: strip upstream `(N chars)`, web: strip `(top N)` and `for` prefix)
2. `process-message.ts` deliver callback wraps in backticks for WA mono rendering
3. `message` tool narrations are suppressed (return empty string)

### Emoji Map (all tools covered)

| Tool/Command | Emoji | Notes |
|-------------|-------|-------|
| `launchctl`, `systemctl`, `restart`, `kill` | ⚙️ | System management |
| `git` | 📦 | |
| `npm`, `build`, `make` | 🔨 | |
| `grep`, `search`, `find` | 🔍 | |
| `python`, `node`, `bun` | 🐍 | |
| `cat`, `head`, `tail`, `sed`, `awk` | 📄 | |
| Other exec | 🛠️ | |
| `read` | 📂 | |
| `write`, `edit` | ✏️ | |
| `web_search`, `web_fetch` | 🌐 | |
| `memory_search`, `memory_get` | 🧠 | |
| `image` | 🖼️ | |
| `message` | — | Suppressed |
| `process` | 🧰 | |
| `browser` | 🌐 | |
| `canvas` | 🎨 | |
| `nodes` | 📱 | |
| `cron` | ⏰ | |
| `gateway` | 🔌 | |
| `sessions_spawn` | 🚀 | |
| `subagents` | 🤖 | |
| `session_status` | 📊 | |
| `whatsapp_login` | 🟢 | |
| `sessions_*` | 🗂️ | list, history, send |
| `agents_list` | 🧭 | |
| `tts` | 🔊 | |
| `apply_patch` | 🩹 | |

### Result Enrichment

| Tool | Enrichment | Source |
|------|-----------|--------|
| `memory_search` | `[qmd\|local] → N results` | `sanitizedResult` JSON |
| `web_search` | `→ N results` | `sanitizedResult` content block JSON |
| `edit` | `+X/-Y lines, ±N chars` | `startData.args` (old/new strings) |

Hidden when zero diff (edit with no actual line/char changes shows just filename).

### Duration Tracking

Duration from `toolStartData.startTime` → `handleToolExecutionEnd`. Displayed as `(Xs)`.
Extracted from full raw text **before** firstLine truncation (fixes multi-paragraph raw).

### Exec Command Cleanup

Pipeline applied to `actualCmd` (extracted from raw after `\n\n`):
1. Strip bash comments (`#...`)
2. Strip `-C /path/to/dir` flags
3. Strip redirects (`2>&1`, `2>/dev/null`, `>/dev/null`)
4. Strip duration suffix
5. Truncate heredocs (`cat > file << 'EOF' ...` → `cat > file << 'EOF'`)
6. Remove pipe suffixes (`| tail -3`, `| head -5`)
7. Chain split: skip `cd` commands, take first meaningful command

## Files Modified

### Agent runner (narration at END)

| File | Change |
|------|--------|
| `agents/pi-embedded-subscribe.ts` | `emitToolEndSummary()`, `isLightVerbose()`, memory/web/edit enrichment |
| `agents/pi-embedded-subscribe.handlers.tools.ts` | Suppress START for light, emit END with duration + args |
| `agents/pi-embedded-subscribe.handlers.types.ts` | `emitToolEndSummary?`, `isLightVerbose?` on both context types |

### Formatting (delivery layer)

| File | Change |
|------|--------|
| `auto-reply/reply/dispatch-from-config.ts` | `formatToolNarrationForChannel()` — full formatting pipeline |
| `web/auto-reply/monitor/process-message.ts` | Backtick wrapping for `kind === "tool"` payloads |

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

## Pending Improvements

### P1 — Nice to have
- [ ] **Narration batching:** Parallel tool calls → single multi-line message (reduces WA spam)
- [ ] **Read enrichment:** `📂 USER.md (1-3 of 69 lines)` — show total lines
- [ ] **Exec error enrichment:** Show exit code on failure

### P2 — Future
- [ ] **Duration thresholds:** Hide `(0.0s)` for instant tools (only show > 0.5s)
- [ ] **Start indicator for slow tools:** Show `⏳ searching...` at START for tools > 2s
- [ ] **Per-channel formatting:** Current formatter is channel-agnostic but WA-optimized
- [ ] **Narration aggregation window:** 200ms buffer to batch parallel tool calls
- [ ] **Clean dead code:** Remove old `formatToolNarration()` from `process-message.ts`

## Known Edge Cases

- **First tool after restart:** May show without duration (START narration not suppressed). Cosmetic, rare.
- **QMD crash:** Memory search shows `[local]` instead of `[qmd]` when reranker crashes. Not a formatting bug.

## Changelog

- `8995952a1` feat: initial tool narration formatting (WIP)
- `7ad3176f9` feat: polished formatting — actual commands, chain splitting
- `5b94d76f3` docs: README with architecture
- `bbd8ae247` docs: comprehensive analysis + roadmap
- `b7f4a7c23` fix: P0 bugs (regex typo, bash comments, debug logging)
- `61ebc8927` feat: custom emojis for all tool types
- `1232f7765` fix: toolType extraction for labels without colon
- `5d3bb9745` fix: skip `cd` in chain split
- `25769c2d6` feat: enrichment for edit, web_search + suppress message narration
- `4e91433c8` fix: clean edit/web narration, parse content blocks
- `6d854ec98` fix: hide zero diff, strip (top N)
- `017858e58` fix: truncate heredocs and pipes
- `5b133f232` fix: strip shell redirects (2>/dev/null)
