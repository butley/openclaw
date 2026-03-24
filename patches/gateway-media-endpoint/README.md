# P19 — Gateway Media Endpoint

**Branch:** `feat/rebase-3.22`
**Type:** Additive route
**Files:** `src/gateway/server-http.ts`

## What It Does

`GET /media/{filename}` — serves generated media files (TTS audio, image_generate images) to the Butley frontend with CORS headers.

## How It Works

1. Validates filename (`^[\w.-]+$` — prevents path traversal)
2. Searches `/tmp/openclaw/tts-*/`, `~/.openclaw/media/`
3. Serves with proper Content-Type + `Cache-Control: public, max-age=86400`

## Merge Resilience

**Minimal conflict** — additive route in `server-http.ts`.

## Verify

```bash
grep -q '"media"' src/gateway/server-http.ts && echo "OK" || echo "MISSING"
```

## Author

Bob — media serving for Butley frontend.
