# Butley Custom Patches

**Fork:** `butley/openclaw` (branch `dev`)  
**Upstream:** `openclaw/openclaw` (branch `main`)  
**Last sync analysis:** 2026-02-05  

---

## Active Patches (7)

### 1. WhatsApp Opus TTS
**Files:** `src/agents/tools/tts-tool.ts`, `src/tts/tts.ts`, `src/web/outbound.ts`  
**Purpose:** Enables opus audio format for TTS output on WhatsApp. Upstream only supports default formats.  
**Why we need it:** WhatsApp voice notes require opus; upstream doesn't support this natively.

### 2. Brazil JID Resolution
**Files:** `src/web/inbound/brazil-jid-resolver.ts` (NEW, 240 lines), `src/web/inbound/monitor.ts`, `src/web/inbound/send-api.ts`  
**Purpose:** Resolves Brazilian phone numbers (+55) to WhatsApp JIDs, handling the country's unique 8→9 digit mobile number migration.  
**Why we need it:** Brazil has inconsistent phone number formats. Without this, messages fail to deliver to ~30% of Brazilian numbers.  
**Upstream candidate:** Yes — could benefit all Brazilian WhatsApp users.

### 3. Audio Transcript Hook
**Files:** `src/auto-reply/reply/get-reply.ts`  
**Purpose:** Fires `message_received` event with `🎤 {transcript}` when audio messages are transcribed, enabling logging/dashboard integration.  
**Why we need it:** Powers the WhatsApp message logger and dashboard real-time audio display.

### 4. Chat Mirror (Web → WhatsApp)
**Files:** `src/gateway/server-chat.ts`, `src/gateway/server-methods/chat.ts`, `src/infra/agent-events.ts`  
**Purpose:** Echoes agent replies from webchat/TUI back to the WhatsApp conversation, enabling "puppet mode" where Luke types in dashboard and messages go to WhatsApp.  
**Why we need it:** Core feature for the Butley dashboard — control WhatsApp conversations from the web UI.  
**⚠️ Merge note:** This patch touches `server-methods/chat.ts` which has the only upstream conflict. Needs adaptation to upstream's new `createReplyPrefixOptions` API.

### 5. WebSocket Inbound Push
**Files:** `src/infra/inbound-events.ts` (NEW, 192 lines), `src/auto-reply/reply/dispatch-from-config.ts`, `src/gateway/server-close.ts`, `src/gateway/server-methods-list.ts`, `src/gateway/server.impl.ts`  
**Purpose:** Real-time WebSocket push notifications for inbound messages. Adds `message.inbound` event to gateway events with full message metadata.  
**Why we need it:** Powers dashboard real-time message feed without polling.  
**Upstream candidate:** Yes — useful for any dashboard/monitoring tool.

### 6. TTS Caption Logging
**Files:** `src/gateway/protocol/schema/logs-chat.ts`, `src/web/active-listener.ts`  
**Purpose:** Logs TTS caption text alongside audio messages for searchability and transcript display.  
**Why we need it:** Without this, voice messages appear as opaque audio blobs in logs — no way to search or display what was said.

### 7. TUI Dark Theme
**Files:** `src/tui/theme/theme.ts`  
**Purpose:** Darker background colors for `userBg`, `toolPendingBg`, `toolErrorBg`, `toolOutput`.  
**Why we need it:** Cosmetic preference. Will be customized further as we build out the Butley terminal experience.

---

## Upstream Sync Status

| Date | Ahead | Behind | Conflicts | Notes |
|------|-------|--------|-----------|-------|
| 2026-02-05 | 7 | 198 | 1 (`chat.ts` imports) | Merge pending |
| 2026-02-03 | 7 | 192 | 1 | Initial analysis |

---

## Merge Strategy

1. **Backup:** `git checkout -b dev-pre-merge`
2. **Merge:** `git merge upstream/main --no-ff`
3. **Resolve:** Fix import conflict in `server-methods/chat.ts` (keep upstream's `createReplyPrefixOptions`, add our `registerAgentRunContext`)
4. **Adapt:** Update mirror feature to use new prefix API
5. **Build:** `npm run build`
6. **Test:** WhatsApp send/receive, mirror, TTS, Brazil JID, inbound push events
7. **Tag:** `git tag upstream-merge-YYYY-MM-DD`
