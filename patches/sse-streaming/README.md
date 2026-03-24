# P18 — SSE Streaming Endpoint

**Branch:** `feat/rebase-3.22`
**Type:** Own file (~460 lines)
**Files:** `src/gateway/server-sse.ts` (new)

## What It Does

Complete SSE streaming endpoint for Butley webchat. AI SDK Data Stream Protocol v1. Enables real-time streaming of text, thinking, and tool calls.

Related patches (part of the streaming pipeline):
- P15 (thinking guard split)
- P16 (session-scoped tool broadcast)
- P17 (throttle constant)
- P31 (eventBus singleton)
- P32 (retryable error guard)

## Architecture

```
Butley Frontend (SSE client)
  └── GET /api/sse/stream?sessionKey=...
       └── server-sse.ts
            ├── Subscribes to gatewayEventBus [P31]
            ├── "chat" delta  → text-start/text-delta/text-end
            ├── "agent" tool  → tool-input-start/available/output
            ├── "agent" think → reasoning-start/delta/end
            └── "chat" final  → finish-step/finish
```

Zero impact on existing channels (WA, Telegram, Discord, CLI).

## ⚠️ Pre-Launch Requirements

- **No authentication** — accepts any request with valid `sessionKey`. Mitigated by Tailscale.
- **CORS wildcard** — `Access-Control-Allow-Origin: *`. Should use `allowedOrigins`.

## Merge Resilience

**Zero conflict** — own file. Route registration is ~5 lines in `server-http.ts`.

## Verify

```bash
test -f src/gateway/server-sse.ts && echo "OK" || echo "MISSING"
```

## Author

Bob — backbone of Butley frontend streaming.
