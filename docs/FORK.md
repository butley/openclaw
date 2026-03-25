# Butley Fork — butley/openclaw

22 active patches on `feat/rebase-3.22` (base: upstream v2026.3.22).
Last updated: 2026-03-24.

---

## Branch Structure

| Branch | Base | Status |
|--------|------|--------|
| `feat/rebase-3.22` | v2026.3.22 | ✅ Waves 1-6 + hardening. Wave 7 (build+test) awaiting approval |
| `alpha` | ~v2026.3.13-1 | ⚠️ Current production — will be superseded |

---

## Patch Registry

### Legend
- **Own file** = zero merge conflict risk
- **Additive** = adds code without modifying upstream
- **Extracted** = was inline, hardened to own file
- **Scoped** = was global, hardened to session-only

### Core

| # | Name | Type | Files |
|---|------|------|-------|
| P2 | Brazil JID Resolution | Own file + hook | `brazil-jid-resolver.ts`, `send.ts` |
| P4 | Chat Mirror | Bulletproof rewrite | `chat-mirror.ts` (own registry), `server-chat.ts` (onFinalText callback), `chat.ts` (extractMirrorParam) |
| P5 | WS Inbound Push | Own file + additive | `inbound-events.ts`, `agent-events.ts` |
| P7 | TUI Dark Theme | 1 line | `theme.ts` |
| P8 | Status Card | Extracted → own file | `status-card-format.ts`, `status.ts` |
| P9 | QMD Output Limit | Additive config | `qmd-manager.ts`, `backend-config.ts` |
| P10 | Logs Pretty Formatter | Own file + flag | `logs-pretty-formatter.ts`, `logs-cli.ts` |
| P13 | Verbose Light | Additive | `thinking.shared.ts` |

### WhatsApp

| # | Name | Type | Files |
|---|------|------|-------|
| P11 | WA Paragraph Streaming | Own helpers + hook | `deliver-reply.ts` |
| P14 | WA Outbound Mentions | Isolated transform | `send-api.ts`, `contact-names.ts` |

### Streaming Pipeline

| # | Name | Type | Files |
|---|------|------|-------|
| P15 | Webchat Thinking Stream | Guard split | `pi-embedded-subscribe.ts` |
| P16 | Tool Events Broadcast | Scoped → session-only | `server-chat.ts`, `server.impl.ts` |
| P17 | Streaming Throttle | Named constant | `server-chat.ts` |
| P18 | SSE Endpoint | Own file (~460 lines) | `server-sse.ts` |
| P31 | SSE EventBus Singleton | `globalThis` pattern | `server-broadcast.ts` |
| P32 | SSE Retryable Error | Additive guard | `server-chat.ts` |

### Gateway

| # | Name | Type | Files |
|---|------|------|-------|
| P19 | Media Endpoint | Additive route | `server-http.ts` |
| P22 | Chat Media Pipeline | Pre-sanitization extract | `server-methods/chat.ts` |
| P23 | Chat.send Internal Routing | Routing override | `server-methods/chat.ts`, `message-channel.ts` |
| P23b | Control UI Scope Preservation | ⚠️ Provisional — 1 condition | `message-handler.ts` |
| P25 | HTTP Tools Channel Reg | Additive import | `tools-invoke-http.ts` |
| P26 | ThinkingDefault Shortcut | Additive early return | `server-methods/chat.ts` |
| P27 | Media Inbound Path | Additive route | `server-http.ts` |
| P29 | Chat Sender Meta | Pre-sanitization extract | `server-methods/chat.ts` |
| P30 | Chat Group Context | Pre-sanitization extract | `server-methods/chat.ts` |

### Absorbed by Upstream

| # | Name | Absorbed in |
|---|------|-------------|
| P1 | WA Opus TTS | v2026.3.1 |
| P3 | Audio Transcript Hook | v2026.3.22 |
| P6 | TTS Caption Logging | v2026.2.26 |
| P12 | WA Login Tool Dedup | v2026.3.22 |
| P20 | Image Generate Tool | v2026.3.22 |

### Dropped / Pending

| # | Name | Status |
|---|------|--------|
| P21 | Chat Audio Inbound | Pending — upstream removed `ChatAudioAttachment` type |
| P24 | Silent Reply Filter | Skipped — no evidence of bug |
| P28 | SSE Cron Filter | Dropped — replaced by P16 session scoping |

---

## Merge Resilience

**Zero conflict (own files):** P2, P4, P5, P8, P10, P11, P18
**Minimal conflict (additive):** P7, P9, P13, P25, P26, P29, P30, P31, P32
**Watch closely (inline mods):** P15, P16, P17, P22, P23, P23b

---

## Streaming Pipeline — Integration Map

