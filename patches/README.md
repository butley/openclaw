# Custom Patches — butley/openclaw

10 custom patches on top of upstream openclaw/openclaw.

## Patch Registry

| # | Name | Files | Verify |
|---|------|-------|--------|
| 1 | WhatsApp Opus TTS | `src/web/outbound.ts`, `src/tts/tts.ts` | `grep -q "opus" src/web/outbound.ts` |
| 2 | Brazil JID Resolution | `src/web/inbound/brazil-jid-resolver.ts` (NEW), `src/web/outbound.ts` | `grep -q "resolveJidWithBrazil" src/web/outbound.ts` |
| 3 | Audio Transcript Hook | `src/auto-reply/reply/get-reply.ts` | `grep -q "🎤" src/auto-reply/reply/get-reply.ts` |
| 4 | Chat Mirror | `src/gateway/server-chat.ts`, `src/gateway/server-methods/chat.ts` | `grep -rq "mirror" src/gateway/server-chat.ts` |
| 5 | WS Inbound Push | `src/infra/inbound-events.ts` (NEW) | `test -f src/infra/inbound-events.ts` |
| 6 | TTS Caption Logging | `src/web/active-listener.ts` | `grep -q "caption" src/web/outbound.ts` |
| 7 | TUI Dark Theme | `src/tui/theme/theme.ts` | `grep -q "236" src/tui/theme/theme.ts` |
| 8 | Status Card Redesign | `src/auto-reply/status.ts` | `grep -q "padLabel" src/auto-reply/status.ts` |
| 9 | QMD Output Limit Fix | `src/memory/qmd-manager.ts`, `src/config/zod-schema.ts` | `grep -q "maxOutputChars" src/memory/qmd-manager.ts` |
| 10 | Logs Pretty Formatter | `src/cli/logs-cli.ts`, `src/cli/logs-pretty-formatter.ts` (NEW) | `test -f src/cli/logs-pretty-formatter.ts` |

## Verification

```bash
bash patches/verify-patches.sh .
```

## Adding a New Patch

1. Implement in fork source, build, test
2. Create `patches/<name>/README.md` (what, why, verify command)
3. Add entry to this table
4. Add check to `verify-patches.sh`
5. Commit everything together
