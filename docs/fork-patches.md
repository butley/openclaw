# Butley Fork — Patch Map

This document describes every custom change in `butley/openclaw` relative to upstream `openclaw/openclaw`.

Last updated: 2026-03-24 (post v3.22 rebase + hardening audit).

---

## Branch Structure

| Branch | Base | Purpose | Status |
|--------|------|---------|--------|
| `feat/rebase-3.22` | v2026.3.22 | All 22 active patches, hardened | ✅ Ready for Wave 7 (build+test) |
| `alpha` | ~v2026.3.13-1 | Previous production | ⚠️ Will be superseded |
| `streaming` | alpha | WA paragraph delay experiments | 🧪 Experimental (stale) |
| `tool-narration` | alpha | WA tool narration | 🧪 Experimental (stale) |

---

## Active Patches (22 total on `feat/rebase-3.22`)

### Architecture Improvements (hardened 2026-03-24)

These patches were refactored during the v3.22 rebase audit to improve merge resilience and correctness.

#### P4 — Chat Mirror (Extracted)
**What:** When a message is sent via webchat to a WA session, the reply is mirrored back to WA.
**Implementation:** Extracted to `src/gateway/chat-mirror.ts` — `maybeMirrorToChannel()` parses sessionKey, validates WA channel, calls `sendMessageWhatsApp`. Called from `server-chat.ts` event handler (1 line per call site, was 20 lines copy-pasted 2x).
**Files:** `src/gateway/chat-mirror.ts` (new), `src/gateway/server-chat.ts` (import + 2 calls)

#### P8 — Status Card (Extracted)
**What:** Custom `/status` card with monospace alignment, Unicode symbols, and code block wrapping.
**Implementation:** Extracted to `src/auto-reply/status-card-format.ts` — `formatStatusCard()` receives typed data, returns formatted string. `status.ts` calls the function instead of 78 lines of inline formatting.
**Files:** `src/auto-reply/status-card-format.ts` (new, 93 lines), `src/auto-reply/status.ts` (−78 lines, +1 import + call)

#### P15 — Webchat Thinking Stream (Guard Split)
**What:** Ensures thinking/reasoning events reach WS/SSE clients regardless of channel callback.
**Problem solved:** Upstream v3.22 merged two independent guards (`streamReasoning` and `onReasoningStream`) into one AND condition. Webchat never passes `onReasoningStream` (because `typingPolicy='internal_webchat'` → callback undefined), killing the broadcast.
**Implementation:** Split guards: `emitAgentEvent` depends only on `state.streamReasoning` (config-driven). `onReasoningStream` callback is optional, called separately. Broadcast (WS/SSE) and channel callback (WA typing) are independent concerns.
**File:** `src/agents/pi-embedded-subscribe.ts` (~10 lines changed)

#### P16 — Tool Events Broadcast (Session-Scoped)
**What:** Broadcasts tool lifecycle events to webchat clients watching a session.
**Problem solved:** Original P16 used `broadcast()` → sent to ALL connected clients (cross-session leak). Bad for multi-tenant.
**Implementation:** Uses `sessionMessageSubscribers.get(sessionKey)` — same registry webchat uses for `sessions.messages.subscribe`. Only clients subscribed to that specific session receive tool events. Added `sessionMessageSubscribers: SessionMessageSubscriberRegistry` to `AgentEventHandlerOptions`.
**Files:** `src/gateway/server-chat.ts` (~15 lines), `src/gateway/server.impl.ts` (+1 line)

#### P17 — Streaming Throttle (Named Constant)
**What:** 50ms debounce on chat deltas to prevent WS flood during fast generation. Upstream default is 150ms.
**Implementation:** Named constant `STREAM_DELTA_THROTTLE_MS = 50` at top of `server-chat.ts`. Easy to find, easy to tune, obvious in merge conflicts.
**File:** `src/gateway/server-chat.ts` (2 lines: declaration + reference)

---

### Standalone New Files (zero conflict risk)

#### P2 — Brazil JID Resolution
**What:** Resolves Brazilian +55 numbers with/without 9th digit for WA delivery.
**Files:** `extensions/whatsapp/src/inbound/brazil-jid-resolver.ts` (new), `extensions/whatsapp/src/send.ts` (import + call)

#### P5 — WS Inbound Push
**What:** Pushes inbound message events to WS/SSE clients.
**Files:** `src/infra/inbound-events.ts` (new), `src/infra/agent-events.ts` (mirror field)

#### P10 — Logs Pretty Formatter
**What:** `--pretty` flag for `openclaw logs` — collapses heredocs, formats session-memory lines, tool emoji.
**Files:** `src/cli/logs-pretty-formatter.ts` (new), `src/cli/logs-cli.ts` (import + flag)

#### P11 — WA Paragraph Streaming
**What:** Streams long WA replies paragraph by paragraph with configurable delay.
**Files:** `extensions/whatsapp/src/auto-reply/deliver-reply.ts` (hook), helper utils

#### P14 — WA Outbound Mentions
**What:** Processes @mentions in outbound WA messages, converting phone numbers to JIDs.
**Files:** `extensions/whatsapp/src/inbound/send-api.ts`, `extensions/whatsapp/src/inbound/contact-names.ts` (new)

