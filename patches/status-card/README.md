# P8 — Status Card

**Branch:** `feat/rebase-3.22`
**Type:** Extracted → own file (hardened 2026-03-24)
**Files:** `src/auto-reply/status-card-format.ts` (new, ~93 lines), `src/auto-reply/status.ts` (import + call)

## What It Does

Redesigns `/status` with monospace formatting, Unicode characters, `padLabel` helper, and cleaner layout for WhatsApp/terminal display.

## History

Originally 78 lines of formatting inline in `status.ts`. Upstream changes data-gathering constantly → merge conflicts. Hardened by extracting to `status-card-format.ts`: pure `formatStatusCard()` function with typed input. `status.ts` gathers data (upstream can change freely), calls the function.

## Merge Resilience

**Zero conflict** — own file. After upstream merge, just verify the import + call in `status.ts`.

## Verify

```bash
test -f src/auto-reply/status-card-format.ts && echo "OK" || echo "MISSING"
grep -q 'formatStatusCard' src/auto-reply/status.ts && echo "OK" || echo "MISSING"
```

## Author

Bob — Luke wanted a prettier /status card.
