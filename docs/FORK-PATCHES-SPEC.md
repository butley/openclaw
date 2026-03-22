# Fork Patches — Implementation Spec for Upstream Rebase

Each section below describes ONE patch group. Implement in order. After each group: `npm run build` + test.

The coding agent should start from a clean `v2026.3.13-1` checkout and apply these changes.

Reference source for ALL patches: branch `alpha` in this repo.

---

## Group 1: Standalone New Files (LOW RISK)

These are new files not in upstream. Copy verbatim from `alpha` branch.

### Files to copy:
```
git show alpha:src/agents/tools/image-generate-tool.ts > src/agents/tools/image-generate-tool.ts
git show alpha:src/cli/logs-pretty-formatter.ts > src/cli/logs-pretty-formatter.ts
git show alpha:src/cli/qmd-cli.ts > src/cli/qmd-cli.ts
git show alpha:src/infra/inbound-events.ts > src/infra/inbound-events.ts
git show alpha:src/web/auto-reply/wa-streaming-utils.ts > src/web/auto-reply/wa-streaming-utils.ts
git show alpha:src/web/auto-reply/wa-verbose-utils.ts > src/web/auto-reply/wa-verbose-utils.ts
git show alpha:src/web/inbound/brazil-jid-resolver.ts > src/web/inbound/brazil-jid-resolver.ts
git show alpha:src/web/inbound/contact-names.ts > src/web/inbound/contact-names.ts
```

### Register in build:
- `image-generate-tool.ts` → register in `src/agents/openclaw-tools.ts`
- `logs-pretty-formatter.ts` → register in `src/cli/logs-cli.ts`
- `inbound-events.ts` → import in `src/infra/agent-events.ts`

---

## Group 2: WhatsApp Patches (LOW RISK)

### Patch #2: Brazil JID Resolution
**File:** `src/web/outbound.ts`
**What:** Before sending a WA message, resolve Brazilian +55 numbers with/without 9th digit using `resolveBrazilianJid()`.
**How:** Import `resolveBrazilianJid` from `./inbound/brazil-jid-resolver.js`. In the send function, replace `toWhatsappJid(to)` with an async call that tries both formats.
**Verify:** `grep -q "resolveJidWithBrazil" src/web/outbound.ts`

### Patch #11: WA Paragraph Streaming  
**File:** `src/web/auto-reply/deliver-reply.ts`
**What:** Stream long WA replies paragraph by paragraph with configurable delay, instead of sending as one block.
**How:** Use `wa-streaming-utils.ts` helpers. Add `streamDelayMs` config option.
**Verify:** `grep -q "streamDelayMs" src/web/auto-reply/deliver-reply.ts`

### Patch #14: WA Outbound Mentions
**File:** `src/web/inbound/send-api.ts`
**What:** Process @mentions in outbound WA messages, converting phone numbers to JIDs.
**Verify:** `grep -q "processOutboundMentions" src/web/inbound/send-api.ts`

### Patch #12: WA Login Tool Dedup
**File:** `extensions/whatsapp/index.ts`
**What:** Prevent duplicate whatsapp_login tool registration.
**Verify:** `grep -q "natively by OpenClaw" extensions/whatsapp/index.ts`

---

## Group 3: UI/UX Patches (LOW RISK)

### Patch #7: TUI Dark Theme
**File:** `src/tui/theme/theme.ts`
**What:** Use color 236 for TUI dark theme background.
**Verify:** `grep -q "236" src/tui/theme/theme.ts`

### Patch #8: Status Card Redesign
**File:** `src/auto-reply/status.ts`
**What:** Aligned columns with `padLabel()`, commit hash display, custom `/status` layout.
**Verify:** `grep -q "padLabel" src/auto-reply/status.ts`

### Patch #10: Logs Pretty Formatter
**Files:** `src/cli/logs-cli.ts`, `src/cli/logs-pretty-formatter.ts` (new file)
**What:** `--pretty` flag for `openclaw logs` command.

### Patch #13: Verbose Light Mode
**Files:** `src/auto-reply/thinking.ts`, `src/tui/commands.ts`
**What:** Add "light" verbose level — brief tool narration without full output.
**Verify:** `grep -q '"light"' src/auto-reply/thinking.ts`

---

## Group 4: Auto-Reply Patches (MEDIUM RISK)

### Patch #3: Audio Transcript Hook
**File:** `src/auto-reply/reply/get-reply.ts`
**What:** Add 🎤 emoji prefix to transcribed audio messages.
**Verify:** `grep -q "🎤" src/auto-reply/reply/get-reply.ts`

### Patch #9: QMD Output Limit
**File:** `src/memory/qmd-manager.ts`
**What:** Add `maxOutputChars` limit to QMD search results.
**Verify:** `grep -q "maxOutputChars" src/memory/qmd-manager.ts`

