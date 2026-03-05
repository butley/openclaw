# Patch: Status Card Redesign

**File(s):** `src/auto-reply/status.ts`
**Branch:** `alpha`
**Commit:** `9eae6c66b`

## What it does

Redesigns the `/status` card with monospace formatting, Unicode characters, and cleaner layout for WhatsApp/terminal display.

## Changes

1. Replaced default status card layout with monospace-aligned format
2. Added `padLabel` helper for consistent column alignment
3. Uses Unicode box-drawing and emoji for visual hierarchy

## Verify

```bash
grep -q "padLabel" src/auto-reply/status.ts
```
