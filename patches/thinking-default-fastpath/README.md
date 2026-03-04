# ThinkingDefault Config Shortcut

**Scope:** Gateway
**Depends on:** None

## What It Does

Skips the async model catalog resolution for `thinkingLevel` in `chat.history`
when `agents.defaults.thinkingDefault` is explicitly configured. Avoids an
unnecessary `loadGatewayModelCatalog()` call on every history request.

## Files Modified

| File | Change |
|------|--------|
| `src/gateway/server-methods/chat.ts` | Early-return check for `cfg.agents?.defaults?.thinkingDefault` |

## How It Works

Before this patch, every `chat.history` call resolved the thinking level by:
1. Looking up the session agent ID
2. Resolving the model provider/model
3. Loading the full model catalog (async)
4. Calling `resolveThinkingDefault()`

The patch adds a fast path: if `thinkingDefault` is already set in config,
use it directly and skip steps 1-4.

## Re-apply

In `src/gateway/server-methods/chat.ts`, find the `if (!thinkingLevel)` block
in the `chat.history` handler. Wrap the existing body in an `else` clause and
add a check for `cfg.agents?.defaults?.thinkingDefault` as the `if` branch.

## Verify

```bash
grep -q "thinkingDefault" src/gateway/server-methods/chat.ts && echo "OK" || echo "MISSING"
```
