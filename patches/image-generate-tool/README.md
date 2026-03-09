# Image Generate Tool (Gemini)

**Scope:** Agent Tools
**Depends on:** Gateway Media Endpoint (patch #15)

## What It Does

New `image_generate` agent tool that calls the Gemini API to produce images from text prompts. Saves output to `~/.openclaw/media/` (via `ensureMediaDir()`) and returns a `MEDIA:` marker + `/media/` URL for frontend rendering.

## Files Modified

| File | Change |
|------|--------|
| `src/agents/tools/image-generate-tool.ts` | NEW — complete tool implementation (136 lines) |
| `src/agents/openclaw-tools.ts` | Import + register the tool |

## How It Works

1. Accepts `prompt` (required), optional `model` (default `gemini-3.1-flash-image-preview`), optional `filename`
2. Resolves API key from `GEMINI_API_KEY` or `GOOGLE_API_KEY`
3. Calls Gemini `v1beta/models/{model}:generateContent` with `responseModalities: ["TEXT", "IMAGE"]`
4. Decodes base64 inline image data from response
5. Writes to `~/.openclaw/media/{filename}` via `ensureMediaDir()` — this directory is always in the default media local roots, so `assertLocalMediaAllowed` passes for WhatsApp outbound without needing agent-scoped root resolution
6. Returns via `imageResultFromFile()` with `details.imageUrl = /media/{filename}`

## Re-apply

1. Create `src/agents/tools/image-generate-tool.ts` — exports `createImageGenerateTool({ config })` returning an `AnyAgentTool`
2. In `src/agents/openclaw-tools.ts`:
   - Import `createImageGenerateTool`
   - Instantiate: `const imageGenerateTool = createImageGenerateTool({ config: options?.config })`
   - Add to tools array (unconditionally — no sandbox gating)

Key details:
- Tool name: `image_generate`
- Default filename pattern: `generated-{Date.now()}.png`
- Save location: `~/.openclaw/media/` via `import { ensureMediaDir } from "../../media/store.js"` — NOT `/root/clawd/` (that fails `assertLocalMediaAllowed` for WhatsApp outbound)
- `details` must include `imageUrl` (used by chat media pipeline)
- Text output must include `MEDIA:{fullPath}` marker (backward compat)

## Verify

```bash
test -f src/agents/tools/image-generate-tool.ts && echo "OK" || echo "MISSING"
grep -q "imageGenerateTool" src/agents/openclaw-tools.ts && echo "OK" || echo "MISSING"
```
