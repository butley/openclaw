# HTTP Tools Channel Registration

**Scope:** Gateway
**Depends on:** None

## What It Does

The HTTP tool invocation endpoint (`/tools/invoke`) now includes channel-registered agent tools (e.g., `whatsapp_login`) in the tool list, with a hardcoded fallback for WhatsApp.

Also cleans up the WhatsApp extension plugin to remove the unused `getWhatsAppRuntime` import and simplify the tool registration comment.

## Files Modified

| File | Change |
|------|--------|
| `src/gateway/tools-invoke-http.ts` | Include channel tools + WA fallback in tool list |
| `extensions/whatsapp/index.ts` | Remove unused import, simplify comment |

## Re-apply

In `src/gateway/tools-invoke-http.ts`:
1. Import `listChannelAgentTools` from `../agents/channel-tools.js`
2. Import `createWhatsAppLoginTool` from `../channels/plugins/agent-tools/whatsapp-login.js`
3. Build tool list by spreading: `listChannelAgentTools({ cfg })`, then conditional `createWhatsAppLoginTool()` (if WA channel enabled), then `createOpenClawTools(...)`

In `extensions/whatsapp/index.ts`:
1. Remove `getWhatsAppRuntime` from import
2. Simplify the comment about tool registration

## Verify

```bash
grep -q "listChannelAgentTools" src/gateway/tools-invoke-http.ts && echo "OK" || echo "MISSING"
grep -q "getWhatsAppRuntime" extensions/whatsapp/index.ts && echo "STALE" || echo "OK"
```
