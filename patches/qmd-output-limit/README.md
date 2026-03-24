# P9 — QMD Output Limit

**Branch:** `feat/rebase-3.22`
**Type:** Additive config
**Files:** `src/memory/qmd-manager.ts`, `src/memory/backend-config.ts`

## What It Does

Makes QMD output limit configurable via `maxOutputChars` (default: 10MB). Upstream hardcoded 200k which caused search results to flood the context window.

## Merge Resilience

**Minimal conflict** — additive config field.

## Verify

```bash
grep -q 'maxOutputChars' src/memory/qmd-manager.ts && echo "OK" || echo "MISSING"
```

## Author

Bob — QMD search results flooding context.
