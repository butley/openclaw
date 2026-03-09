# Silent Reply Token Filter Removal

**Scope:** Gateway
**Depends on:** None

## What It Does

Removes the `extractAssistantTextForSilentCheck` function and the logic that filtered out assistant messages containing the silent reply token from chat history. This was incorrectly stripping legitimate messages.

## Files Modified

| File | Change |
|------|--------|
| `src/gateway/server-methods/chat.ts` | Deleted function + simplified sanitize loop |

## Re-apply

1. Delete the `extractAssistantTextForSilentCheck()` function
2. Simplify `sanitizeChatHistoryMessages()` from a manual `for` loop (that skipped silent-token messages) to a `.map()` that just sanitizes each message
3. Remove imports of `isSilentReplyText` and `SILENT_REPLY_TOKEN` from `../../auto-reply/tokens.js`
4. Inline `jsonUtf8Bytes()` helper locally (previously imported from `../../infra/json-utf8-bytes.js`)

## Verify

```bash
grep -q "extractAssistantTextForSilentCheck\|SILENT_REPLY_TOKEN" src/gateway/server-methods/chat.ts && echo "STALE" || echo "OK"
```
