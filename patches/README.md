# Custom Patches — butley/openclaw

22 active patches on `feat/rebase-3.22` (base: upstream v2026.3.22).

Last updated: 2026-03-24 (post-hardening audit).

---

## Absorbed by Upstream (no longer maintained)

| # | Name | Absorbed in | Notes |
|---|------|-------------|-------|
| P1 | WA Opus TTS | v2026.3.1 | Upstream added `VOICE_BUBBLE_CHANNELS` |
| P3 | Audio Transcript Hook | v2026.3.22 | Upstream `message:transcribed` hooks |
| P6 | TTS Caption Logging | v2026.2.26 | Upstream included equivalent logging |
| P12 | WA Login Tool Dedup | v2026.3.22 | Upstream dedup logic |
| P20 | Image Generate Tool | v2026.3.22 | Upstream `image-generate-tool.ts` |

## Dropped

| # | Name | Reason |
|---|------|--------|
| P28 | SSE Cron Filter | Replaced by P16 session-scoped broadcast — cron events no longer leak across sessions |

---

## Patch Registry

### Legend

- **Own file** = patch lives in its own `.ts` file, zero merge conflict risk
- **Additive** = adds code without modifying upstream lines
- **Extracted** = was inline, now in own file (hardened post-audit)
- **Scoped** = was global broadcast, now session-scoped (hardened post-audit)

### Core Patches

| # | Name | Type | Files | Verify |
|---|------|------|-------|--------|
| P2 | Brazil JID Resolution | Own file + send hook | `brazil-jid-resolver.ts`, `send.ts` | `grep -q 'resolveJidWithBrazil' extensions/whatsapp/src/send.ts` |
| P4 | Chat Mirror | **Extracted** → own file | `chat-mirror.ts`, `server-chat.ts` | `test -f src/gateway/chat-mirror.ts` |
| P5 | WS Inbound Push | Own file + additive | `inbound-events.ts`, `agent-events.ts` | `test -f src/infra/inbound-events.ts` |
| P7 | TUI Dark Theme | 1-line change | `theme.ts` | `grep -q '236' src/tui/theme/theme.ts` |
| P8 | Status Card | **Extracted** → own file | `status-card-format.ts`, `status.ts` | `test -f src/auto-reply/status-card-format.ts` |
| P9 | QMD Output Limit | Additive config | `qmd-manager.ts`, `backend-config.ts` | `grep -q 'maxOutputChars' src/memory/qmd-manager.ts` |
| P10 | Logs Pretty Formatter | Own file + flag | `logs-pretty-formatter.ts`, `logs-cli.ts` | `test -f src/cli/logs-pretty-formatter.ts` |
| P13 | Verbose Light | Additive level | `thinking.shared.ts` | `grep -q '"light"' src/auto-reply/thinking.shared.ts` |

### WhatsApp Patches

| # | Name | Type | Files | Verify |
|---|------|------|-------|--------|
| P11 | WA Paragraph Streaming | Own helpers + hook | `deliver-reply.ts`, `wa-streaming-utils.ts` | `grep -q 'streamDelayMs' extensions/whatsapp/src/auto-reply/deliver-reply.ts` |
| P14 | WA Outbound Mentions | Isolated transform | `send-api.ts`, `contact-names.ts` | `grep -q 'processOutboundMentions' extensions/whatsapp/src/inbound/send-api.ts` |

### Streaming Pipeline

| # | Name | Type | Files | Verify |
|---|------|------|-------|--------|
| P15 | Webchat Thinking Stream | Guard split (surgical) | `pi-embedded-subscribe.ts` | `grep -q 'streamReasoning: true' src/agents/pi-embedded-subscribe.ts` |
| P16 | Tool Events Broadcast | **Scoped** → session-only | `server-chat.ts`, `server.impl.ts` | `grep -q 'sessionMessageSubscribers' src/gateway/server-chat.ts` |
| P17 | Streaming Throttle | Named constant | `server-chat.ts` | `grep -q 'STREAM_DELTA_THROTTLE_MS' src/gateway/server-chat.ts` |
| P18 | SSE Streaming Endpoint | Own file (~460 lines) | `server-sse.ts` | `test -f src/gateway/server-sse.ts` |
| P31 | SSE EventBus Singleton | `globalThis` pattern | `server-broadcast.ts` | `grep -q '__openclaw_gatewayEventBus__' src/gateway/server-broadcast.ts` |
| P32 | SSE Retryable Error | Additive guard | `server-chat.ts` | `grep -q 'RETRYABLE_LIFECYCLE_ERROR' src/gateway/server-chat.ts` |

