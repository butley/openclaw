# P23 — Chat.send Internal Routing

**Branch:** `feat/rebase-3.22`
**Type:** Routing override
**Files:** `src/gateway/server-methods/chat.ts`, `src/utils/message-channel.ts`

## What It Does

Forces web-chat / control-ui `chat.send` to always route as `INTERNAL_MESSAGE_CHANNEL`. Without this, the handler inferred a delivery channel from `deliveryContext`, accidentally routing dashboard messages to WhatsApp.

## v3.22 Implementation

Extended `isWebchatClient()` in `message-channel.ts` to recognize `GATEWAY_CLIENT_NAMES.CONTROL_UI` (Butley dashboard client ID). This way upstream's own internal routing logic handles it correctly.

## Merge Resilience

**Watch closely** — if upstream changes `resolveChatSendOriginatingRoute` or `isWebchatClient()`, verify control-ui still routes internally.

## Verify

```bash
grep -q 'INTERNAL_MESSAGE_CHANNEL' src/gateway/server-methods/chat.ts && echo "OK" || echo "MISSING"
```

## Author

Bob — control-ui messages weren't reaching the agent.
