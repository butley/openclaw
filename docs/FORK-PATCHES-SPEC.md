# Fork Patches — Implementation Spec

> **Historical document.** Originally written for the v3.13→v3.22 rebase (2026-03-23).
> Updated 2026-03-24 post-hardening audit.
>
> For current patch status, see `docs/fork-patches.md` and `docs/FORK-NEXT-STEPS.md`.
> For known issues, see `patches/KNOWN-ISSUES.md`.
> For verification, run `patches/verify-patches.sh`.

---

## Purpose

This spec provides everything needed to re-implement fork patches on a new upstream release.
Written after the v3.22 rebase to capture the exact implementation pattern for each patch.

## Quick Reference

**Total active patches:** 22 (on `feat/rebase-3.22`)
**Absorbed by upstream:** 5 (P1, P3, P6, P12, P20)
**Dropped:** 1 (P28 — replaced by P16 session scoping)
**Pending decision:** 2 (P21, P24)

---

## Implementation Order for Future Rebases

### Phase 1: Own Files (zero risk)

Copy these from the rebase branch. They don't exist in upstream.

```
src/auto-reply/status-card-format.ts          # P8 (extracted)
src/cli/logs-pretty-formatter.ts              # P10
src/gateway/chat-mirror.ts                    # P4 (extracted)
src/gateway/server-sse.ts                     # P18
src/infra/inbound-events.ts                   # P5
extensions/whatsapp/src/inbound/brazil-jid-resolver.ts  # P2
extensions/whatsapp/src/inbound/contact-names.ts        # P11/P14
```

### Phase 2: Additive Changes (low risk)

These add lines without modifying upstream code. Apply in any order.

| Patch | File | What to add |
|-------|------|-------------|
| P7 | `src/tui/theme/theme.ts` | Color 236 for dark background |
| P9 | `src/memory/qmd-manager.ts` | `maxOutputChars` config |
| P13 | `src/auto-reply/thinking.shared.ts` | `"light"` level in VerboseLevel type |
| P25 | `src/gateway/tools-invoke-http.ts` | Import + register channel tools |
| P26 | `src/gateway/server-methods/chat.ts` | `thinkingDefault` early return |
| P29 | `src/gateway/server-methods/chat.ts` | `senderMeta` extraction |
| P30 | `src/gateway/server-methods/chat.ts` | `chatHistory` extraction |
| P31 | `src/gateway/server-broadcast.ts` | `globalThis.__openclaw_gatewayEventBus__` |
| P32 | `src/gateway/server-chat.ts` | `RETRYABLE_LIFECYCLE_ERROR_RE` guard |

### Phase 3: Imports + Hooks (medium risk)

Connect the new files to the existing codebase.

| Patch | File | Hook |
|-------|------|------|
| P2 | `extensions/whatsapp/src/send.ts` | Import `brazil-jid-resolver`, call in send path |
| P4 | `src/gateway/server-chat.ts` | Import `chat-mirror.ts`, replace inline mirror code with `maybeMirrorToChannel()` |
| P5 | `src/infra/agent-events.ts` | Add `mirror` field to `AgentRunContext` |
| P8 | `src/auto-reply/status.ts` | Import `formatStatusCard`, replace inline formatting |
| P10 | `src/cli/logs-cli.ts` | Import formatter, add `--pretty` flag |
| P11 | `extensions/whatsapp/src/auto-reply/deliver-reply.ts` | Hook paragraph streaming |
| P14 | `extensions/whatsapp/src/inbound/send-api.ts` | Import + call `processOutboundMentions` |
| P19 | `src/gateway/server-http.ts` | Add `/media` route handler |
| P27 | `src/gateway/server-http.ts` | Add inbound media path |

### Phase 4: Streaming Pipeline (high risk — test thoroughly)

These touch the core event flow. Apply carefully, test after each.

| Patch | File | What | Key Consideration |
|-------|------|------|-------------------|
| P15 | `src/agents/pi-embedded-subscribe.ts` | Split reasoning guards | Check upstream guard structure — may have changed again |
| P16 | `src/gateway/server-chat.ts` + `server.impl.ts` | Session-scoped tool broadcast | Verify `SessionMessageSubscriberRegistry` API |
| P17 | `src/gateway/server-chat.ts` | `STREAM_DELTA_THROTTLE_MS` constant | Check upstream throttle value |
| P22 | `src/gateway/server-methods/chat.ts` | Media pipeline extraction | Before `stripEnvelope` |
| P23 | `src/gateway/server-methods/chat.ts` + `message-channel.ts` | Internal routing | Check `resolveChatSendOriginatingRoute` compat |

### Phase 5: Verify

```bash
bash patches/verify-patches.sh .
# All 25 must pass
```

---

## Patch Detail: P15 — Reasoning Guard Split

This is the most critical patch for streaming correctness.

**Upstream pattern (v3.22):**
```ts
if (!state.streamReasoning || !params.onReasoningStream) return;
// both emitAgentEvent AND onReasoningStream are skipped
```

**Our pattern:**
```ts
if (!state.streamReasoning) return;           // config check: skip everything
emitAgentEvent({ stream: "thinking", ... });  // always broadcast to WS/SSE
if (params.onReasoningStream) {               // optional: channel callback (WA typing)
  params.onReasoningStream({ text });
}
```

**Why:** Broadcast (WS/SSE) and channel callback (WA typing indicator) are independent concerns.
Webchat doesn't pass `onReasoningStream` but still needs thinking events via SSE.

**On future merges:** If upstream changes the guard again, look for the `emitAgentEvent` call
for thinking events and ensure it's NOT gated on `onReasoningStream`.

---

## Patch Detail: P16 — Session-Scoped Tool Broadcast

**Upstream pattern:**
```ts
// Sends to run-scoped recipients (registered with runId)
const recipients = toolEventRecipients.get(evt.runId);
_broadcastToConnIds("agent", toolPayload, recipients);
// Sends to global session subscribers
_broadcastToConnIds("session.tool", toolPayload, sessionSubscribers);
```

**Our addition (after upstream code):**
```ts
// Session-scoped: webchat clients subscribed via sessions.messages.subscribe
if (sessionKey) {
  const msgSubscribers = sessionMessageSubscribers.get(sessionKey);
  if (msgSubscribers.size > 0) {
    _broadcastToConnIds("agent", toolPayload, msgSubscribers, { dropIfSlow: true });
  }
}
```

**Wiring:** `sessionMessageSubscribers` passed to `createAgentEventHandler` via
`AgentEventHandlerOptions` (1 line in `server.impl.ts`).

**On future merges:** If upstream adds its own session-scoped tool delivery, compare
with ours. Ours uses `sessions.messages.subscribe` registry — upstream might use a
different mechanism.

---

## Test Chain (MANDATORY after any rebase)

1. `npm run build` — must pass
2. Text streaming in webchat (SSE text-delta events)
3. Tool call streaming (live tool cards appear during execution)
4. Thinking streaming (reasoning-delta events visible)
5. Webchat → WA mirror delivery
6. WA inbound → agent response
7. `/status` card formatting
8. `openclaw doctor --fix`
9. `bash patches/verify-patches.sh .` — 25/25
