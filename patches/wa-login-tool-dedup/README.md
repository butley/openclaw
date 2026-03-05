# WhatsApp Login Tool Dedup

## Problem

In OpenClaw < 2026.2.26, `whatsapp_login` was not registered as a native tool. Our WhatsApp extension patch (`55399b9`) added `api.registerTool()` to expose it via HTTP `/tools/invoke` for the Butley backend orchestrator.

Starting with OpenClaw v2026.2.26, upstream registers `whatsapp_login` natively in the subagent registry. Our `api.registerTool()` call then creates a duplicate, causing `"Tool names must be unique"` error on every agent startup.

## Solution

Removed the `api.registerTool()` call from `extensions/whatsapp/index.ts` and added a comment explaining that OpenClaw >= 2026.2.26 handles it natively.

## Files

- `extensions/whatsapp/index.ts` — removed registerTool block, kept registerChannel

## Key Grep Pattern

```bash
grep -q 'provided by core' extensions/whatsapp/index.ts
```

## History

1. `55399b9` (2026-02-26) — Added `api.registerTool()` for HTTP tool exposure (needed for < 2026.2.26)
2. `aab4460` (2026-02-26) — Removed it after upstream v2026.2.26 absorbed the registration

## Author

Guilherme Ramos (`guiramos@gmail.com`) — 2026-02-26

## Commits

`55399b9`, `aab4460` on `dev`

## Notes

If OpenClaw ever removes native `whatsapp_login` registration, the `api.registerTool()` block from commit `55399b9` would need to be restored.