```
Butley Frontend (SSE client)
  └── GET /api/sse/stream?sessionKey=...
       └── server-sse.ts [P18]
            ├── Subscribes to gatewayEventBus [P31 singleton]
            ├── "chat" delta  → text-start/text-delta/text-end
            ├── "agent" tool  → tool-input-start/available/output
            ├── "agent" think → reasoning-start/delta/end
            └── "chat" final  → finish-step/finish

Gateway Event Flow:
  Pi SDK session
    └── pi-embedded-subscribe.ts [P15: guard split]
         ├── emitAgentEvent({stream:"tool"})
         ├── emitAgentEvent({stream:"thinking"})   ← P15 ensures this fires
         └── emitAgentEvent({stream:"assistant"})
              │
              └── agent-events.ts [P5: mirror field]
                   │
                   └── createAgentEventHandler (server-chat.ts)
                        ├── Tool events: session-scoped broadcast [P16]
                        ├── Delta throttle: STREAM_DELTA_THROTTLE_MS [P17]
                        ├── Retryable errors: don't finalize [P32]
                        ├── Chat mirror: maybeMirrorToChannel() [P4]
                        └── broadcast() → gatewayEventBus [P31] → SSE [P18]
```

---

## Diagnostic Traces

Deep analysis of the hardening fixes. Saved here so re-debugging doesn't start from scratch.

### P15 — Reasoning Stream Guard Split

**Bug:** Upstream v3.22 merged two independent guards:
```ts
if (!state.streamReasoning || !params.onReasoningStream) return;
```
This killed `emitAgentEvent` for webchat because webchat never passes `onReasoningStream`.

**Full trace — why webchat doesn't pass `onReasoningStream`:**

1. Webchat sends message → `server-methods/chat.ts` → `dispatch-from-config.ts`
2. `resolveRunTypingPolicy()` → `typingPolicy = 'internal_webchat'` (webchat = internal channel)
3. `resolveTypingMode()` → `mode = 'never'` (webchat handles typing via SSE)
4. `createTypingSignaler()` → `shouldStartOnReasoning = false`
5. `agent-runner-execution.ts` → `onReasoningStream = undefined` (no callback created)
6. `pi-embedded-subscribe.ts` → combined guard fails → `emitAgentEvent` never fires → no thinking in SSE

**Fix:** Split guards. `emitAgentEvent` depends only on `state.streamReasoning` (config). `onReasoningStream` is optional, called separately. Broadcast (WS/SSE) and channel callback (WA typing) are independent concerns.

**If it breaks after a merge:** Search for `emitAgentEvent.*thinking` in `pi-embedded-subscribe.ts`. If gated on `onReasoningStream` → split the guard. Root cause: `dispatch-from-config.ts` doesn't pass `onReasoningStream` for webchat by design.

### P16 — Session-Scoped Tool Broadcast

**Bug:** `broadcast("agent", toolPayload)` sent to ALL connected WS/SSE clients regardless of session. Cross-session data leak in multi-tenant.

**Fix:** Uses existing `sessionMessageSubscribers` registry (`Map<sessionKey, Set<connId>>` managed by `sessions.ts`). Only clients subscribed to that session via `sessions.messages.subscribe` receive tool events.

```ts
const msgSubscribers = sessionMessageSubscribers.get(sessionKey);
if (msgSubscribers.size > 0) {
  _broadcastToConnIds("agent", toolPayload, msgSubscribers, { dropIfSlow: true });
}
```

**Key detail:** `.get()` returns empty Set (not undefined) — safe for `.size` check.

**Buffer reset** (lines 751-758): Deletes `chatRunState.buffers` on tool-start to prevent text duplication. Worst case if upstream changes buffer management: becomes no-op.

**If it breaks:** Verify `SessionMessageSubscriberRegistry` still has `.get(key)` and `_broadcastToConnIds` signature unchanged.

### P4 — Chat Mirror (Bulletproof Architecture)

**Problem:** Webchat messages need to mirror replies to WhatsApp. Previous implementations broke on every upstream merge due to tight coupling with AgentRunContext, buffer lifecycle, and schema validation.

**Architecture (v3.22 rewrite):**
1. **Self-contained registry** — `chat-mirror.ts` owns a `Map<runId, MirrorEntry>` via `globalThis[Symbol.for()]`. No dependency on upstream `AgentRunContext`.
2. **`onFinalText` callback** — `emitChatFinal` accepts `opts?: { onFinalText? }`. Text delivered to callback BEFORE buffer cleanup. Structurally prevents buffer-after-delete bugs.
3. **Schema-free param extraction** — `extractMirrorParam()` strips `mirror` from raw params BEFORE schema validation. Upstream `additionalProperties: false` can never reject it.

**Upstream touch surface:** ~4 lines in `server-chat.ts` + ~4 lines in `chat.ts`. All trivially mergeable.