### Stream Directive (part of #11)
**Files:** `src/auto-reply/reply/directive-handling.impl.ts`, `directive-handling.parse.ts`, `get-reply-directives-apply.ts`, `directives.ts`
**What:** Add `/stream` command for controlling WA paragraph streaming speed.
**How:** Add stream directive alongside existing verbose/thinking directives.

---

## Group 5: Gateway Core Patches (HIGH RISK — implement carefully)

### Patch #4: Chat Mirror
**File:** `src/gateway/server-methods/chat.ts`
**What:** When a message is sent via webchat (Control UI) to a WA session, ensure the reply is delivered to WA (not just echoed back to webchat).
**How:** Set `mirror: true` in `registerAgentRunContext`. In delivery, check mirror flag to enable cross-channel delivery.
**Key:** The `OriginatingChannel` must be `INTERNAL_MESSAGE_CHANNEL` for webchat-originated messages.

### Patch #22: Chat Media Pipeline
**File:** `src/gateway/server-methods/chat.ts`
**What:** Extract `audioUrl`/`imageUrl` from inbound chat messages before sanitization removes them.
**How:** Before `stripEnvelope`, extract media URLs from toolResult details.
**Verify:** `grep -q "audioUrlByIndex" src/gateway/server-methods/chat.ts`

### Patch #23: Chat.send Internal Routing ⚠️ CRITICAL
**File:** `src/gateway/server-methods/chat.ts`
**What:** Control UI messages go through full agent pipeline, not just WS echo. This is what makes webchat→WA delivery work.
**How:** Use `INTERNAL_MESSAGE_CHANNEL` as `OriginatingChannel` for webchat-originated messages. The agent pipeline uses session entry routing, not OriginatingChannel, for actual delivery.
**⚠️ WARNING:** Upstream added `resolveChatSendOriginatingRoute()` which changes this behavior. The upstream function is COMPATIBLE with our approach (returns INTERNAL_MESSAGE_CHANNEL for webchat clients without deliver:true), but test carefully.

### Patch #24: Silent Reply Filter Removal
**File:** `src/gateway/server-methods/chat.ts`
**What:** Remove `extractAssistantTextForSilentCheck` — we handle silent replies differently.
**Verify:** `! grep -q "extractAssistantTextForSilentCheck" src/gateway/server-methods/chat.ts`

### Patch #26: ThinkingDefault Shortcut
**File:** `src/gateway/server-methods/chat.ts`
**What:** Fall back to `agents.defaults.thinkingDefault` config when session has no thinking level set.
**Verify:** `grep -q "thinkingDefault" src/gateway/server-methods/chat.ts`

### Patch #29: Chat Sender Meta
**File:** `src/gateway/server-methods/chat.ts`
**What:** Extract sender name/id from inbound metadata before `stripEnvelope` removes it.
**Verify:** `grep -q "senderMeta" src/gateway/server-methods/chat.ts`

### Patch #30: Chat Group Context
**File:** `src/gateway/server-methods/chat.ts`
**What:** Extract group chat history (who said what) before `stripEnvelope` removes it.
**Verify:** `grep -q "chatHistory" src/gateway/server-methods/chat.ts`

### Patch #25: HTTP Tools Channel Registration
**File:** `src/gateway/tools-invoke-http.ts`
**What:** Include channel plugin tools in HTTP tool invoke endpoint.
**Verify:** `grep -q "listChannelAgentTools" src/gateway/tools-invoke-http.ts`

---

## Group 6: SSE Streaming Pipeline (HIGHEST RISK — the hard part)

⚠️ This is the group that broke during the merge. Must be implemented understanding the UPSTREAM v2026.3.13 patterns, not copied from alpha.

### Patch #18: SSE Streaming Endpoint (NEW FILE)
**File:** `src/gateway/server-sse.ts` (460 lines)
**What:** HTTP SSE endpoint at `/api/sse/stream?sessionKey=...` that streams events to the Butley frontend in AI SDK Data Stream Protocol format.
**Subscribes to:** `gatewayEventBus` events: "chat", "agent", "message.inbound"
**Emits:** text-start/delta/end, reasoning-start/delta/end, tool-input-start/available, tool-output-available, finish-step/finish, user-message, connected, error, abort
**How it works:**
1. Client connects with sessionKey
2. SSE handler subscribes to gatewayEventBus
3. For "chat" events (state=delta): extract text, compute delta from last position, emit text-delta
4. For "agent" events (stream=thinking): extract rawDelta, emit reasoning-delta
5. For "agent" events (stream=tool, phase=start): emit tool-input-start + tool-input-available
6. For "agent" events (stream=tool, phase=result): emit tool-output-available
7. For "chat" events (state=final): emit finish-step + finish
**⚠️ SESSION MATCHING:** Must use exact sessionKey match (not prefix). Must reset `lastTextLen` and `lastReasoningLen` between tool turns.
**Source:** Copy from alpha but verify all event types match upstream's event format in 0.58.0.

