# P4 — Chat Mirror (webchat → WhatsApp)

**Status:** ✅ Active — bulletproof rewrite  
**Branch:** `feat/rebase-3.22`  
**Author:** Bob (AI agent) with Luke (Lucas Machado)  
**Created:** 2026-02 (alpha/v3.13)  
**Last rewrite:** 2026-03-24 (v3.22 rebase)  
**Upstream risk:** Very low — ~8 lines touch upstream code

---

## Why This Patch Exists

OpenClaw routes conversations by **session key**. When Luke sends a WhatsApp
message, the session key is `agent:main:whatsapp:direct:+553196348700`. The
agent runs, generates a reply, and OpenClaw delivers it back to WhatsApp.

But Luke also uses the **webchat Control UI** (browser dashboard). When he sends
a message from webchat, the reply goes to webchat — but his WhatsApp shows
nothing. The conversation looks dead on the phone while active on the computer.

**The mirror patch solves this:** when a message comes from webchat, the
assistant's final reply is automatically re-delivered ("mirrored") to the
session's original WhatsApp channel. Both surfaces stay in sync.

### Why upstream doesn't have this

OpenClaw treats each channel as independent. The concept of "this session
belongs to WhatsApp but I'm temporarily chatting from webchat" doesn't exist
upstream. They'd need a notion of "session home channel" vs "current surface"
— a bigger architectural change. Our patch is a pragmatic shortcut: the webchat
client sends `mirror: true` in `chat.send`, and our code handles the rest.

---

## Conceptual Specification (for reimplementation)

If the codebase is completely refactored, here's what needs to be true:

### The Contract

1. **The webchat frontend sends a `mirror` flag** with each `chat.send` request.
   Default: `true`. The user can disable it with `mirror: false`.

2. **When `mirror` is true, the system captures the final assistant reply text**
   at the moment it's finalized (after all streaming is done, before any
   cleanup/buffer deletion).

3. **The system delivers that text to the session's "home" channel.** The home
   channel is encoded in the session key itself:
   `agent:{agentId}:{channel}:{peerKind}:{peerId}`.
   Currently only WhatsApp is supported as a mirror target.

4. **Mirror is fire-and-forget.** Failure to deliver doesn't affect the main
   response. Errors are logged, not surfaced.

5. **Mirror is one-shot per run.** Each agent run either mirrors or doesn't.
   No partial mirrors, no retries, no queuing.

### The Data Flow

```
webchat sends chat.send { message: "hello", mirror: true }
                          │
                          ▼
            ┌─ Extract mirror flag from params ─┐
            │   (before schema validation)      │
            └───────────────┬───────────────────┘
                            ▼
            ┌─ Register mirror intent ──────────┐
            │   registerMirror(runId, sessionKey)│
            │   (when agent run starts)         │
            └───────────────┬───────────────────┘
                            ▼
                    Agent runs normally
                    (streaming, tools, etc.)
                            │
                            ▼
            ┌─ Agent run completes ─────────────┐
            │   Final text is resolved          │
            │   BEFORE buffer cleanup           │
            └───────────────┬───────────────────┘
                            ▼
            ┌─ Consume mirror entry ────────────┐
            │   consumeMirror(runId) → entry     │
            │   (one-shot: auto-deletes)        │
            └───────────────┬───────────────────┘
                            ▼
            ┌─ Deliver to home channel ─────────┐
            │   Parse sessionKey → channel+peer │
            │   sendMessageWhatsApp(peerId, txt)│
            └───────────────────────────────────┘
```

### Critical Invariant

**The final text must be captured BEFORE any buffer/state cleanup.**

This is the bug that broke P4 twice. The agent's reply text lives in a
transient buffer (`chatRunState.buffers`) that gets deleted when the run
finalizes. Any mirror code that reads the buffer AFTER deletion gets empty
string → mirror silently fails.

The current solution uses an `onFinalText` callback that fires with the text
already resolved, before cleanup. Any reimplementation MUST respect this
ordering, regardless of how the buffer system works.

---

## Current Implementation (v3.22)

Three design principles: **own state**, **callback pattern**, **schema-free**.

### 1. Self-Contained Registry (`src/gateway/chat-mirror.ts`)

100% fork-owned file. No upstream code.

- `mirrorRegistry`: `Map<runId, { sessionKey, registeredAt }>` using
  `globalThis[Symbol.for("openclaw.chatMirror.registry")]` singleton
  (survives bundler chunk duplication).
- `registerMirror(runId, sessionKey)` — called from `chat.send` handler when
  a run starts. Stores the intent.
- `consumeMirror(runId)` — one-shot: returns entry and auto-deletes it.
  Calling twice returns `undefined` the second time. Leak-proof.
