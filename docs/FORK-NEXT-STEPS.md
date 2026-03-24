# Fork Next Steps — Post v3.22 Rebase

**Branch:** `feat/rebase-3.22`
**Base:** upstream `v2026.3.22` (commit `e7d11f6c33`)
**Last commit:** `046b03c80b` (P16 session-scoped broadcast)
**Status:** Waves 1-6 complete + all hardening fixes. Wave 7 (build+test) awaiting Luke's approval.

---

## Wave 7 — Build & Test (BLOCKED: needs Luke's approval)

1. Build `feat/rebase-3.22` in **separate directory** (clone, NOT live gateway repo)
2. Run test suite
3. Manual smoke test chain:
   - Webchat → text streaming
   - Webchat → WA mirror delivery
   - Tool call streaming (live tool cards)
   - Thinking/reasoning stream (WS/SSE)
   - WA inbound → agent response
   - `/status` card formatting
4. `openclaw doctor --fix`
5. Swap live gateway from `alpha` to `feat/rebase-3.22`
6. Verify tailscale funnel intact

---

## Patch Health Summary

### ✅ Solid (16 patches) — No action needed

| # | Name | Files | Why it's solid |
|---|------|-------|---------------|
| P2 | Brazil JID Resolution | `brazil-jid-resolver.ts` (own file) | Isolated, zero upstream deps |
| P5 | WS Inbound Push | `inbound-events.ts` + `agent-events.ts` | Own file + additive field |
| P7 | TUI Dark Theme | `theme.ts` | 1-line color change |
| P9 | QMD Output Limit | `qmd-manager.ts` | Additive config |
| P10 | Logs Pretty Formatter | `logs-pretty-formatter.ts` + `logs-cli.ts` | Own file + 1 import |
| P11 | WA Paragraph Streaming | `deliver-reply.ts` + `wa-streaming-utils.ts` | Own helpers file |
| P13 | Verbose Light | `thinking.shared.ts` | Additive level |
| P14 | WA Outbound Mentions | `send-api.ts` | Isolated transform |
| P18 | SSE Streaming Endpoint | `server-sse.ts` (own file, ~460 lines) | Complete own file |
| P19 | Gateway Media Endpoint | `server-http.ts` | Additive route |
| P25 | HTTP Tools Channel Reg | `tools-invoke-http.ts` | 1 additive import |
| P26 | ThinkingDefault Shortcut | `server-methods/chat.ts` | Additive early return, wraps upstream |
| P29 | Chat Sender Meta | `server-methods/chat.ts` | Additive extraction |
| P30 | Chat Group Context | `server-methods/chat.ts` | Additive extraction |
| P31 | SSE EventBus Singleton | `server-broadcast.ts` | `globalThis` pattern |
| P32 | SSE Retryable Error Suppression | `server-chat.ts` | Additive guard |

### ✅ Hardened (5 patches) — Were fragile, now fixed

| # | Name | Was | Now | Commit |
|---|------|-----|-----|--------|
| P4 | Chat Mirror | 40 lines copy-pasted 2x in `server-chat.ts` | Extracted to `chat-mirror.ts` (own file) | `f576eefa8d` |
| P8 | Status Card | 78 lines inline in `status.ts` | Extracted to `status-card-format.ts` (own file) | `f576eefa8d` |
| P15 | Webchat Thinking Stream | Dead code (upstream merged guards) | Guards split correctly; broadcast independent of channel callback | `c53690954c` |
| P16 | Tool Events Broadcast | `broadcast()` to ALL clients (cross-session leak) | Session-scoped via `sessionMessageSubscribers` | `046b03c80b` |
| P17 | Streaming Throttle | Magic number `50` inline | Named constant `STREAM_DELTA_THROTTLE_MS` | `f576eefa8d` |

### ✅ Absorbed by upstream (5 patches) — Dropped

