# Patch #16: Tool Events Broadcast

**Scope:** Gateway (`src/gateway/server-chat.ts`)
**Risk:** Low — tool events already had `dropIfSlow: true`

## Problem

Tool events used `broadcastToConnIds()` which only sends to connections that called `chat.send` (registered recipients). WebSocket clients observing a WA-initiated run (e.g., Control UI watching a WhatsApp session) never call `chat.send` → not registered → no tool events received.

## Fix

Changed tool event emission from `broadcastToConnIds()` to `broadcast("agent", payload, { dropIfSlow: true })` — all WS clients on the `agent` channel receive tool events.

Prefixed unused `broadcastToConnIds` param with `_` to satisfy linter.

## Verify

```bash
grep -q "_broadcastToConnIds" src/gateway/server-chat.ts
```
