# Chat Audio Inbound (Voice Messages via Dashboard)

**Scope:** Gateway
**Depends on:** None

## What It Does

Enables the web dashboard to send audio attachments (browser-recorded voice messages) through the chat gateway. Audio is extracted, saved to disk, transcribed via the audio-preflight pipeline, and the transcript replaces the empty message body.

## Files Modified

| File | Change |
|------|--------|
| `src/gateway/chat-attachments.ts` | NEW — types + extraction function |
| `src/gateway/server-methods/chat.ts` | Integration in `chat.send` handler |

## How It Works

### `chat-attachments.ts` (new file)
- `ChatAudioAttachment` type: `{ label, fileName?, mimeType, data }`
- `isAudioMime(mime)` helper
- `extractAudioAttachments(attachments)`: filters for audio MIME types, handles `video/webm` vs `audio/webm` ambiguity (browsers record audio as `video/webm`; if caller declared `audio/*` but sniffer returns `video/*`, trust the provided MIME)

### `chat.ts` (in `chat.send` handler)
1. After image attachment parsing, calls `extractAudioAttachments()` on the same attachments
2. For each audio attachment: decodes base64, saves via `saveMediaBuffer()`, collects into `parsedAudioPaths`
3. If audio paths exist and no text message was provided: calls `transcribeFirstAudio()` (ElevenLabs Scribe) and replaces `parsedMessage` with transcript
4. Passes `MediaPath`, `MediaUrl`, `MediaPaths`, `MediaUrls` into message context

## Re-apply

1. Create `src/gateway/chat-attachments.ts` with the types and extraction function
2. In `chat.send` handler in `src/gateway/server-methods/chat.ts`:
   - Import `extractAudioAttachments` from `../chat-attachments.js`
   - After existing image attachment handling, add audio extraction block
   - Save audio to disk, transcribe if no text message, set media context fields

## Verify

```bash
test -f src/gateway/chat-attachments.ts && echo "OK" || echo "MISSING"
grep -q "extractAudioAttachments" src/gateway/server-methods/chat.ts && echo "OK" || echo "MISSING"
```
