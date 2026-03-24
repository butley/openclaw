# P25 — HTTP Tools Channel Registration

**Branch:** `feat/rebase-3.22`
**Type:** Additive import
**Files:** `src/gateway/tools-invoke-http.ts`

## What It Does

Includes channel-registered agent tools (e.g., `whatsapp_login`) in the `/tools/invoke` HTTP endpoint's tool list.

## Merge Resilience

**Minimal conflict** — one import + spread in tool list construction.

## Verify

```bash
grep -q 'listChannelAgentTools' src/gateway/tools-invoke-http.ts && echo "OK" || echo "MISSING"
```

## Author

Bob — channel tools missing from HTTP invoke endpoint.
