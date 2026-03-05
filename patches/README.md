# Custom Patches — butley/openclaw

19 active custom patches on top of upstream openclaw/openclaw.

## Absorbed by Upstream (no longer maintained)

| # | Name | Absorbed in | Notes |
|---|------|-------------|-------|
| 1 | WhatsApp Opus TTS | v2026.3.1 | Upstream added `VOICE_BUBBLE_CHANNELS` Set including `"whatsapp"` in `src/tts/tts.ts` |
| 6 | TTS Caption Logging | v2026.2.26 | Upstream included equivalent logging |

## Patch Registry

| # | Name | Dir | Scope | Verify |
| 2 | Brazil JID Resolution | `brazil-jid-resolution/` | WA | `grep -q "resolveJidWithBrazil" src/web/outbound.ts` |
| 3 | Audio Transcript Hook | `audio-transcript-hook/` | Shared | `grep -q "🎤" src/auto-reply/reply/get-reply.ts` |
| 4 | Chat Mirror | `chat-mirror/` | Gateway | `grep -rq "mirror" src/gateway/server-chat.ts` |
| 5 | WS Inbound Push | `message-inbound-push/` | Infra | `test -f src/infra/inbound-events.ts` |
| 7 | TUI Dark Theme | `tui-dark-theme/` | TUI | `grep -q "236" src/tui/theme/theme.ts` |
| 8 | Status Card Redesign | `status-card/` | Shared | `grep -q "padLabel" src/auto-reply/status.ts` |
| 9 | QMD Output Limit Fix | `qmd-output-limit/` | Memory | `grep -q "maxOutputChars" src/memory/qmd-manager.ts` |
| 10 | Logs Pretty Formatter | `logs-pretty/` | CLI | `test -f src/cli/logs-pretty-formatter.ts` |
| 11 | WA Paragraph Streaming | `wa-paragraph-streaming/` | WA | `grep -q "streamDelayMs" src/web/auto-reply/deliver-reply.ts` |
| 12 | WA Login Tool Dedup | `wa-login-tool-dedup/` | WA | `grep -q "provided by core" extensions/whatsapp/index.ts` |
| 13 | Verbose Light | `verbose-light/` | Shared | `grep -q '"light"' src/auto-reply/thinking.ts` |
| 14 | WA Outbound Mentions | `wa-outbound-mentions/` | WA | `grep -q "processOutboundMentions" src/web/inbound/send-api.ts` |
| 15 | Gateway Media Endpoint | `gateway-media-endpoint/` | Gateway | `grep -q '"media"' src/gateway/server-http.ts` |
| 16 | Image Generate Tool | `image-generate-tool/` | Tools | `test -f src/agents/tools/image-generate-tool.ts` |
| 17 | Chat Audio Inbound | `chat-audio-inbound/` | Gateway | `test -f src/gateway/chat-attachments.ts` |
| 18 | Chat Media Pipeline | `chat-media-pipeline/` | Gateway+Shared | `grep -q "audioUrlByIndex" src/gateway/server-methods/chat.ts` |
| 19 | Chat.send Internal Routing | `chat-send-internal-routing/` | Gateway | `! grep -q "routeChannelCandidate" src/gateway/server-methods/chat.ts` |
| 20 | Silent Reply Filter Removal | `silent-reply-filter-removal/` | Gateway | `! grep -q "extractAssistantTextForSilentCheck" src/gateway/server-methods/chat.ts` |
| 21 | HTTP Tools Channel Reg | `http-tools-channel-reg/` | Gateway | `grep -q "listChannelAgentTools" src/gateway/tools-invoke-http.ts` |
| 22 | ThinkingDefault Shortcut | `thinking-default-fastpath/` | Gateway | `grep -q "thinkingDefault" src/gateway/server-methods/chat.ts` |

## Re-application Order

Patches #15-#22 have a `001.patch` file generated via `git format-patch`.
They must be applied **in sequence** (patches that touch `chat.ts` depend on prior patches):

```bash
# From repo root, after an upstream merge:
for p in \
  patches/gateway-media-endpoint/001.patch \
  patches/image-generate-tool/001.patch \
  patches/http-tools-channel-reg/001.patch \
  patches/silent-reply-filter-removal/001.patch \
  patches/thinking-default-fastpath/001.patch \
  patches/chat-send-internal-routing/001.patch \
  patches/chat-audio-inbound/001.patch \
  patches/chat-media-pipeline/001.patch; do
  git apply --3way "$p" || echo "CONFLICT in $p — resolve manually"
done
```

If a patch conflicts, use the `001.patch` diff + the `README.md` together
to understand what changed and adapt to the new upstream code.

## Scope Legend

- **WA** — WhatsApp only (`src/web/`)
- **Shared** — Cross-channel (`src/auto-reply/`)
- **Gateway** — Gateway server (`src/gateway/`)
- **Infra** — Infrastructure (`src/infra/`)
- **TUI** — Terminal UI (`src/tui/`)
- **CLI** — CLI commands (`src/cli/`)
- **Memory** — Memory/QMD (`src/memory/`)
- **Tools** — Agent tools (`src/agents/tools/`)

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
