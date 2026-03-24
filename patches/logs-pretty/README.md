# P10 — Logs Pretty Formatter

**Branch:** `feat/rebase-3.22`
**Type:** Own file + flag
**Files:** `src/cli/logs-pretty-formatter.ts` (new, ~438 lines), `src/cli/logs-cli.ts` (+flag)

## What It Does

`openclaw logs --pretty` — rich formatted log output with visual categories, icons, phone aliases, UUID compaction, BRT timestamps, and terminal-aware wrapping.

### Before
```
{"time":"2026-02-25T19:48:23.000Z","level":"debug","msg":"embedded run start..."}
```
### After
```
16:48:23 dbg ▸ embedded run start: runId=6c12700b… sessionId=692aa1cd…
```

## CLI Flags

```
openclaw logs --pretty           # pretty + follow
openclaw logs --pretty -n 500    # pretty, last 500 lines
```

## Merge Resilience

**Zero conflict** — own file. Only hook is `--pretty` flag in `logs-cli.ts`.

## Verify

```bash
test -f src/cli/logs-pretty-formatter.ts && echo "OK" || echo "MISSING"
```

## Author

Bob — CLI log readability.
