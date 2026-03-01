# WhatsApp Opus TTS Patch (Standalone)

This patch is for **vanilla OpenClaw installs** where WhatsApp voice output may still be treated differently from Telegram in TTS output selection.

## What it changes

In `dist/tts/tts.js`, it applies two changes:

1. **Output format routing**
   - Before: `telegram` uses Opus profile
   - After: `telegram` **and** `whatsapp` use Opus profile

2. **Channel resolution fast-path**
   - Ensures `resolveChannelId()` recognizes lowercase `whatsapp` and `telegram` directly.

## Script

- `patches/apply-whatsapp-opus.sh`

The script is idempotent and tries to auto-detect `dist/tts/tts.js` in common OpenClaw locations.

## Usage

```bash
cd /path/to/openclaw
bash patches/apply-whatsapp-opus.sh
```

If auto-detection fails, pass explicit target:

```bash
TTS_FILE=/absolute/path/to/openclaw/dist/tts/tts.js bash patches/apply-whatsapp-opus.sh
```

## Restart

The script tries to restart one of:

- `openclaw-gateway.service` (preferred)
- `clawdbot-gateway.service` (legacy)

If neither is available, restart manually:

```bash
openclaw gateway restart
```

## Verify

Check the target file has both patterns:

```bash
grep -n 'channelId === "telegram" || channelId === "whatsapp"' /path/to/dist/tts/tts.js
grep -n 'lower === "whatsapp" || lower === "telegram"' /path/to/dist/tts/tts.js
```

## Note about our fork

In the `dev` fork, this logic is already embedded in source (`src/tts/tts.ts`).
This standalone patch mainly exists for vanilla `.17`/older deployments that need the fix without migrating to the fork.
