# Fork Patch Refactor — Deep Diagnostic Traces

> Created: 2026-03-24
> Purpose: Permanent record of the diagnostic analysis behind each patch refactor.
> These traces were done during the v3.22 rebase hardening session.
> Without this file, re-debugging would require re-tracing from scratch.

---

## P15 — Reasoning Stream Guard Split

### The Bug (v3.22)

Upstream merged two independent guards into one AND condition in `pi-embedded-subscribe.ts`:

```ts
if (!state.streamReasoning || !params.onReasoningStream) return;
```

This killed `emitAgentEvent({stream:"thinking"})` for webchat because webchat never passes `onReasoningStream`.

### Full Trace: Why webchat doesn't pass `onReasoningStream`

1. **Webchat sends a message** → hits `server-methods/chat.ts` → calls `dispatch-from-config.ts`
2. `dispatch-from-config.ts` calls `resolveRunTypingPolicy()`:
   - Input: `originatingChannel === INTERNAL_MESSAGE_CHANNEL` (webchat is "internal")
   - Output: `typingPolicy = 'internal_webchat'`
3. `resolveRunTypingPolicy` feeds into `resolveTypingMode()`:
   - Input: `typingPolicy = 'internal_webchat'`
   - Output: `mode = 'never'` (webchat handles its own typing via SSE)
4. `createTypingSignaler()` reads `mode = 'never'`:
   - Sets `shouldStartOnReasoning = false`
5. `agent-runner-execution.ts` checks `shouldStartOnReasoning`:
   - `false` → `onReasoningStream = undefined` (callback not created)
6. `pi-embedded-subscribe.ts` gets `params.onReasoningStream = undefined`:
   - **Old upstream guard:** `if (!state.streamReasoning) return;` → PASSES (streamReasoning is true from config)
   - **New upstream guard:** `if (!state.streamReasoning || !params.onReasoningStream) return;` → FAILS (onReasoningStream is undefined)
   - `emitAgentEvent` never fires → no thinking events on WS/SSE → Butley frontend shows no reasoning

### The Fix

Split guards back to alpha structure:
```ts
if (!state.streamReasoning) return;           // config check only
emitAgentEvent({ stream: "thinking", ... });  // ALWAYS broadcast to WS/SSE
if (params.onReasoningStream) {               // optional channel callback
  params.onReasoningStream({ text });
}
```

**Rationale:** `emitAgentEvent` (broadcast to WS/SSE) and `onReasoningStream` (channel-specific callback like WA typing) are independent concerns. A webchat user needs thinking events via SSE even though no channel callback exists.

### Files touched
- `src/agents/pi-embedded-subscribe.ts` — the guard split (~10 lines)

### If this breaks again after a future merge
1. Search for `emitAgentEvent.*thinking` in `pi-embedded-subscribe.ts`
2. Check if it's gated on `onReasoningStream` — if yes, split the guard
3. The root issue: `dispatch-from-config.ts` doesn't pass `onReasoningStream` for webchat, and that's BY DESIGN (upstream comment: "channels using this generic dispatch path do not have a dedicated reasoning lane")

---

## P16 — Session-Scoped Tool Broadcast

### The Bug

Original P16 used `broadcast("agent", toolPayload)` in `server-chat.ts`. This sent tool events to ALL connected WS/SSE clients regardless of which session they were watching. In a multi-tenant Butley deployment, User A could see User B's tool calls.

### The Discovery

During the hardening audit, I (Bob) noticed that `broadcast()` in `server-broadcast.ts` sends to every connection ID in the global registry. Tool events contain session-specific data (tool names, arguments, results). Cross-session leak = security issue for Butley SaaS.

### How the fix works

The gateway already has `sessionMessageSubscribers` — a `Map<sessionKey, Set<connId>>` managed by `sessions.ts`. When a client calls `sessions.messages.subscribe`, their connection ID gets added to the Set for that sessionKey. When they unsubscribe or disconnect, it's removed.

Fix uses this existing infrastructure:
```ts
// In createAgentEventHandler (server-chat.ts):
if (sessionKey) {
  const msgSubscribers = sessionMessageSubscribers.get(sessionKey);
  if (msgSubscribers.size > 0) {
    _broadcastToConnIds("agent", toolPayload, msgSubscribers, { dropIfSlow: true });
  }
}
```

**Wiring:** Added `sessionMessageSubscribers: SessionMessageSubscriberRegistry` to the `AgentEventHandlerOptions` type. Passed from `server.impl.ts` where the registry already exists.

### Key detail: `.get()` returns empty Set, not undefined
`SessionMessageSubscriberRegistry.get()` always returns a Set (empty if no subscribers). Safe for `.size` check without null guards.

### P16 buffer reset (lines 751-758)
The other part of P16 deletes `chatRunState.buffers` and `deltaLastBroadcastLen` when a tool-start event arrives. This prevents text content from the pre-tool phase from being duplicated in the tool output phase. Left inline with comments — worst case if upstream changes buffer management: becomes no-op, original text duplication bug returns, no crash risk.

