# P22 — Chat Media Pipeline

**Branch:** `feat/rebase-3.22`
**Type:** Pre-sanitization extract
**Files:** `src/gateway/server-methods/chat.ts`

## What It Does

Extracts `audioUrl` / `imageUrl` from tool result `details` BEFORE `stripEnvelope` sanitizes them away. This is how audio players and image previews render in the Butley frontend on both live broadcasts and chat history reload.

## How It Works

In `chat.send` handler: builds `audioUrlByIndex` and `imageUrlByIndex` maps by scanning messages before sanitization. After sanitization, stamps URLs onto the normalized messages.

## Merge Resilience

**Watch closely** — touches `server-methods/chat.ts` inline. If upstream changes sanitization order, verify extraction still runs first.

## Verify

```bash
grep -q 'audioUrlByIndex' src/gateway/server-methods/chat.ts && echo "OK" || echo "MISSING"
```

## Author

Bob — media URLs lost after message sanitization.
