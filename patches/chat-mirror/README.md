# P4 — Chat Mirror

**Branch:** `feat/rebase-3.22`
**Type:** Extracted → own file (hardened 2026-03-24)
**Files:** `src/gateway/chat-mirror.ts` (new), `src/gateway/server-chat.ts` (calls)

## What It Does

When `mirror: true` is set on `chat.send`, AI responses from webchat are relayed to the session's original channel (e.g., WhatsApp). Core Butley functionality — webchat→WA delivery.

## Architecture

`maybeMirrorToChannel(sessionKey, text, context)`:
1. Parses `channel` + `peerId` from sessionKey format `agent:{id}:{channel}:{kind}:{peer}`
2. Validates WA channel
3. Calls `sendMessageWhatsApp`

Called from both success and error paths in `server-chat.ts`.

## History

Originally 20-line mirror block copy-pasted in 2 places in `server-chat.ts`. Hardened by extracting to `chat-mirror.ts` — single function, 2 one-line call sites.

## Merge Resilience

**Zero conflict** — own file. If `server-chat.ts` changes, just re-add the import + calls.

## Verify

```bash
test -f src/gateway/chat-mirror.ts && echo "OK" || echo "MISSING"
grep -q 'maybeMirrorToChannel' src/gateway/server-chat.ts && echo "OK" || echo "MISSING"
```

## Author

Bob + Guilherme (original), Bob (extraction) — webchat→WA cross-channel for Butley.