### Files touched
- `src/gateway/server-chat.ts` — broadcast replacement + `AgentEventHandlerOptions` type
- `src/gateway/server.impl.ts` — passes `sessionMessageSubscribers` to handler

### If this breaks after a future merge
1. Check if `SessionMessageSubscriberRegistry` still exists and has `.get(key)` method
2. Check if `_broadcastToConnIds` still accepts `(channel, payload, connIds, options)`
3. If upstream adds its own session-scoped tool delivery, compare approaches

---

## P4 — Chat Mirror Extraction

### The Bug (maintenance, not runtime)

`server-chat.ts` had a 20-line mirror block copy-pasted identically in two places:
1. Success path (after message delivered)
2. Error/fallback path

Both blocks did the same thing: parse `sessionKey` to extract `channel` and `peerId`, validate it's a WA channel, call `sendMessageWhatsApp`. Any change had to be made twice, and upstream changes to `server-chat.ts` caused double merge conflicts.

### The Fix

Extracted to `src/gateway/chat-mirror.ts`:
```ts
export async function maybeMirrorToChannel(sessionKey, text, context) {
  // parse channel + peerId from sessionKey
  // validate WA channel
  // call sendMessageWhatsApp
}
```

Both call sites in `server-chat.ts` now call `maybeMirrorToChannel()` — 1 line each.

### Why this matters for Butley
Chat mirror is how webchat messages get delivered to WA. Without it, the Butley dashboard can't send messages to WhatsApp users. It's core Butley functionality.

### Files touched
- `src/gateway/chat-mirror.ts` (NEW — ~50 lines)
- `src/gateway/server-chat.ts` (−40 lines inline, +2 import + call lines)

---

## P8 — Status Card Extraction

### The Problem

`src/auto-reply/status.ts` had 78 lines of formatting code inline: `padLabel()`, Unicode symbols (◈, ∴, ↩, ↕), code block wrapping, provider label extraction. Upstream constantly changes the data-gathering logic in `status.ts` (token counting, model resolution, auth labels). Every upstream merge = conflict in our formatting code.

### The Fix

Extracted to `src/auto-reply/status-card-format.ts`:
- `formatStatusCard(data: StatusCardData): string` — pure function
- Takes typed data, returns formatted string
- `status.ts` gathers data (upstream can change freely), calls `formatStatusCard()`

### Files touched
- `src/auto-reply/status-card-format.ts` (NEW — 93 lines)
- `src/auto-reply/status.ts` (−78 lines inline, +1 import + call)

---

## P17 — Streaming Throttle Named Constant

### The Problem

Hardcoded `50` in `if (now - last < 50)` deep inside `server-chat.ts`. If you didn't know it was there, you'd never find it. Upstream uses 150ms. We changed to 50ms for snappier streaming in the Butley dashboard. Magic numbers in hot code paths are a maintenance hazard.

### The Fix

```ts
// [FORK-PATCH-17] Streaming delta throttle (ms). Upstream default: 150ms.
// Lower = snappier dashboard streaming, higher = less WS traffic.
const STREAM_DELTA_THROTTLE_MS = 50;
```

Top of file, with comments explaining the tradeoff.

---

## Authorship Summary (what I know)

| Patch | Author | Origin |
|-------|--------|--------|
| P2 | Bob | Brazil JID delivery failures |
| P3 | Bob | Audio transcript hook (ABSORBED by upstream) |
| P4 | Bob + Guilherme (original), Bob (extraction) | Webchat→WA cross-channel |
| P5 | Bob | Butley dashboard inbound events |
| P7 | Bob | TUI readability preference |
| P8 | Bob (original + extraction) | Luke wanted prettier /status |
| P9 | Bob | QMD output flooding context |
| P10 | Bob | CLI log readability |
| P11 | Bob | WA wall-of-text UX |
| P13 | Bob | Luke: "Gosto q anuncie" — tool narration |
| P14 | Bob | WA @mention formatting |
| P15 | Bob (guard split analysis + fix) | Thinking broken in webchat/Butley |
| P16 | Bob (original + session scoping) | Tool events for Butley dashboard |
| P17 | Bob (original + named constant) | Snappier streaming UX |
| P18 | Bob | SSE endpoint for Butley frontend |
| P19 | Bob | Media serving for Butley |
| P21 | Guilherme | Audio attachment handling |
| P22 | Bob | Media URL extraction pre-sanitization |
| P23 | Bob | Control UI routing fix |
| P24 | ademczuk upstream, Guilherme removed gateway layer | Silent reply filter |
| P25 | Bob | Tool registration for HTTP invoke |
| P26 | Bob | Config-driven thinking default |
| P27 | Bob | Inbound media path |
| P29 | Bob | Sender metadata preservation |
| P30 | Bob | Group chat context preservation |
| P31 | Bob | EventBus bundler chunk fix |
| P32 | Bob | Retryable error handling for SSE |

---

## Lessons

1. **Save diagnostic traces immediately** — this file exists because the original traces were lost to LCM compaction within 2 hours of creation
2. **"Why" matters more than "what"** — code shows what changed, only docs show why
3. **Permanent files > chat context** — anything that took >10 min to figure out goes in a file