### Gateway Core

| # | Name | Type | Files | Verify |
|---|------|------|-------|--------|
| P19 | Gateway Media Endpoint | Additive route | `server-http.ts` | `grep -q 'media' src/gateway/server-http.ts` |
| P22 | Chat Media Pipeline | Pre-sanitization extract | `server-methods/chat.ts` | `grep -q 'audioUrlByIndex' src/gateway/server-methods/chat.ts` |
| P23 | Chat.send Internal Routing | Routing override | `server-methods/chat.ts`, `message-channel.ts` | `grep -q 'INTERNAL_MESSAGE_CHANNEL' src/gateway/server-methods/chat.ts` |
| P25 | HTTP Tools Channel Reg | Additive import | `tools-invoke-http.ts` | `grep -q 'listChannelAgentTools' src/gateway/tools-invoke-http.ts` |
| P26 | ThinkingDefault Shortcut | Additive early return | `server-methods/chat.ts` | `grep -q 'thinkingDefault' src/gateway/server-methods/chat.ts` |
| P27 | Media Inbound Path | Additive route | `server-http.ts` | `grep -q 'inbound' src/gateway/server-http.ts` |
| P29 | Chat Sender Meta | Pre-sanitization extract | `server-methods/chat.ts` | `grep -q 'senderMeta' src/gateway/server-methods/chat.ts` |
| P30 | Chat Group Context | Pre-sanitization extract | `server-methods/chat.ts` | `grep -q 'chatHistory' src/gateway/server-methods/chat.ts` |

### Optional / Pending

| # | Name | Status | Files |
|---|------|--------|-------|
| P21 | Chat Audio Inbound | Pending — upstream removed `ChatAudioAttachment` type | `chat-attachments.ts` |
| P24 | Silent Reply Filter | Skipped — no evidence of bug | — |

---

## Merge Resilience by Category

**Zero conflict (own files):** P2, P4, P5, P8, P10, P11, P18 — survive any upstream merge.

**Minimal conflict (additive):** P7, P9, P13, P25, P26, P29, P30, P31, P32 — only break if upstream renames the exact function/field they touch.

**Watch closely (inline modifications):** P15, P16, P17, P22, P23 — touch upstream code directly. Review on every merge.

---

## Verification

```bash
bash patches/verify-patches.sh .
# Expected: 25/25 pass
```

---

## Hardening History (2026-03-24)

Post-rebase audit identified 5 fragile/band-aid patches and fixed all of them:

| Commit | What |
|--------|------|
| `c53690954c` | P15: split reasoning guards — emitAgentEvent independent of channel callback |
| `f576eefa8d` | P4: extract to `chat-mirror.ts`, P8: extract to `status-card-format.ts`, P17: named constant |
| `046b03c80b` | P16: session-scoped broadcast via `sessionMessageSubscribers` |

Before hardening: 6 patches rated fragile/band-aid. After: 0.

---

## Full Documentation

See `docs/FORK.md` for the complete picture: streaming pipeline integration map,
diagnostic traces, implementation order for future rebases, authorship, and merge protocol.

---

## Historical — Absorbed Patches

### P3 — Audio Transcript Hook (absorbed in v2026.3.22)
Emitted a second `message_received` hook AFTER transcription completes, with
transcript in content and `isTranscript: true` in metadata. Upstream added native
`message:transcribed` hooks in v3.22, making this unnecessary.

### P12 — WA Login Tool Dedup (absorbed in v2026.3.22)
Removed duplicate `api.registerTool()` for `whatsapp_login` from WA extension.
Upstream v2026.2.26+ registers it natively. Original add: Guilherme (`55399b9`),
removal: `aab4460`. Author: Guilherme Ramos.

### P20 — Image Generate Tool (absorbed in v2026.3.22)
Gemini image generation tool (`image_generate`) calling `v1beta/models/{model}:generateContent`.
Upstream added `image-generate-tool.ts` natively in v3.22.

### P24 — Silent Reply Filter Removal (skipped)
Would remove `extractAssistantTextForSilentCheck` and silent-token filtering from
chat history. Skipped during v3.22 rebase — no evidence of the bug it was meant to fix.
Function still exists in upstream v3.22.

### P28 — SSE Cron Filter (dropped)
Filtered `:cron:` events from SSE stream. Replaced by P16's session-scoped broadcast
which inherently prevents cross-session event leaks.