### Patch #31: SSE EventBus Singleton
**File:** `src/gateway/server-broadcast.ts`
**What:** The `gatewayEventBus` (EventEmitter) must be a globalThis singleton to survive bundler chunk duplication.
**Why:** The bundler splits server-broadcast.ts into multiple chunks. Without globalThis, broadcast() emits on one EventEmitter instance while SSE listens on another.
**How:** Use `globalThis.__openclaw_gatewayEventBus__` with existence check.
**Verify:** `grep -q "__openclaw_gatewayEventBus__" src/gateway/server-broadcast.ts`
**⚠️ CRITICAL:** The upstream broadcast function already has `gatewayEventBus.emit()` — make sure the singleton pattern wraps it.

### Patch #15: Webchat Thinking Stream
**File:** `src/agents/pi-embedded-subscribe.ts`
**What:** Hardcode `streamReasoning: true` so thinking blocks always reach WS/SSE clients.
**Changes:**
1. Line ~48: `streamReasoning: true` (instead of conditional)
2. In `emitReasoningStream`: remove `!params.onReasoningStream` guard
3. Guard the `params.onReasoningStream({text})` call with `if (params.onReasoningStream)`
**⚠️ Pi SDK 0.58.0 COMPAT:** The upstream version of this file is compatible with Pi SDK 0.58.0. Do NOT copy from alpha — modify the upstream file with these 3 surgical changes.

### Patch #16: Tool Events Broadcast
**File:** `src/gateway/server-chat.ts`
**What:** Broadcast ALL tool events to ALL connected WS clients (not just registered recipients). Also flush pending text delta before tool events.
**How:** In `createAgentEventHandler`, for `isToolEvent`: call `broadcast("agent", toolPayload)` for ALL clients, not just `broadcastToConnIds` for targeted recipients.
**⚠️ UPSTREAM CHANGE:** Upstream added `broadcastToConnIds("agent", toolPayload, recipients)` for targeted delivery. Keep that, but ALSO add generic `broadcast("agent", toolPayload)` for all clients.

### Patch #17: Streaming Throttle
**File:** `src/gateway/server-chat.ts`
**What:** 50ms debounce on chat deltas to prevent WS flood during fast generation.
**How:** Track `deltaSentAt` per clientRunId. Skip if < 50ms since last delta.

### Agent Events Singleton
**File:** `src/infra/agent-events.ts`
**What:** All module-level state (seqByRun, listeners, runContextById) must use globalThis lazy getter pattern.
**Why:** With 14+ bundler chunks, module-level Maps get duplicated. registerAgentRunContext writes to chunk A's Map, emitAgentEvent reads from chunk B's → thinking events lose sessionKey.
**How:** Replace module-level `const seqByRun = new Map()` etc. with a `getState()` function that reads/creates from `globalThis.__openclaw_agentEvents__`.
**⚠️ CRITICAL:** Must use LAZY GETTER (function call, not const assignment) to avoid ESM import hoisting race.

### Model Reasoning Override
**File:** `src/agents/pi-embedded-runner/run/attempt.ts`
**What:** Force `reasoning: true` on the model object for `anthropic-messages` API models.
**Why:** Anthropic API discovery reports `reasoning: false`, but Pi SDK requires `model.reasoning=true` to send thinking params.
**How:** Before passing model to Pi SDK session: `model.api === "anthropic-messages" && !model.reasoning ? {...model, reasoning: true} : model`

---

## Group 7: Gateway Infrastructure (MEDIUM RISK)

### Patch #5: WS Inbound Push
**File:** `src/infra/agent-events.ts`
**What:** Add `mirror` field to `AgentRunContext` type.
**Also:** `isControlUiVisible` field (required by upstream).

### Patch #19: Gateway Media Endpoint
**File:** `src/gateway/server-http.ts`
**What:** Add `/media` endpoint for serving media files.
**How:** Import `handleSseStream` from server-sse.ts. Add route handler.

### Patch #21: Chat Audio Inbound
**File:** `src/gateway/chat-attachments.ts`
**What:** Handle audio attachments in chat messages (voice notes).

### Patch #27: Media Inbound Path
**File:** `src/gateway/server-http.ts`
**What:** Add inbound media path handling.

---

## Verification

After all patches: run `bash patches/verify-patches.sh .`

Expected: 28/29 pass (Patch #28 SSE Cron Filter is intentionally unimplemented).

## Test Chain (MANDATORY)

After implementation, test in this order:
1. `npm run build` — must pass
2. Text streaming in Butley frontend (SSE text-delta events)
3. Tool call streaming (tool-input-start/available events in real-time)
4. Thinking streaming (reasoning-start/delta events visible in frontend)
5. Webchat → WA delivery (message sent from Control UI arrives on WhatsApp)
6. WA inbound → response (message from WA triggers agent response)
7. `openclaw doctor --fix` passes
