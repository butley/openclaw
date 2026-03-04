# Gateway Media Endpoint

**Scope:** Gateway
**Depends on:** None

## What It Does

Adds a `GET /media/{filename}` HTTP route to the gateway server that serves generated media files (TTS audio, image_generate images) to the frontend with CORS headers.

Also extends TTS temp file cleanup from 5 minutes to 7 days so files remain available for chat history replay.

## Files Modified

| File | Change |
|------|--------|
| `src/gateway/server-http.ts` | New `"media"` route handler (+71 lines) |
| `src/tts/tts-core.ts` | `TEMP_FILE_CLEANUP_DELAY_MS`: 5min → 7 days |

## How It Works

1. Validates filename with `^[\w.-]+$` regex (prevents path traversal)
2. Searches two candidate directories:
   - `/tmp/openclaw/tts-*/` — TTS audio output
   - `/root/clawd/` — image_generate output
3. Serves with proper `Content-Type` (mp3, ogg, opus, wav, webm, png, jpg, gif, webp)
4. Sets `Cache-Control: public, max-age=86400` and `Access-Control-Allow-Origin: *`

## Re-apply

In `src/gateway/server-http.ts`, add a `"media"` entry to the route table (between `hooks` and `tools-invoke`). The handler:
- Extracts filename from URL path after `/media/`
- Validates with `/^[\w.-]+$/`
- Searches `/tmp/openclaw/tts-*/` then `/root/clawd/` for the file
- Returns file with correct Content-Type and CORS headers

In `src/tts/tts-core.ts`, change `TEMP_FILE_CLEANUP_DELAY_MS` to `7 * 24 * 60 * 60 * 1000`.

## Verify

```bash
grep -q '"media"' src/gateway/server-http.ts && echo "OK" || echo "MISSING"
grep -q "7 \* 24" src/tts/tts-core.ts && echo "OK" || echo "MISSING"
```
