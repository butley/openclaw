# Custom Patches — butley/openclaw

33 active custom patches on top of upstream openclaw/openclaw.

## Absorbed by Upstream (no longer maintained)

| # | Name | Absorbed in | Notes |
|---|------|-------------|-------|
| 1 | WhatsApp Opus TTS | v2026.3.1 | Upstream added `VOICE_BUBBLE_CHANNELS` Set including `"whatsapp"` in `src/tts/tts.ts` |
| 6 | TTS Caption Logging | v2026.2.26 | Upstream included equivalent logging |

## Patch Registry

> **Branch key:** `alpha` = merged into stable base

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
| 18 | SSE Streaming Endpoint | `sse-streaming/` | Gateway/Agents | `alpha` | `test -f src/gateway/server-sse.ts` |
| 19 | Gateway Media Endpoint | `gateway-media-endpoint/` | Gateway | `alpha` | `grep -q '"media"' src/gateway/server-http.ts` |
| 20 | Image Generate Tool | `image-generate-tool/` | Tools | `alpha` | `test -f src/agents/tools/image-generate-tool.ts` |
| 21 | Chat Audio Inbound | `chat-audio-inbound/` | Gateway | `alpha` | `test -f src/gateway/chat-attachments.ts` |
| 22 | Chat Media Pipeline | `chat-media-pipeline/` | Gateway+Shared | `alpha` | `grep -q "audioUrlByIndex" src/gateway/server-methods/chat.ts` |
| 23 | Chat.send Internal Routing | `chat-send-internal-routing/` | Gateway | `alpha` | `grep -q "INTERNAL_MESSAGE_CHANNEL" src/gateway/server-methods/chat.ts` |
| 24 | Silent Reply Filter Removal | `silent-reply-filter-removal/` | Gateway | `alpha` | `! grep -q "extractAssistantTextForSilentCheck" src/gateway/server-methods/chat.ts` |
| 25 | HTTP Tools Channel Reg | `http-tools-channel-reg/` | Gateway | `alpha` | `grep -q "listChannelAgentTools" src/gateway/tools-invoke-http.ts` |
| 26 | ThinkingDefault Shortcut | `thinking-default-fastpath/` | Gateway | `alpha` | `grep -q "thinkingDefault" src/gateway/server-methods/chat.ts` |
| 27 | Media Inbound Path | — | Gateway | `alpha` | `grep -q "inbound" src/gateway/server-http.ts` |
| 28 | SSE Cron Filter | — | Gateway | `alpha` | `grep -q ":cron:" src/gateway/server-sse.ts` |
| 29 | Chat History Sender Meta | — | Gateway | `alpha` | `grep -q "senderMeta" src/gateway/server-methods/chat.ts` |
| 30 | Chat History Group Context | — | Gateway | `alpha` | `grep -q "chatHistory" src/gateway/server-methods/chat.ts` |
| 31 | SSE EventBus Singleton | — | Gateway | `alpha` | `grep -q "__openclaw_gatewayEventBus__" src/gateway/server-broadcast.ts` |
| 32 | SSE Retryable Error Suppression | — | Gateway | `work` | `grep -q "RETRYABLE_LIFECYCLE_ERROR_RE" src/gateway/server-chat.ts` |
| 33 | Memory Flush Context Priority | — | Agents | `work` | `grep -q "FORK-PATCH-33" src/auto-reply/reply/memory-flush.ts` |
| 34 | Session Chain (previousSessionId) | — | Infra | `work` | `grep -q "FORK-PATCH-34" src/config/sessions/types.ts` |
| 35 | Context1m per-model in all context token callsites | — | Agents | `work` | `grep -q "FORK-PATCH-35" src/agents/context-window-guard.ts src/auto-reply/reply/agent-runner.ts src/auto-reply/reply/followup-runner.ts src/auto-reply/reply/agent-runner-memory.ts` |
| 36 | Butley System Prompt | `butley-system-prompt/` | Agents | `work` | `grep -q "BUTLEY_IDENTITY_PROMPT" src/agents/system-prompt.ts` |
| 37 | Token Usage Tracking | — | Agents | `work` | `grep -q "FORK-PATCH-37" src/agents/pi-embedded-runner/run.ts` |


## Re-application Order

Patches #19-#26 and #36 have a `001.patch` file generated via `git format-patch`.
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
  patches/chat-media-pipeline/001.patch \
  patches/butley-system-prompt/001.patch; do
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
- **Agents** — Agent runtime (`src/agents/`)
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