- `deliverMirror(sessionKey, text)` — parses sessionKey to extract channel +
  peerId, sends via `sendMessageWhatsApp`. Fire-and-forget.
- `extractMirrorParam(raw)` — strips `mirror` from raw params object before
  schema validation (see §3 below).
- Auto-cleanup timer (10min) prevents memory leaks from crashed runs that
  never reach `consumeMirror`.

**Why own registry instead of AgentRunContext:** The upstream `AgentRunContext`
type (`src/infra/agent-events.ts`) is a shared struct. Adding `mirror` to it
means: (a) the field must survive `registerAgentRunContext`'s merge logic,
(b) upstream type changes break our patch, (c) it's semantically wrong —
mirror is not an "agent run context" concept. Own registry = zero coupling.

### 2. `onFinalText` Callback (`src/gateway/server-chat.ts`)

- `emitChatFinal` accepts `opts?: { onFinalText?: (text: string) => void }`.
- Callback fires with resolved text **BEFORE** `buffers.delete()`.
- Callers pass a `mirrorCallback` that does `consumeMirror()` + `deliverMirror()`.

**Why callback instead of inline code:** Inline code inside `emitChatFinal`
is invisible during merges — it looks like upstream code and gets overwritten.
A callback parameter is explicitly declared in the function signature, making
it visible in diffs. Also, it decouples mirror from `emitChatFinal`'s internals.

### 3. Schema-Free Param Extraction (`src/gateway/server-methods/chat.ts`)

- `extractMirrorParam(params)` is called BEFORE `validateChatSendParams(params)`.
- It reads `params.mirror`, deletes the key, and returns the boolean value.
- Upstream schema validation never sees the `mirror` property → no conflict
  with `additionalProperties: false`.

**Why strip instead of schema edit:** v3.22 broke P4 because upstream added
`additionalProperties: false` to `ChatSendParamsSchema`. Editing the schema
creates a guaranteed merge conflict on every upstream update. Stripping
before validation means upstream can change the schema however they want.

## Files Modified

| File | Ownership | What changed | Lines |
|---|---|---|---|
| `src/gateway/chat-mirror.ts` | **100% fork** | Full module: registry, delivery, param extraction | ~120 |
| `src/gateway/server-chat.ts` | Upstream + fork | `onFinalText` param on `emitChatFinal` + `mirrorCallback` in event handler | ~8 |
| `src/gateway/server-methods/chat.ts` | Upstream + fork | `extractMirrorParam()` before validation + `registerMirror()` in `onAgentRunStart` | ~6 |

**Files NOT modified (by design):**
- `src/infra/agent-events.ts` — no mirror field on AgentRunContext
- `src/gateway/protocol/schema/logs-chat.ts` — no mirror in schema

---

## Upstream Merge Guide

### If upstream changes `emitChatFinal`:
→ Ensure `opts?` parameter is last. If upstream adds params before it, shift it.
→ Ensure `onFinalText` fires before any buffer/state cleanup.

### If upstream changes `chat.send` handler:
→ `extractMirrorParam(params)` must run before `validateChatSendParams(params)`.
→ `registerMirror(runId, p.sessionKey)` must run inside `onAgentRunStart`.

### If upstream removes or renames `emitChatFinal`:
→ Find wherever the final text is resolved and buffer is cleaned up.
→ Apply the same pattern: capture text → fire callback → then cleanup.

### If upstream adds native multi-channel support:
→ This patch might become unnecessary. Check if their implementation covers
   the "webchat → WA mirror" use case before removing.

## verify-patches.sh

```bash
grep -q "consumeMirror\|deliverMirror\|registerMirror" "$DIST_FILE"
grep -q "onFinalText" "$DIST_FILE"
```

---

## Bug History

| Version | What happened |
|---|---|
| v3.13 (alpha) | ✅ Worked — mirror inline in `server-chat.ts` with direct buffer access |
| v3.22 (first port) | ❌ Broke — `additionalProperties: false` in schema rejected `mirror` param |
| v3.22 (schema fix, `1ee0696b5a`) | ⚠️ Schema fixed, but `emitChatFinal` deleted buffer before mirror read it |
| v3.22 (placement fix, `1d5d616acb`) | ⚠️ Moved mirror inside `emitChatFinal` body — worked but fragile |
| v3.22 (bulletproof, `8079dc3798`) | ✅ Current — own registry, callback, schema-free. No upstream dependencies |

---

## Extending to Other Channels

`deliverMirror()` currently only handles WhatsApp. To add Telegram, Discord, etc.:

1. Add a case in the channel switch inside `deliverMirror()`.
2. Import the channel's send function (e.g. `sendMessageTelegram`).
3. Parse the peerId from the sessionKey (same format: `agent:{id}:{channel}:{kind}:{peer}`).

The registry and callback pattern don't need to change.