**Merge guide:** See `patches/chat-mirror/README.md` for detailed instructions.

### P8 — Status Card Extraction

**Problem:** 78 lines formatting inline in `status.ts`. Upstream changes data-gathering constantly.

**Fix:** `src/auto-reply/status-card-format.ts` → `formatStatusCard()`. Pure function, typed input, formatted output. `status.ts` gathers data, calls the function.

### P17 — Named Constant

**Problem:** Hardcoded `50` deep in `server-chat.ts`. Upstream uses 150ms. Invisible in merges.

**Fix:** `STREAM_DELTA_THROTTLE_MS = 50` at top of file.

---

## Implementation Order for Future Rebases

### Phase 1: Own Files (zero risk)
Copy from rebase branch — these don't exist upstream:
```
src/auto-reply/status-card-format.ts          # P8
src/cli/logs-pretty-formatter.ts              # P10
src/gateway/chat-mirror.ts                    # P4
src/gateway/server-sse.ts                     # P18
src/infra/inbound-events.ts                   # P5
extensions/whatsapp/src/inbound/brazil-jid-resolver.ts  # P2
extensions/whatsapp/src/inbound/contact-names.ts        # P11/P14
```

### Phase 2: Additive Changes (low risk)

| Patch | File | What to add |
|-------|------|-------------|
| P7 | `theme.ts` | Color 236 |
| P9 | `qmd-manager.ts` | `maxOutputChars` |
| P13 | `thinking.shared.ts` | `"light"` level |
| P25 | `tools-invoke-http.ts` | Channel tools import |
| P26 | `server-methods/chat.ts` | `thinkingDefault` early return |
| P29 | `server-methods/chat.ts` | `senderMeta` extraction |
| P30 | `server-methods/chat.ts` | `chatHistory` extraction |
| P31 | `server-broadcast.ts` | `globalThis` singleton |
| P32 | `server-chat.ts` | `RETRYABLE_LIFECYCLE_ERROR_RE` |

### Phase 3: Imports + Hooks (medium risk)

| Patch | File | Hook |
|-------|------|------|
| P2 | `send.ts` | `resolveJidWithBrazil` call |
| P4 | `server-chat.ts` | `onFinalText` callback + `consumeMirror`/`deliverMirror` |
| P5 | `agent-events.ts` | inbound-events import |
| P8 | `status.ts` | `formatStatusCard` import + call |
| P10 | `logs-cli.ts` | `--pretty` flag |
| P11 | `deliver-reply.ts` | Paragraph streaming hook |
| P14 | `send-api.ts` | `processOutboundMentions` |
| P19 | `server-http.ts` | `/media` route |
| P27 | `server-http.ts` | Inbound media path |

### Phase 4: Streaming Pipeline (high risk — test after each)

| Patch | File | Key consideration |
|-------|------|-------------------|
| P15 | `pi-embedded-subscribe.ts` | Check upstream guard structure |
| P16 | `server-chat.ts` + `server.impl.ts` | Verify `SessionMessageSubscriberRegistry` API |
| P17 | `server-chat.ts` | Check upstream throttle value |
| P22 | `server-methods/chat.ts` | Before `stripEnvelope` |
| P23 | `server-methods/chat.ts` + `message-channel.ts` | Check routing compat |

### Phase 5: Verify
```bash
bash patches/verify-patches.sh .
# All 25 must pass
```

---

## Test Chain (mandatory after any rebase)

1. `npm run build`
2. Text streaming in webchat (SSE text-delta)
3. Tool call streaming (live tool cards)
4. Thinking streaming (reasoning-delta)
5. Webchat → WA mirror delivery
6. WA inbound → agent response
7. `/status` card formatting
8. `openclaw doctor --fix`
9. `bash patches/verify-patches.sh .` — 25/25

---

## Merge Protocol

1. **Never build in live gateway repo** — clone to separate dir
2. **Sacred files** (always restore ours): `server-chat.ts`, `server-methods/chat.ts`, `server-broadcast.ts`, `server-sse.ts`
3. Use `--no-verify` (fork has TS errors in untracked upstream files)
4. Sub-agent prompts: "DO NOT remove existing code"
5. **Tagged releases only** — never blind-merge unreleased HEAD
6. P4/P8 are in own files — after merge, just re-import
7. P16: verify `sessionMessageSubscribers` registry API compatibility

---

## Files Created by Fork

| File | Patch |
|------|-------|
| `src/auto-reply/status-card-format.ts` | P8 |
| `src/cli/logs-pretty-formatter.ts` | P10 |
| `src/gateway/chat-mirror.ts` | P4 |
| `src/gateway/server-sse.ts` | P18 |
| `src/infra/inbound-events.ts` | P5 |
| `extensions/whatsapp/src/inbound/brazil-jid-resolver.ts` | P2 |
| `extensions/whatsapp/src/inbound/contact-names.ts` | P14 |

