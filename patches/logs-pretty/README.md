# Patch: Logs Pretty Formatter

**File(s):** `src/cli/logs-cli.ts`, `src/cli/logs-pretty-formatter.ts` (NEW ~438 lines)
**Branch:** `alpha`
**Commit:** `871dcb0ac`, `954d1972d`

## What it does

Adds `--pretty` flag to `openclaw logs` CLI for rich formatted log output with visual categories, icons, phone aliases, UUID compaction, message body extraction, time-gap separators, and terminal-aware text wrapping.

### Before
```
{"time":"2026-02-25T19:48:23.000Z","level":"debug","msg":"embedded run start..."}
```

### After
```
16:48:23 dbg ▸ embedded run start: runId=6c12700b… sessionId=692aa1cd… provider=anthropic
```

## Changes

1. New file `src/cli/logs-pretty-formatter.ts` — full rich formatter (categories, ANSI colors, BRT timestamps, phone aliases, cron name resolution, UUID compaction, word wrapping)
2. Modified `src/cli/logs-cli.ts` — added `--pretty` and `-n [count]` flags, `--pretty` implies `--follow` by default

## CLI Flags

```
openclaw logs --pretty           # pretty + follow (default)
openclaw logs --pretty -n        # pretty, last 200 lines
openclaw logs --pretty -n 500    # pretty, last 500 lines
openclaw logs -n                 # raw, last 100 lines
openclaw logs -n 50              # raw, last 50 lines
```

## Why

The default JSON log output is unreadable for humans. This provides a categorized, colored, terminal-aware view that makes log monitoring practical for daily use.
