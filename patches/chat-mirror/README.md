# P4 — Chat Mirror (webchat → WhatsApp)

**Status:** ✅ Active — bulletproof rewrite (2026-03-24)  
**Branch:** `feat/rebase-3.22`  
**Upstream risk:** Very low — 4 lines touch upstream files

## What It Does

When a message is sent from the webchat Control UI, the assistant's reply is
automatically re-delivered ("mirrored") to the session's original channel
(currently WhatsApp). This lets users interact via webchat while keeping their
WhatsApp conversation in sync.

## Architecture

The mirror patch is designed for **zero upstream coupling**:

### 1. Self-Contained Registry (`chat-mirror.ts`)
- `mirrorRegistry`: `Map<runId, { sessionKey, registeredAt }>` using
  `globalThis[Symbol.for()]` singleton (survives bundler chunk duplication).
- `registerMirror(runId, sessionKey)` — called from chat.send handler.
- `consumeMirror(runId)` — one-shot: returns entry and auto-deletes.
- `deliverMirror(sessionKey, text)` — parses sessionKey, sends to WhatsApp.
- Auto-cleanup timer (10min) prevents leaks from crashed runs.

**No dependency on AgentRunContext.** Upstream can refactor that type freely.

### 2. `onFinalText` Callback (`server-chat.ts`)
- `emitChatFinal` accepts `opts?: { onFinalText?: (text: string) => void }`.
- Callback fires **before** `buffers.delete()` — structurally prevents the
  buffer-after-delete bug that broke the previous implementation.
- Only 2 lines added to the upstream function signature + 2 lines in body.

### 3. Schema-Free Param Extraction (`chat-mirror.ts`)
- `extractMirrorParam(raw)` — strips `mirror` from raw params object **before**
  TypeBox/Zod schema validation runs.
- Upstream `additionalProperties: false` can never reject it.
- Default: `true` (all webchat sends mirror to WA unless `mirror: false`).

## Files Modified

| File | What changed | Lines |
|---|---|---|
| `src/gateway/chat-mirror.ts` | **100% fork-owned.** Full module. | ~120 |
| `src/gateway/server-chat.ts` | `onFinalText` param on emitChatFinal + mirrorCallback in event handler | ~8 |
| `src/gateway/server-methods/chat.ts` | `extractMirrorParam()` before validation + `registerMirror()` in onAgentRunStart | ~6 |

**Not modified (by design):**
- `src/infra/agent-events.ts` — no mirror field on AgentRunContext
- `src/gateway/protocol/schema/logs-chat.ts` — no mirror in schema

## Upstream Merge Guide

On future merges, these are the only patterns to verify:

1. **`emitChatFinal` signature** — ensure `opts?` parameter is last. If upstream
   adds parameters before it, just shift it.
2. **`chat.send` handler** — `extractMirrorParam(params)` must run before
   `validateChatSendParams(params)`. If upstream restructures the handler,
   move the call accordingly.
3. **Event handler lifecycle block** — the `mirrorCallback` + `{ onFinalText }`
   pattern on both `emitChatFinal` call sites. Easy to spot in merge diffs.

## verify-patches.sh Pattern

```bash
grep -q "consumeMirror\|deliverMirror\|registerMirror" "$DIST_FILE"
grep -q "onFinalText" "$DIST_FILE"
```

## Bug History

- **v3.13 (alpha):** Worked — mirror was inline in server-chat.ts with direct buffer access.
- **v3.22 (first port):** Broke — extracted to chat-mirror.ts but called after buffer deletion.
- **v3.22 (quick fix, `1d5d616acb`):** Moved call inside emitChatFinal body. Fixed but fragile.
- **v3.22 (bulletproof, `8079dc3798`):** Current architecture. Own registry, callback pattern, schema-free.
