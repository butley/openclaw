# P13 — Verbose Light

**Branch:** `feat/rebase-3.22`
**Type:** Additive
**Files:** `src/auto-reply/thinking.shared.ts` (level), multiple delivery/formatting files

## What It Does

`/verbose light` — shows end-of-tool narrations with context-aware emoji + command + duration. No tool output, no verbose logs — concise one-liners.

```
⚙️ launchctl list | grep PID (0.1s)
📦 git log --oneline -2 (0.1s)
🔍 grep "12 custom" README.md (0.1s)
✏️ USER.md +2/-1 lines, +50 chars (0.1s)
🌐 "openclaw github" → 3 results (1.0s)
```

## Architecture

**Stage 1 — Agent runner:** Tool END → `emitToolEndSummary()` with duration, enriched result (memory provider/count, web_search count, edit diff).

**Stage 2 — Delivery:** `formatToolNarrationForChannel()` → emoji override, path shortening, chain split, heredoc truncation, duration positioning. Wrapped in backticks for WA mono rendering.

## Verbose Levels

| Level | Behavior | Command |
|-------|----------|---------|
| `off` | No tool output | `/verbose off` |
| `light` | Tool narration only | `/verbose light` |
| `on` | Tool results + verbose | `/verbose on` |
| `full` | Everything | `/verbose full` |

## Merge Resilience

**Minimal conflict** — `"light"` is an additive level in `thinking.shared.ts`. Narration pipeline touches multiple files but is mostly additive.

## Verify

```bash
grep -q '"light"' src/auto-reply/thinking.shared.ts && echo "OK" || echo "MISSING"
```

## Author

Bob — Luke: "Gosto q anuncie" (brief tool narration).
