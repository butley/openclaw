# Chat.send Internal Routing Fix

**Scope:** Gateway
**Depends on:** None

## What It Does

Forces web-chat `chat.send` to always route as `INTERNAL_MESSAGE_CHANNEL`. Previously, the handler tried to infer a delivery channel from the session's `deliveryContext`/`lastChannel`, which could accidentally route a dashboard message to WhatsApp.

## Files Modified

| File | Change |
|------|--------|
| `src/gateway/server-methods/chat.ts` | Removed ~18 lines of routing inference, hardcoded internal channel |

## Re-apply

In the `chat.send` handler, find the message context construction. Remove any logic computing `routeChannelCandidate`, `routeToCandidate`, `routeAccountIdCandidate`, `hasDeliverableRoute` from session `deliveryContext`. Replace with:

```typescript
OriginatingChannel: INTERNAL_MESSAGE_CHANNEL,
// Do NOT set OriginatingTo, AccountId, MessageThreadId
```

Also remove the import of `normalizeMessageChannel` if no longer used elsewhere.

## Verify

```bash
grep -q "routeChannelCandidate" src/gateway/server-methods/chat.ts && echo "STALE" || echo "OK"
```