## Files Modified by Fork (18 files)

| File | Patches | Size |
|------|---------|------|
| `src/agents/pi-embedded-subscribe.ts` | P15 | ~10 lines |
| `src/auto-reply/status.ts` | P8 | −78 +1 |
| `src/auto-reply/thinking.shared.ts` | P13 | ~10 lines |
| `src/cli/logs-cli.ts` | P10 | ~5 lines |
| `src/gateway/server-broadcast.ts` | P31 | ~15 lines |
| `src/gateway/server-chat.ts` | P4, P16, P17, P32 | ~40 lines net |
| `src/gateway/server-http.ts` | P19, P27 | ~20 lines |
| `src/gateway/server-methods/chat.ts` | P22, P23, P26, P29, P30 | ~80 lines |
| `src/gateway/server.impl.ts` | P16 | +1 line |
| `src/gateway/tools-invoke-http.ts` | P25 | ~5 lines |
| `src/infra/agent-events.ts` | P5 | ~20 lines |
| `src/memory/backend-config.ts` | P9 | ~5 lines |
| `src/memory/qmd-manager.ts` | P9 | ~10 lines |
| `src/tui/theme/theme.ts` | P7 | 1 line |
| `src/utils/message-channel.ts` | P23 | ~5 lines |
| `extensions/whatsapp/src/auto-reply/deliver-reply.ts` | P11 | ~30 lines |
| `extensions/whatsapp/src/inbound/send-api.ts` | P14 | ~20 lines |
| `extensions/whatsapp/src/send.ts` | P2 | ~15 lines |

---

## Authorship

| Patch | Author | Motivation |
|-------|--------|------------|
| P2 | Bob | Brazilian +55 numbers with/without 9th digit caused silent WA delivery failures |
| P4 | Bob + Guilherme (original), Bob (extraction) | Webchat→WA cross-channel delivery for Butley |
| P5 | Bob | Butley dashboard needs to show inbound messages in real-time |
| P7 | Bob | TUI readability preference |
| P8 | Bob | Luke wanted a prettier /status card |
| P9 | Bob | QMD search results flooding context window |
| P10 | Bob | CLI log readability |
| P11 | Bob | WA sends walls of text — paragraph streaming UX |
| P13 | Bob | Luke: "Gosto q anuncie" — brief tool narration |
| P14 | Bob | WA @mentions weren't formatting as green highlights |
| P15 | Bob | Thinking/reasoning invisible in Butley webchat |
| P16 | Bob | Tool events leaking across sessions (security) |
| P17 | Bob | 150ms upstream throttle felt sluggish in Butley |
| P18 | Bob | SSE endpoint — backbone of Butley frontend streaming |
| P19 | Bob | Media file serving for Butley |
| P21 | Guilherme | Audio attachment handling |
| P22 | Bob | Media URLs lost after message sanitization |
| P23 | Bob | Control UI messages weren't reaching the agent |
| P24 | ademczuk (upstream), Guilherme (removed) | Silent reply filter — no evidence of bug |
| P25 | Bob | Channel tools missing from HTTP invoke endpoint |
| P26 | Bob | Avoid expensive model catalog lookup for thinking default |
| P27 | Bob | Inbound media path handling |
| P29 | Bob | Sender name/id stripped by `stripEnvelope` before agent sees it |
| P30 | Bob | Group chat context (who said what) stripped before agent sees it |
| P31 | Bob | EventBus lost across bundler chunk boundaries |
| P32 | Bob | 429/overload errors were killing SSE streams during retries |

---

## Git Log (feat/rebase-3.22)

```
046b03c80b fix(P16): scope tool broadcast to session
f576eefa8d refactor: harden fragile patches — extract P8/P4, parameterize P17
c53690954c fix(P15): split reasoning stream guards
d74e9b925b feat(fork): wave 6 — P15 webchat thinking stream
2ffd94dc93 feat(fork): wave 5 — P8 status card, P13 verbose light
3c0331edbe feat(fork): wave 4 — P26 thinkingDefault, P23 control-ui, P22 media, P29+P30
8ac85a67e2 feat(fork): wave 3 — WA patches (P2, P11, P14)
334b7ba346 feat(fork): wave 2 — P9, P19+P27, P25, P16, P17, P4
9dfae4505d feat(fork): wave 1 — P5, P7, P10, P18, P31
e7d11f6c33 build: prepare 2026.3.22 (upstream base)
```

## Hardening History (2026-03-24)

| Commit | Fix |
|--------|-----|
| `c53690954c` | P15: split reasoning guards |
| `f576eefa8d` | P4: extract to own file, P8: extract to own file, P17: named constant |
| `046b03c80b` | P16: session-scoped broadcast |

Before: 6 fragile/band-aid. After: 0.
