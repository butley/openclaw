# Chat Mirror Patch

**Status:** Local patch (not yet submitted upstream)  
**Feature Request:** Consider submitting to [clawdbot/clawdbot](https://github.com/clawdbot/clawdbot)

## What It Does

Adds `mirror` parameter to `chat.send` WebSocket method. When `mirror: true`, AI responses from webchat/dashboard are also relayed to the session's original channel (e.g., WhatsApp).

**Use Case:** Chat with a WhatsApp session via the web dashboard, and have your AI's responses appear in both places.

## How It Works

1. Web dashboard sends `chat.send` with `mirror: true`
2. Gateway stores the mirror flag in the agent run context
3. When the AI response is finalized, gateway checks for mirror flag
4. If enabled, extracts channel/peer from session key and sends via outbound plugin

## Session Key Format

Session keys encode channel and peer info:
```
agent:{agentId}:{channel}:{peerKind}:{peerId}
```

Example: `agent:main:whatsapp:dm:+553196348700`
- channel: `whatsapp`
- peerKind: `dm`
- peerId: `+553196348700`

## Files Modified

| File | Change |
|------|--------|
| `gateway/protocol/schema/logs-chat.js` | Added `mirror: Type.Optional(Type.Boolean())` to ChatSendParamsSchema |
| `gateway/server-methods/chat.js` | Added import for `registerAgentRunContext`, registers mirror flag in run context |
| `gateway/server-bridge-methods-chat.js` | Added mirror flag to run context registration |
| `gateway/server-chat.js` | Added mirror logic in `emitChatFinal` - sends to WhatsApp if mirror enabled |

## Apply Patch

```bash
bash ~/clawd/patches/chat-mirror/apply.sh
clawdbot gateway restart
```

## Revert Patch

```bash
bash ~/clawd/patches/chat-mirror/revert.sh
clawdbot gateway restart
```

## Dashboard Integration

The dashboard hook (`useClawdbotBridge.ts`) sends `mirror: true` by default:

```typescript
const sendChat = useCallback(async (params: ChatSendParams & { mirror?: boolean }) => {
  const requestParams: Record<string, unknown> = {
    ...params,
    idempotencyKey: `web_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    mirror: params.mirror ?? true, // Default to mirroring
  };
  return sendRequest('chat.send', requestParams);
}, [sendRequest]);
```

## Current Limitations

- Only supports WhatsApp channel (easy to extend for Telegram, Discord, etc.)
- Only mirrors AI responses (not user messages from web)
- Requires gateway restart after patching

## Potential PR Description

```markdown
### Feature: Add `mirror` param to chat.send for cross-channel relay

When chatting with a session via webchat/dashboard, this allows AI responses 
to be relayed back to the session's original channel (e.g., WhatsApp).

**Use case:** Debug or interact with a WhatsApp session from the web UI 
while keeping the WhatsApp chat updated.

**Changes:**
- Add `mirror?: boolean` to ChatSendParamsSchema
- Store mirror flag in agent run context
- Check flag in emitChatFinal and relay via outbound plugin

**Example:**
```javascript
ws.send(JSON.stringify({
  type: 'req',
  method: 'chat.send',
  params: {
    sessionKey: 'agent:main:whatsapp:dm:+15551234567',
    message: 'Hello from web!',
    idempotencyKey: 'web_123',
    mirror: true  // Relay AI response to WhatsApp
  }
}));
```
```

## Changelog

- **2026-02-01:** Initial patch created
  - Added mirror param to schema
  - Added mirror logic to server-methods/chat.js and server-chat.js
  - Fixed: mirror flag wasn't being stored in run context (added registerAgentRunContext)
  - Fixed: emitChatFinal wasn't checking for mirror (added getAgentRunContext check)
