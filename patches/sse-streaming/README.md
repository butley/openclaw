# SSE Streaming Mega-Patch

## Overview
Complete SSE streaming pipeline for Butley webchat. Enables real-time streaming
of text, thinking, and tool calls via Server-Sent Events (AI SDK Data Stream
Protocol v1), replacing the lossy WS broadcast path for webchat consumers.

**Total: 6 core files touched, ~411 new lines (feat/sse-endpoint branch)**
**Pre-requisites on alpha: 3 patches, ~27 lines in core files**

## Architecture
```
Gateway (server-sse.ts) ← gatewayEventBus ← server-broadcast.ts
    ↓ SSE events (sessionKey filter)
Next.js API route proxy (cross-machine)
    ↓ ReadableStream pipe
Browser (sse-stream.ts → assembler → typewriter → React)
```

Zero impact on existing channels (WA, Telegram, Discord, CLI).
All WS broadcast paths unchanged.

---

## Pre-requisite Patches (already on alpha)

> These are standalone patches in the main registry (#15–17). Listed here because they are
> required for SSE to function correctly. Merge these to alpha before merging this patch (#18).

### Patch #15 — Thinking Broadcast
- **File:** `src/agents/pi-embedded-subscribe.ts` (+1 line changed)
- **What:** `streamReasoning = true` unconditionally (was gated on reasoningLevel)
- **Why:** Thinking events never reached webchat without this
- **Commit:** `059322ab4`

### Patch #16 — Tool Events Broadcast
- **Files:** `src/agents/pi-embedded-subscribe.ts` (+17/-6), `src/gateway/server-chat.ts` (+16/-8)
- **What:** Broadcast tool events to ALL WS clients (not just registered connIds)
- **Why:** Observers of WA-initiated runs couldn't see tool progress
- **Commit:** `971d37e91`
- **⚠️ Note:** This commit also bundled clickup-api plugin + WA verbose utils (unrelated)

### Patch #17 — Streaming Throttle Reduction
- **File:** `src/gateway/server-chat.ts` (+1/-1)
- **What:** 150ms → 50ms broadcast throttle
- **Why:** Text appeared in chunky blocks at 150ms intervals
- **Commit:** `ba3d68036`

---

## SSE Patches (feat/sse-endpoint branch — Patch #18)

> Together, the sub-patches below constitute **Patch #18** in the main registry.

### #18-A — SSE Endpoint (core)
- **`src/gateway/server-sse.ts`** — NEW, 357 lines
  - Full SSE endpoint with AI SDK Data Stream Protocol v1
  - sessionKey filter (not runId — frontend generates different IDs)
  - CORS preflight handler (OPTIONS + GET)
  - Event types: start, text-delta, reasoning, tool-input-start, tool-output, finish
  - Explicit `res.flush()` after each write
  - Auto-cleanup on client disconnect

- **`src/gateway/server-broadcast.ts`** — +12 lines
  - `gatewayEventBus` (Node EventEmitter) emits alongside WS broadcast
  - SSE handler subscribes to this bus
  - Zero mutation of existing WS broadcast path

- **`src/gateway/server-http.ts`** — +5 lines
  - Route registration: `GET /api/sse/stream`

- **Commits:** `08d4daa78`, `0bd8e0775` (CORS), `b9c857c0c` (sessionKey filter), 
  `38f3a2466` (explicit flush), `47ed276f4` (remove debug events)

### #18-B — Raw Thinking Text
- **`src/agents/pi-embedded-subscribe.ts`** — +9 lines
  - Emits `rawDelta`/`rawText` alongside `delta`/`text` on thinking events
  - SSE handler uses raw (no "Reasoning:\n" prefix, no `_italic_`)
  - Messaging channels (WA/Discord/Telegram) use formatted as before
  - Backwards-compatible: old consumers ignore new fields

- **`src/agents/pi-embedded-subscribe.handlers.types.ts`** — +1 line
  - `lastRawThinking` state field

- **Commit:** `8c1f7ed53`

### #18-C — Flush Before Tools
- **`src/gateway/server-chat.ts`** — +27 lines
  - Flushes pending throttled text delta before broadcasting tool-start events
  - Prevents text truncation when model switches from text to tool call
  - The 50ms throttle buffer could hold the last text chunk indefinitely

- **Commit:** `a4283e75d`

---

## File Summary (core only, excludes plugins/WA)

| File | Pre-req | SSE | Total |
|------|---------|-----|-------|
| `server-sse.ts` (NEW) | — | +357 | 357 |
| `server-chat.ts` | +9 | +27 | +36 |
| `server-broadcast.ts` | — | +12 | 12 |
| `pi-embedded-subscribe.ts` | +18 | +9 | +27 |
| `pi-embedded-subscribe.handlers.types.ts` | — | +1 | 1 |
| `server-http.ts` | — | +5 | 5 |
| **TOTAL** | **~27** | **411** | **~438** |

## Removal Guide
To completely remove SSE streaming:
1. Delete `src/gateway/server-sse.ts`
2. Remove 5 lines from `server-http.ts` (route registration)
3. Remove 12 lines from `server-broadcast.ts` (gatewayEventBus)
4. Remove 27 lines from `server-chat.ts` (flush before tools)
5. Remove 9 lines from `pi-embedded-subscribe.ts` (rawDelta/rawText)
6. Remove 1 line from `pi-embedded-subscribe.handlers.types.ts`
7. Optionally revert pre-req patches (thinking/tool broadcast, throttle)

Pre-req patches (12-14) are useful independently for any webchat consumer.
