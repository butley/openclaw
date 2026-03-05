# Patch: QMD Output Limit Fix

**File(s):** `src/memory/qmd-manager.ts`, `src/config/zod-schema.ts`, `src/config/backend-config.ts`
**Branch:** `alpha`
**Commit:** `f3a7232`

## What it does

Raises the QMD log output limit from 200k to 10MB and makes it configurable via `maxOutputChars` in config.

## Changes

1. Added `maxOutputChars` config field to zod schema and backend config
2. Modified QMD manager to use configurable limit instead of hardcoded 200k
3. Default: 10MB (10_000_000 chars)

## Verify

```bash
grep -q "maxOutputChars" src/memory/qmd-manager.ts
```
