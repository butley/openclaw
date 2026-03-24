# P26 — ThinkingDefault Config Shortcut

**Branch:** `feat/rebase-3.22`
**Type:** Additive early return
**Files:** `src/gateway/server-methods/chat.ts`

## What It Does

Skips async model catalog resolution for `thinkingLevel` in `chat.history` when `agents.defaults.thinkingDefault` is already configured. Avoids unnecessary `loadGatewayModelCatalog()` on every history request.

## Merge Resilience

**Minimal conflict** — additive 3-line early return wrapping upstream code without modifying it.

## Verify

```bash
grep -q 'thinkingDefault' src/gateway/server-methods/chat.ts && echo "OK" || echo "MISSING"
```

## Author

Bob — avoid expensive catalog lookup when config already set.
