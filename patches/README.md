# Custom Patches — butley/openclaw

16 active custom patches on top of upstream openclaw/openclaw.

## Absorbed by Upstream (no longer maintained)

| # | Name | Absorbed in | Notes |
|---|------|-------------|-------|
| 1 | WhatsApp Opus TTS | v2026.3.1 | Upstream added `VOICE_BUBBLE_CHANNELS` Set including `"whatsapp"` in `src/tts/tts.ts` |
| 6 | TTS Caption Logging | v2026.2.26 | Upstream included equivalent logging |

## Patch Registry

> **Branch key:** `alpha` = merged into stable base | `feat/sse-endpoint` = pending merge into alpha

| # | Name | Dir | Scope | Branch | Verify |
|---|------|-----|-------|--------|--------|
| 2 | Brazil JID Resolution | `brazil-jid-resolution/` | WA | `alpha` | `grep -q "resolveJidWithBrazil" src/web/outbound.ts` |
| 3 | Audio Transcript Hook | `audio-transcript-hook/` | Shared | `alpha` | `grep -q "🎤" src/auto-reply/reply/get-reply.ts` |
| 4 | Chat Mirror | `chat-mirror/` | Gateway | `alpha` | `grep -rq "mirror" src/gateway/server-chat.ts` |
| 5 | WS Inbound Push | `message-inbound-push/` | Infra | `alpha` | `test -f src/infra/inbound-events.ts` |
| 7 | TUI Dark Theme | `tui-dark-theme/` | TUI | `alpha` | `grep -q "236" src/tui/theme/theme.ts` |
| 8 | Status Card Redesign | `status-card/` | Shared | `alpha` | `grep -q "padLabel" src/auto-reply/status.ts` |
| 9 | QMD Output Limit Fix | `qmd-output-limit/` | Memory | `alpha` | `grep -q "maxOutputChars" src/memory/qmd-manager.ts` |
| 10 | Logs Pretty Formatter | `logs-pretty/` | CLI | `alpha` | `test -f src/cli/logs-pretty-formatter.ts` |
| 11 | WA Paragraph Streaming | `wa-paragraph-streaming/` | WA | `alpha` | `grep -q "streamDelayMs" src/web/auto-reply/deliver-reply.ts` |
| 12 | WA Login Tool Dedup | `wa-login-tool-dedup/` | WA | `alpha` | `grep -q "natively by OpenClaw" extensions/whatsapp/index.ts` |
| 13 | Verbose Light | `verbose-light/` | Shared | `alpha` | `grep -q '"light"' src/auto-reply/thinking.ts` |
| 14 | WA Outbound Mentions | `wa-outbound-mentions/` | WA | `alpha` | `grep -q "processOutboundMentions" src/web/inbound/send-api.ts` |
| 15 | Webchat Thinking Stream | `webchat-thinking-stream/` | Agents | `alpha` | `grep -q 'streamReasoning: true' src/agents/pi-embedded-subscribe.ts` |
| 16 | Tool Events Broadcast | `tool-events-broadcast/` | Gateway | `alpha` | `grep -q "_broadcastToConnIds" src/gateway/server-chat.ts` |
| 17 | Streaming Throttle | — | Gateway | `alpha` | `grep -q "50ms throttle" src/gateway/server-chat.ts` |
| 18 | SSE Streaming Endpoint | `sse-streaming/` | Gateway/Agents | `feat/sse-endpoint` | `test -f src/gateway/server-sse.ts` |



## Scope Legend

- **WA** — WhatsApp only (`src/web/`)
- **Shared** — Cross-channel (`src/auto-reply/`)
- **Gateway** — Gateway server (`src/gateway/`)
- **Infra** — Infrastructure (`src/infra/`)
- **TUI** — Terminal UI (`src/tui/`)
- **CLI** — CLI commands (`src/cli/`)
- **Memory** — Memory/QMD (`src/memory/`)
- **Agents** — Agent runtime (`src/agents/`)

## Verification

```bash
bash patches/verify-patches.sh .
```

## Adding a New Patch

1. Implement in fork source, build, test
2. Create `patches/<name>/README.md` following existing format
3. Add entry to this table with scope and verify command
4. Add check to `verify-patches.sh`
5. Prefix WA-only patches with `wa-`
6. Commit everything together