| # | Name | Absorbed in |
|---|------|-------------|
| P1 | WA Opus TTS | v2026.3.1 |
| P3 | Audio Transcript Hook | v3.22 (upstream `message:transcribed` hooks) |
| P6 | TTS Caption Logging | v2026.2.26 |
| P12 | WA Login Tool Dedup | v3.22 (upstream dedup) |
| P20 | Image Generate Tool | v3.22 (upstream `image-generate-tool.ts`) |

### ❌ Dropped (1 patch)

| # | Name | Reason |
|---|------|--------|
| P28 | SSE Cron Filter | Was `":cron:"` filter in SSE. Not reimplemented — cron events should be handled by proper session scoping (which P16 fix now provides) |

### ⏳ Pending Decision (2 patches)

| # | Name | Status |
|---|------|--------|
| P21 | Chat Audio Inbound | Upstream removed `ChatAudioAttachment` type. Needs reimplementation or drop. Awaiting Guilherme. |
| P24 | Silent Reply Filter Removal | `extractAssistantTextForSilentCheck` still exists in v3.22. No evidence of bug. Skipped. Revisit if silent reply issues appear. |

---

## Architecture Improvements in v3.22 Rebase

### P15: Reasoning Stream Guard Split

**Problem:** Upstream v3.22 merged two independent guards into one AND condition:
```ts
if (!state.streamReasoning || !params.onReasoningStream) return;
```
This killed `emitAgentEvent` (WS/SSE broadcast) when no channel callback is passed.
Webchat always hits this because `typingPolicy='internal_webchat'` → `onReasoningStream=undefined`.

**Fix:** Split guards back. `emitAgentEvent` depends only on `state.streamReasoning` (config).
`onReasoningStream` callback is optional, called separately with `if` check. Broadcast and
channel delivery are independent concerns.

**File:** `src/agents/pi-embedded-subscribe.ts`

### P16: Session-Scoped Tool Broadcast

**Problem:** Original P16 used `broadcast("agent", toolPayload)` — sent tool events to ALL
connected WS/SSE clients regardless of session. Cross-session information leak.

**Fix:** Uses `sessionMessageSubscribers.get(sessionKey)` to send only to clients that
subscribed to that specific session via `sessions.messages.subscribe`. Same UX, zero leak.

**Files:** `src/gateway/server-chat.ts` (+`sessionMessageSubscribers` param),
`src/gateway/server.impl.ts` (passes registry to handler)

### P4: Chat Mirror Extraction

**Problem:** 20-line mirror block copy-pasted identically in success and error paths of
`server-chat.ts` event handler. Any upstream change = double merge conflict.

**Fix:** Extracted to `src/gateway/chat-mirror.ts` — `maybeMirrorToChannel()` called from
both paths. Parses sessionKey, validates WA channel, sends via `sendMessageWhatsApp`.

### P8: Status Card Extraction

**Problem:** 78 lines of formatting (padLabel, Unicode symbols, code block wrapping) inline
in `src/auto-reply/status.ts`. Upstream changes data-gathering constantly.

**Fix:** Extracted to `src/auto-reply/status-card-format.ts`. `formatStatusCard()` receives
typed data, returns formatted string. Upstream can change status.ts freely — our formatting
is in its own file.

---

## File Inventory — v3.22 Rebase Branch

### Files CREATED by fork

| File | Patch | Purpose |
|------|-------|---------|
| `src/auto-reply/status-card-format.ts` | P8 | Status card formatting (extracted) |
| `src/cli/logs-pretty-formatter.ts` | P10 | Pretty log formatting |
| `src/gateway/chat-mirror.ts` | P4 | Chat mirror function (extracted) |
| `src/gateway/server-sse.ts` | P18 | SSE streaming endpoint for Butley frontend |
| `src/infra/inbound-events.ts` | P5 | WS inbound push events |
| `extensions/whatsapp/src/inbound/brazil-jid-resolver.ts` | P2 | Brazil +55 JID resolution |
| `extensions/whatsapp/src/inbound/contact-names.ts` | P11/P14 | Contact name extraction |
| `docs/FORK-NEXT-STEPS.md` | — | This file |