#### P18 — SSE Streaming Endpoint
**What:** HTTP SSE endpoint at `/api/sse/stream?sessionKey=...` streaming events in AI SDK Data Stream Protocol format for the Butley frontend.
**Events:** text-start/delta/end, reasoning-start/delta/end, tool-input-start/available, tool-output-available, finish-step/finish, user-message, connected, error, abort.
**File:** `src/gateway/server-sse.ts` (new, ~460 lines)

#### P31 — SSE EventBus Singleton
**What:** `gatewayEventBus` uses `globalThis.__openclaw_gatewayEventBus__` to survive bundler chunk duplication.
**File:** `src/gateway/server-broadcast.ts`

---

### Additive Changes (minimal conflict risk)

#### P7 — TUI Dark Theme
Color 236 for dark theme background. `src/tui/theme/theme.ts` (1 line).

#### P9 — QMD Output Limit
`maxOutputChars` limit on QMD search results. `src/memory/qmd-manager.ts` + `backend-config.ts`.

#### P13 — Verbose Light
Adds `"light"` verbose level — brief tool narration one-liners. `src/auto-reply/thinking.shared.ts`.

#### P19 — Gateway Media Endpoint
`/media` route for serving media files. `src/gateway/server-http.ts`.

#### P22 — Chat Media Pipeline
Extracts `audioUrl`/`imageUrl` from inbound chat messages before sanitization. `src/gateway/server-methods/chat.ts`.

#### P23 — Chat.send Internal Routing
Control UI messages go through full agent pipeline (not just WS echo). Uses `INTERNAL_MESSAGE_CHANNEL`. `src/gateway/server-methods/chat.ts` + `src/utils/message-channel.ts`.

#### P25 — HTTP Tools Channel Registration
Includes channel plugin tools in HTTP tool invoke endpoint. `src/gateway/tools-invoke-http.ts`.

#### P26 — ThinkingDefault Shortcut
Falls back to `agents.defaults.thinkingDefault` config, skipping expensive model catalog lookup. Additive early return wrapping upstream code. `src/gateway/server-methods/chat.ts`.

#### P27 — Media Inbound Path
Inbound media path handling. `src/gateway/server-http.ts`.

#### P29 — Chat Sender Meta
Extracts sender name/id from inbound metadata before `stripEnvelope` removes it. `src/gateway/server-methods/chat.ts`.

#### P30 — Chat Group Context
Extracts group chat history (who said what) before `stripEnvelope`. `src/gateway/server-methods/chat.ts`.

#### P32 — SSE Retryable Error Suppression
Retryable provider errors (429, overload) don't finalize chat runs. Keeps SSE stream open during gateway retries. `src/gateway/server-chat.ts`.

---

## Absorbed by Upstream (removed from fork)

| # | Name | Absorbed in |
|---|------|-------------|
| P1 | WA Opus TTS | v2026.3.1 |
| P3 | Audio Transcript Hook | v2026.3.22 |
| P6 | TTS Caption Logging | v2026.2.26 |
| P12 | WA Login Tool Dedup | v2026.3.22 |
| P20 | Image Generate Tool | v2026.3.22 |

## Dropped

| # | Name | Reason |
|---|------|--------|
| P28 | SSE Cron Filter | Replaced by P16 session-scoped broadcast |

## Pending Decision

| # | Name | Status |
|---|------|--------|
| P21 | Chat Audio Inbound | Upstream removed `ChatAudioAttachment` type. File exists but may need reimplementation. |
| P24 | Silent Reply Filter Removal | Skipped — no evidence of original bug. |

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
    └── pi-embedded-subscribe.ts [P15: streamReasoning:true]
         ├── emitAgentEvent({stream:"tool"})
         ├── emitAgentEvent({stream:"thinking"})   ← P15 ensures this fires
         └── emitAgentEvent({stream:"assistant"})
              │
              └── agent-events.ts [P5: mirror field]
                   │
                   └── createAgentEventHandler (server-chat.ts)
                        ├── Tool events: flush + session-scoped broadcast [P16]
                        ├── Delta throttle: STREAM_DELTA_THROTTLE_MS [P17]
                        ├── Retryable errors: don't finalize [P32]
                        ├── Chat mirror: maybeMirrorToChannel() [P4]
                        └── broadcast() → gatewayEventBus [P31] → SSE [P18]
```

---

## Verification

```bash
bash patches/verify-patches.sh .
# Expected: 25/25 pass
```

---

## Merge Protocol

1. **Never build in live gateway repo** — clone to separate dir
2. **Sacred files** (always restore ours): `server-chat.ts`, `server-methods/chat.ts`, `server-broadcast.ts`, `server-sse.ts`
3. Use `--no-verify` for commits (fork has TS errors in untracked upstream files)
4. Sub-agent prompts: "DO NOT remove existing code"
5. **Tagged releases only** — never blind-merge unreleased HEAD
6. After merge: `bash patches/verify-patches.sh .` — all 25 must pass
7. P4 and P8 are in **own files** — after merge, just re-import (no inline conflict)
8. P16 uses `sessionMessageSubscribers` — verify registry API compatibility after merge
