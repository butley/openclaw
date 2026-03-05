# Chat Media URL Pipeline (audioUrl / imageUrl)

**Scope:** Gateway + Shared
**Depends on:** Gateway Media Endpoint (#15), Image Generate Tool (#16)

## What It Does

Propagates `audioUrl` and `imageUrl` from tool result `details` through to chat history messages and WebSocket broadcasts, so the frontend can render audio players and image previews.

This is the core "glue" patch connecting tool outputs to the frontend rendering.

## Files Modified

| File | Change |
|------|--------|
| `src/agents/tools/tts-tool.ts` | Adds `audioUrl` to result details |
| `src/gateway/server-methods/chat.ts` | History normalization + live broadcast emission |
| `src/auto-reply/reply/dispatch-from-config.ts` | MEDIA marker extraction from tool results |

## How It Works

### Part A: Tool Details

**`tts-tool.ts`:** Computes `audioUrl = /media/{basename}` from the audio output path and includes it in the returned `details` object. This is the source data for downstream extraction.

**`image-generate-tool.ts`** (covered in patch #16): Similarly includes `imageUrl` in `details`.

### Part B: Chat History (`chat.history` handler)

Before `sanitizeChatHistoryMessages()` strips `details`, the handler:
1. Scans message array for `toolResult` messages with `details.audioUrl` or `details.imageUrl`
2. Uses a state machine: accumulates pending URL, then stamps it on the next **final** assistant message (one with `stopReason !== "toolUse"`)
3. Builds `audioUrlByIndex` and `imageUrlByIndex` maps
4. After sanitization, applies URLs to the normalized messages

This is why audio/images show on page reload — the history response has the URLs directly on assistant messages.

### Part C: Live Broadcasts (`chat.send` handler)

1. Introduces `collectedMediaUrls: string[]` and `captureMediaFromPayload()` helper
2. Runs on **every** deliver callback, accumulating media URLs from `payload.mediaUrls`, `payload.mediaUrl`, and `MEDIA:/...` markers in text
3. After agent run completes, classifies URLs by extension into `audioUrls` and `imageUrls`
4. Emits `audioReady` / `imageReady` WebSocket broadcasts with the `/media/` URL
5. **Fallback:** If no media collected via callbacks (ACP dispatch path loses MEDIA markers), scans session transcript for last `toolResult` with `details.imageUrl` and emits `imageReady`

### Part D: dispatch-from-config.ts

In `resolveToolDeliveryPayload`, when the payload has no explicit `mediaUrl`/`mediaUrls`, checks for `MEDIA:/...` markers in text. If found, extracts paths into `mediaUrls` so the deliver callback can collect them. Belt-and-suspenders for the non-ACP path.

## Re-apply

This is the most complex patch. Key areas to modify:

1. **`tts-tool.ts`:** Add `audioUrl: /media/{basename}` to the `details` object in the return value

2. **`chat.ts` — chat.history handler (audioUrlByIndex + imageUrlByIndex):**
   - Before the `sanitizeChatHistoryMessages()` call, add two scanning blocks
   - Pattern: iterate sanitized messages, track `pendingAudioUrl`/`pendingImageUrl` from toolResult details, assign to next final assistant message index
   - After sanitization, stamp `audioUrl`/`imageUrl` on the normalized messages at those indices

3. **`chat.ts` — chat.send handler (collectedMediaUrls):**
   - Add `collectedMediaUrls` array and `captureMediaFromPayload()` helper
   - Call capture on every deliver callback
   - After agent run, classify and broadcast `audioReady`/`imageReady`
   - Add session transcript fallback scan for imageUrl

4. **`dispatch-from-config.ts`:** In `resolveToolDeliveryPayload`, add MEDIA marker regex extraction when no media fields present

## Verify

```bash
grep -q "audioUrl" src/agents/tools/tts-tool.ts && echo "OK" || echo "MISSING"
grep -q "audioUrlByIndex" src/gateway/server-methods/chat.ts && echo "OK" || echo "MISSING"
grep -q "imageUrlByIndex" src/gateway/server-methods/chat.ts && echo "OK" || echo "MISSING"
grep -q "collectedMediaUrls" src/gateway/server-methods/chat.ts && echo "OK" || echo "MISSING"
grep -q "imageReady" src/gateway/server-methods/chat.ts && echo "OK" || echo "MISSING"
grep -q 'MEDIA:' src/auto-reply/reply/dispatch-from-config.ts && echo "OK" || echo "MISSING"
```
