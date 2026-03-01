# Custom Patches — butley/openclaw

14 custom patches on top of upstream openclaw/openclaw.

## Patch Registry

| # | Name | Dir | Scope | Verify |
|---|------|-----|-------|--------|
| 1 | Opus TTS | `wa-opus/` | WA | `grep -q "opus" src/web/outbound.ts` |
| 2 | Brazil JID Resolution | `brazil-jid-resolution/` | WA | `grep -q "resolveJidWithBrazil" src/web/outbound.ts` |
| 3 | Audio Transcript Hook | `audio-transcript-hook/` | Shared | `grep -q "🎤" src/auto-reply/reply/get-reply.ts` |
| 4 | Chat Mirror | `chat-mirror/` | Gateway | `grep -rq "mirror" src/gateway/server-chat.ts` |
| 5 | WS Inbound Push | `message-inbound-push/` | Infra | `test -f src/infra/inbound-events.ts` |
| 6 | TTS Caption Logging | `tts-caption/` | WA | `grep -q "caption" src/web/outbound.ts` |
| 7 | TUI Dark Theme | `tui-dark-theme/` | TUI | `grep -q "236" src/tui/theme/theme.ts` |
| 8 | Status Card Redesign | `status-card/` | Shared | `grep -q "padLabel" src/auto-reply/status.ts` |
| 9 | QMD Output Limit Fix | `qmd-output-limit/` | Memory | `grep -q "maxOutputChars" src/memory/qmd-manager.ts` |
| 10 | Logs Pretty Formatter | `logs-pretty/` | CLI | `test -f src/cli/logs-pretty-formatter.ts` |
| 11 | WA Paragraph Streaming | `wa-paragraph-streaming/` | WA | `grep -q "streamDelayMs" src/web/auto-reply/deliver-reply.ts` |
| 12 | WA Login Tool Dedup | `wa-login-tool-dedup/` | WA | `grep -q "natively by OpenClaw" extensions/whatsapp/index.ts` |
| 13 | Verbose Light | `verbose-light/` | Shared | `grep -q '"light"' src/auto-reply/thinking.ts` |
| 14 | WA Outbound Mentions | `wa-outbound-mentions/` | WA | `grep -q "processOutboundMentions" src/web/inbound/send-api.ts` |

### Inactive / Historical

| Dir | Status |
|-----|--------|
| `baileys-version-pin/` | Reverted — now uses dynamic `fetchLatestBaileysVersion()` |
| `wa-bold-normalize/` | Superseded by upstream `markdownToWhatsApp()` |

## Scope Legend

- **WA** — WhatsApp only (`src/web/`)
- **Shared** — Cross-channel (`src/auto-reply/`)
- **Gateway** — Gateway server (`src/gateway/`)
- **Infra** — Infrastructure (`src/infra/`)
- **TUI** — Terminal UI (`src/tui/`)
- **CLI** — CLI commands (`src/cli/`)
- **Memory** — Memory/QMD (`src/memory/`)

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