### Files MODIFIED by fork (18 files)

| File | Patches | Change Size |
|------|---------|-------------|
| `src/agents/pi-embedded-subscribe.ts` | P15 | ~10 lines (guard split) |
| `src/auto-reply/status.ts` | P8 | −78 lines (extracted to own file) |
| `src/auto-reply/thinking.shared.ts` | P13 | ~10 lines (additive "light" level) |
| `src/cli/logs-cli.ts` | P10 | ~5 lines (import + flag) |
| `src/gateway/server-broadcast.ts` | P31 | ~15 lines (globalThis singleton) |
| `src/gateway/server-chat.ts` | P4, P16, P17, P32 | ~40 lines net (extracted + scoped) |
| `src/gateway/server-http.ts` | P19, P27 | ~20 lines (routes) |
| `src/gateway/server-methods/chat.ts` | P22, P23, P26, P29, P30 | ~80 lines |
| `src/gateway/server.impl.ts` | P16 | +1 line (pass sessionMessageSubscribers) |
| `src/gateway/tools-invoke-http.ts` | P25 | ~5 lines |
| `src/infra/agent-events.ts` | P5 | ~20 lines (mirror field + inbound) |
| `src/memory/backend-config.ts` | P9 | ~5 lines |
| `src/memory/qmd-manager.ts` | P9 | ~10 lines |
| `src/tui/theme/theme.ts` | P7 | 1 line |
| `src/utils/message-channel.ts` | P23 | ~5 lines (isWebchatClient extension) |
| `extensions/whatsapp/src/auto-reply/deliver-reply.ts` | P11 | ~30 lines |
| `extensions/whatsapp/src/inbound/send-api.ts` | P14 | ~20 lines |
| `extensions/whatsapp/src/send.ts` | P2 | ~15 lines |

---

## Rules for Future Merges

1. **Never build in live gateway repo** — clone to separate dir
2. **Sacred files** (always restore ours, never blindly merge): `server-chat.ts`, `server-methods/chat.ts`, `server-broadcast.ts`, `server-sse.ts`
3. Use `--no-verify` for commits (fork has TS errors in untracked upstream files)
4. Sub-agent prompts must be ultra-surgical: "DO NOT remove existing code"
5. Tagged releases only — never blind-merge unreleased HEAD
6. After merge: run `patches/verify-patches.sh` — all checks must pass
7. P8 and P4 are now in **own files** — after upstream merge, just re-import them (no inline conflict resolution needed)
8. P16 uses `sessionMessageSubscribers` — if upstream changes the subscriber registry API, update the field name in `AgentEventHandlerOptions`

---

## Git Log

```
046b03c80b fix(P16): scope tool broadcast to session
2e22ab8e1a docs: update FORK-NEXT-STEPS — all fragile patches hardened
f576eefa8d refactor: harden fragile patches — extract P8/P4, parameterize P17
d9907a53bb docs: fork next steps — patch health audit and fix roadmap
c53690954c fix(P15): split reasoning stream guards
d74e9b925b feat(fork): wave 6 — P15 webchat thinking stream
2ffd94dc93 feat(fork): wave 5 — P8 status card, P13 verbose light
3c0331edbe feat(fork): wave 4 — P26 thinkingDefault, P23 control-ui, P22 media, P29+P30
8ac85a67e2 feat(fork): wave 3 — WA patches (P2, P11, P14)
334b7ba346 feat(fork): wave 2 — P9, P19+P27, P25, P16, P17, P4
9dfae4505d feat(fork): wave 1 — P5, P7, P10, P18, P31
e7d11f6c33 build: prepare 2026.3.22 (upstream base)
```
