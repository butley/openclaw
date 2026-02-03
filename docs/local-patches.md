# Local Patches (Clawdbot)

This fork includes a set of local patches originally maintained as shell scripts under
`/Users/lucasmachado/apps/bob-full/clawd/patches`. These changes are **applied directly to
source files** (not dist) so they survive rebuilds.

## Applied Patch Set (2026-02-03)

- **WhatsApp Opus TTS**
  - File: `src/tts/tts.ts`
  - Treats `whatsapp` the same as `telegram` for Opus output selection.
  - Adds a fast path in `resolveChannelId()` for `whatsapp`/`telegram`.

- **TTS Caption for Logging**
  - File: `src/agents/tools/tts-tool.ts`
  - Prepends `🔊 <text>` and a blank line before `MEDIA:` output so voice-note
    transcripts are logged alongside audio output.

- **Audio Transcript Hook**
  - File: `src/auto-reply/reply/get-reply.ts`
  - After media understanding, emits a `message_received` hook when an audio
    transcript exists (content prefixed with `🎤`).

- **Brazil JID Resolution**
  - New file: `src/web/inbound/brazil-jid-resolver.ts`
  - Files updated: `src/web/inbound/send-api.ts`, `src/web/outbound.ts`,
    `src/web/inbound/monitor.ts`, `src/web/active-listener.ts`
  - Resolves 8‑digit vs 9‑digit Brazilian mobile numbers via `onWhatsApp()` and
    caches results in `${CONFIG_DIR}/brazil-jid-cache.json`.

- **TUI Dark Theme**
  - File: `src/tui/theme/theme.ts`
  - Darker backgrounds for user + tool blocks, with ANSI gray for success output.

- **Chat Mirror (Web → WhatsApp)**
  - Files: `src/gateway/server-methods/chat.ts`, `src/gateway/server-chat.ts`,
    `src/gateway/protocol/schema/logs-chat.ts`, `src/infra/agent-events.ts`
  - Adds `mirror?: boolean` to `chat.send` params.
  - When `mirror` is true and the session key is of the form
    `agent:{agentId}:{channel}:{peerKind}:{peerId}`, final replies are mirrored
    back to WhatsApp via `sendMessageWhatsApp`.

## How to Reapply

If you update or rebase from upstream, reapply these changes by:

1. **Cherry-pick the patch branch**: `patches/2026-02-03` (preferred).
2. If conflicts arise, reapply the modifications to the files listed above.
3. Rebuild the project (`pnpm build` or the normal release flow) to regenerate `dist/`.

The original patch scripts remain in `clawd/patches` for reference only; they target
`dist/` in the npm package and are not used in this repo.
