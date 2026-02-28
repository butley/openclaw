# WA Paragraph Delay — Feature Docs

Adds natural reading-time delays between paragraphs in direct WhatsApp conversations, with a typing indicator during each wait.

---

## How It Works

With `blockStreaming: true`, the LLM response is split into **blocks** (one per paragraph, based on `\n\n` boundaries) and delivered sequentially via `reply-dispatcher.ts`'s send chain.

The delay is injected **before** each block delivery (except the first), based on the **previous** block's character count. This means:

- The first paragraph arrives immediately — no cold wait
- The typing indicator appears → user reads → next paragraph arrives
- After the **last** paragraph, `sendAvailable` clears the typing indicator immediately

### Delivery sequence

```
[block 1] → deliver immediately
           → set prevBlockText = block1
[block 2] → sendComposing + sleep(delay based on block1 length)
           → deliver
           → set prevBlockText = block2
[block 3] → sendComposing + sleep(delay based on block2 length)
           → deliver
           → set prevBlockText = block3
[final]   → deliver (usually empty)
[done]    → sendAvailable() — clears typing indicator
```

---

## Delay Formula

```ts
Math.max(4000, Math.min(12000, prevBlockText.length * 50))
```

| Chars | Delay    |
|-------|----------|
| ≤80   | 4s (min) |
| 100   | 5s       |
| 150   | 7.5s     |
| 200   | 10s      |
| 240+  | 12s (max)|

---

## Files Changed

| File | What changed |
|------|-------------|
| `src/web/auto-reply/monitor/process-message.ts` | Pre-delivery delay + typing loop + `sendAvailable` after dispatch |
| `src/web/auto-reply/deliver-reply.ts` | Intra-chunk delay (fallback if single block exceeds WA text limit) |
| `src/web/inbound/types.ts` | Added `sendAvailable?: () => Promise<void>` to `WebInboundMsg` |
| `src/web/inbound/monitor.ts` | Implemented `sendAvailable` via `sendPresenceUpdate("available")` |
| `src/gateway/server-methods/chat.ts` | Mirror: reverted delay — delivers paragraphs as-is, no artificial delay |

---

## Mirror (Webchat → WA)

Mirror is **separate**. It streams paragraphs in real-time as the LLM generates them, no delay. This feature does NOT apply to mirror.

---

## Known Limitations & Roadmap

### 1. No per-session/group config yet

Currently the formula is hardcoded. Needs config:

```json
"channels": {
  "whatsapp": {
    "paragraphDelay": {
      "enabled": true,
      "minMs": 4000,
      "maxMs": 12000,
      "msPerChar": 50
    },
    "groups": {
      "GROUP_JID": {
        "paragraphDelay": { "enabled": false }
      }
    }
  }
}
```

### 2. Agent-to-agent messages must bypass delay

When a bot @mentions another agent in a group, the message must arrive as a single complete unit — no paragraph splitting or delay. Agents only process the full tagged block.

**Detection options (TBD):**
- A) Config flag per group (`paragraphDelay.enabled: false` on agent groups)
- B) Runtime — if response @mentions a known agent JID, skip delay
- C) Route-level flag — mark agent-to-agent sessions, skip delay globally

### 3. Typing refresh cap

Refresh interval: 3000ms. WA composing expires ~5s. Works for current max of 12s. For longer delays, lower the refresh interval.

---

## Adjust values

Edit `process-message.ts`:
```ts
const readDelayMs = Math.max(4000, Math.min(12000, prevBlockText.length * 50));
```

Then rebuild: `cd ~/Projects/openclaw && npm run build`
Restart: `launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway`
