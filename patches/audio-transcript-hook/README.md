# Audio Transcript Hook Patch

## Problem
The `message_received` hook fires BEFORE media understanding (transcription) runs.
This means plugins that want to log audio messages never see the transcript.

## Solution
Emit a second `message_received` hook AFTER transcription completes, with the
transcript in the content field and `isTranscript: true` in metadata.

## Files Modified
- `~/.npm-global/lib/node_modules/clawdbot/dist/auto-reply/reply/get-reply.js`

## Apply
```bash
bash ~/clawd/patches/audio-transcript-hook/apply.sh
```
