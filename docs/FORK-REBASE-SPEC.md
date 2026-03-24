# Fork Rebase Specification — butley/openclaw

> **⚠️ HISTORICAL DOCUMENT** — Written 2026-03-15 after the failed v3.13 merge attempt.
> The v3.22 rebase was completed successfully on 2026-03-24 using a wave-based approach.
>
> **For current state, see:**
> - `docs/fork-patches.md` — complete patch map
> - `docs/FORK-NEXT-STEPS.md` — current status + Wave 7 plan
> - `docs/FORK-PATCHES-SPEC.md` — implementation spec for future rebases
> - `patches/README.md` — patch registry with verify commands
> - `patches/KNOWN-ISSUES.md` — open bugs and pre-launch requirements
>
> This document is preserved for the diagnostic context (bundler chunk analysis,
> streaming pipeline trace, Pi SDK compatibility notes) which remains relevant.

## Purpose

This document provides everything needed to re-implement our fork patches on upstream v2026.3.13-1 from scratch. Generated after a failed merge attempt on 2026-03-15 that took ~5 hours and resulted in working tool streaming but broken thinking streaming.

## The Problem

Our fork (based on upstream pre-v2026.3.3, ~v2026.3.2+103 commits) has 30 patches across 59 source files. Merging upstream v2026.3.13-1 (2233 commits ahead) breaks the streaming pipeline because:

1. **Pi SDK changed** from 0.55.3 → 0.58.0 — internal APIs for thinking/reasoning callbacks changed
2. **Bundler chunk duplication** — upstream added more entry points, splitting shared modules across 14+ chunks (was 6). Module-level state (Maps, Sets) gets duplicated → events emitted in one chunk never reach listeners in another
3. **`isControlUiVisible` gate** — upstream added a new flag that suppresses streaming events for non-webchat sessions (our Butley frontend watches WA sessions via SSE, so this kills streaming)
4. **Route resolution** — upstream's `resolveChatSendOriginatingRoute` changes how webchat→WA delivery works, conflicting with our patch #23

## Current State (post-attempt)

- Branch: `feat/upstream-merge-3.13`
- Tool calls + intermediate text: ✅ stream in real-time (restored 4 alpha files)
- Thinking/reasoning: ❌ broken (Pi SDK 0.58.0 incompatibility)
- WA inbound/outbound: ✅ works
- Approach used: restored `server-chat.ts`, `agent-events.ts`, `server-broadcast.ts`, `server-sse.ts` from alpha verbatim

## Recommended Approach: Re-implement on Clean Upstream

Instead of merging, start from clean upstream v2026.3.13-1 and re-apply each patch understanding the new codebase. Use the per-file diffs below as reference for WHAT each patch does, then adapt to upstream's new patterns.

### Key differences to account for:

| Area                | Alpha (v2026.3.2)                                                        | Upstream (v2026.3.13)                                                         |
| ------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Pi SDK              | 0.55.3                                                                   | 0.58.0                                                                        |
| Thinking            | `emitReasoningStream` called with `text` from `extractAssistantThinking` | Same function but SDK may pass empty text; `onReasoningStream` guard added    |
| Bundler chunks      | 6 chunks for agent-events                                                | 14+ chunks — MUST use globalThis singleton                                    |
| agent-events.ts     | Module-level Maps                                                        | Must use lazy globalThis getter (ESM hoisting race)                           |
| server-chat.ts      | Inline flush + broadcast                                                 | `flushBufferedChatDeltaIfNeeded` + `broadcastToConnIds` for targeted delivery |
| server-broadcast.ts | Our EventBus singleton                                                   | Upstream has own broadcast; we need singleton for SSE                         |
| isControlUiVisible  | Not present                                                              | Gates streaming delivery — must remove for our use case                       |
| Route resolution    | `INTERNAL_MESSAGE_CHANNEL` hardcoded                                     | `resolveChatSendOriginatingRoute` function — compatible but different         |
| Model catalog       | `reasoning: true` from API                                               | `reasoning: false` from API — must override for Anthropic models              |

## Fork Files — Complete Inventory

### Files CREATED by our fork (not in upstream)

| File                                       | Purpose                                    | Patch # |
| ------------------------------------------ | ------------------------------------------ | ------- |
| `src/gateway/server-sse.ts`                | SSE streaming endpoint for Butley frontend | #18     |
| `src/infra/inbound-events.ts`              | WS inbound push events                     | #5      |
| `src/agents/tools/image-generate-tool.ts`  | Gemini image generation tool               | #20     |
| `src/cli/logs-pretty-formatter.ts`         | Pretty log formatting                      | #10     |
| `src/cli/qmd-cli.ts`                       | QMD CLI integration                        | —       |
| `src/web/auto-reply/wa-streaming-utils.ts` | WA paragraph streaming helpers             | #11     |
| `src/web/auto-reply/wa-verbose-utils.ts`   | WA verbose mode helpers                    | #13     |
| `src/web/inbound/brazil-jid-resolver.ts`   | Brazil +55 JID resolution                  | #2      |
| `src/web/inbound/contact-names.ts`         | Contact name extraction                    | —       |

### Files MODIFIED by our fork (59 total)

See per-file diffs in `/tmp/fork-patches/` (generated 2026-03-15).

Full combined diff: `/tmp/fork-full-diff.patch` (5813 lines)

### Streaming Pipeline — Critical Integration Map

```
Frontend (Butley)
  └── OpenClawChatTransport (SSE client)
       └── GET /api/sse/stream?sessionKey=...
            └── server-sse.ts (our file, #18)
                 ├── Subscribes to gatewayEventBus ("chat", "agent", "message.inbound")
                 ├── Maps "chat" delta events → text-start/text-delta/text-end
                 ├── Maps "agent" tool events → tool-input-start/tool-input-available/tool-output-available
                 ├── Maps "agent" thinking events → reasoning-start/reasoning-delta/reasoning-end
                 └── Maps "chat" final → finish-step/finish

Gateway Event Flow:
  Pi SDK session
    └── pi-embedded-subscribe.ts (patch #15: streamReasoning:true)
         ├── emitAgentEvent({stream:"tool"}) → tool events
         ├── emitAgentEvent({stream:"thinking"}) → reasoning events  ← BROKEN (sessionKey=NONE)
         └── emitAgentEvent({stream:"assistant"}) → text events
              │
              └── agent-events.ts (emitAgentEvent)
                   ├── Enriches with sessionKey from runContextById ← REQUIRES globalThis singleton
                   └── Calls registered listeners
                        │
                        └── createAgentEventHandler (server-chat.ts)
                             ├── For tool events: flushBufferedChatDelta + broadcast("agent")
                             ├── For other events: broadcast("agent")
                             ├── For assistant text: emitChatDelta → broadcast("chat")
                             └── nodeSendToSession (SSE delivery)
                                  │
                                  └── server-broadcast.ts (gatewayEventBus)
                                       └── EventEmitter singleton (patch #31)
                                            └── server-sse.ts listeners
```

### Thinking Stream — Root Cause of Failure

The thinking stream breaks because:

1. `emitAgentEvent({stream:"thinking", runId: X})` is called WITHOUT explicit `sessionKey`
2. It relies on `runContextById.get(X)` to find the sessionKey
3. `registerAgentRunContext(X, {sessionKey: "agent:main:whatsapp:..."})` was called earlier
4. BUT with 14 bundler chunks, the `runContextById` Map in the chunk that registered ≠ the Map in the chunk that emits
5. The lazy globalThis getter pattern was applied but the thinking events STILL show `sessionKey=NONE`
6. This means either the getter doesn't fully solve the ESM hoisting race, or there's another Map instance somewhere

### What Works vs What Doesn't

| Feature             | merge-3.13 (current) | Alpha | Notes                                                           |
| ------------------- | -------------------- | ----- | --------------------------------------------------------------- |
| Tool call streaming | ✅                   | ✅    | Fixed by restoring alpha server-chat/broadcast/sse/agent-events |
| Text streaming      | ✅                   | ✅    |                                                                 |
| Intermediate text   | ✅                   | ✅    |                                                                 |
| Thinking streaming  | ❌                   | ✅    | Pi SDK 0.58.0 + bundler chunk issue                             |
| WA delivery         | ✅                   | ✅    |                                                                 |
| WA inbound          | ✅                   | ✅    |                                                                 |

## Per-Patch Reference

Full diff for each patch is in `/tmp/fork-patches/`. Key patches:

| #   | Name                    | Files                                       | Lines Changed | Risk in Rebase        |
| --- | ----------------------- | ------------------------------------------- | ------------- | --------------------- |
| 2   | Brazil JID              | `outbound.ts`, `brazil-jid-resolver.ts`     | ~80           | LOW — isolated        |
| 3   | Audio Transcript Hook   | `get-reply.ts`                              | ~10           | LOW                   |
| 4   | Chat Mirror             | `server-methods/chat.ts`                    | ~20           | MEDIUM — routing      |
| 5   | WS Inbound Push         | `inbound-events.ts`, `agent-events.ts`      | ~50           | MEDIUM                |
| 8   | Status Card             | `status.ts`                                 | ~40           | LOW                   |
| 11  | WA Paragraph Streaming  | `deliver-reply.ts`, `wa-streaming-utils.ts` | ~200          | LOW — isolated        |
| 13  | Verbose Light           | `thinking.ts`, `commands.ts`                | ~20           | LOW                   |
| 15  | Webchat Thinking Stream | `pi-embedded-subscribe.ts`                  | ~5            | HIGH — SDK compat     |
| 16  | Tool Events Broadcast   | `server-chat.ts`                            | ~30           | HIGH — streaming core |
| 17  | Streaming Throttle      | `server-chat.ts`                            | ~10           | HIGH                  |
| 18  | SSE Streaming Endpoint  | `server-sse.ts` (new file)                  | ~460          | HIGH — streaming core |
| 22  | Chat Media Pipeline     | `server-methods/chat.ts`                    | ~50           | MEDIUM                |
| 23  | Chat Internal Routing   | `server-methods/chat.ts`                    | ~20           | HIGH — delivery core  |
| 29  | Sender Meta             | `server-methods/chat.ts`                    | ~30           | MEDIUM                |
| 30  | Group Chat History      | `server-methods/chat.ts`                    | ~40           | MEDIUM                |
| 31  | SSE EventBus Singleton  | `server-broadcast.ts`                       | ~30           | HIGH — bundler        |

## Lessons Learned

1. **Never merge streaming files** — the streaming pipeline is tightly coupled across 6+ files
2. **Pi SDK version changes break handlers** — the subscribe/handler files must match the SDK version
3. **Bundler chunk duplication is the #1 enemy** — any module-level state MUST use globalThis lazy getters
4. **`reasoning: false` in model catalog** — Anthropic API discovery doesn't report reasoning capability; must override
5. **`isControlUiVisible`** — upstream gate that kills SSE for WA sessions; must be removed/bypassed
6. **Test the FULL chain** — build passing ≠ streaming working. Always test: text + tools + thinking + WA delivery

## Recommended Next Steps

1. Generate per-file diffs as git format-patch (more portable than raw diffs)
2. Start from clean upstream v2026.3.13-1 checkout
3. Apply patches in order of risk: LOW first, HIGH last
4. After each patch group: build + test streaming chain
5. For the streaming pipeline (patches #15, #16, #17, #18, #31): re-implement from scratch understanding the new upstream patterns, using the alpha code as REFERENCE not as source
6. Use Codex CLI / GPT-5.4 for the streaming re-implementation — needs full codebase context + understanding of both alpha and upstream patterns

---

## Frontend ↔ Fork Protocol (CRITICAL)

### SSE Connection

The Butley frontend (`feat/ai-sdk-transport` branch) connects to the gateway via:

```
GET /api/sse/stream?sessionKey=agent:main:whatsapp:group:120363406260200934@g.us
```

File: `frontend/src/lib/chat-v2/openclaw-chat-transport.ts`

### Event Protocol (SSE → Frontend)

The gateway SSE endpoint (`server-sse.ts`) emits events in AI SDK Data Stream Protocol format. The frontend transport maps them to `UIMessageChunk` objects:

| Gateway SSE Event                                                                | AI SDK Type             | When                       |
| -------------------------------------------------------------------------------- | ----------------------- | -------------------------- |
| `{"type":"connected","sessionKey":"..."}`                                        | Ignored                 | SSE connection established |
| `{"type":"start","messageId":"..."}`                                             | Start signal            | New assistant run begins   |
| `{"type":"text-start","id":"text_N"}`                                            | `text-start`            | Text block begins          |
| `{"type":"text-delta","id":"text_N","delta":"..."}`                              | `text-delta`            | Incremental text           |
| `{"type":"text-end","id":"text_N"}`                                              | `text-end`              | Text block ends            |
| `{"type":"reasoning-start","id":"reasoning_N"}`                                  | `reasoning-start`       | Thinking block begins      |
| `{"type":"reasoning-delta","id":"reasoning_N","delta":"..."}`                    | `reasoning-delta`       | Incremental thinking       |
| `{"type":"reasoning-end","id":"reasoning_N"}`                                    | `reasoning-end`         | Thinking block ends        |
| `{"type":"tool-input-start","toolCallId":"...","toolName":"..."}`                | `tool-input-start`      | Tool call begins           |
| `{"type":"tool-input-available","toolCallId":"...","toolName":"...","input":{}}` | `tool-input-available`  | Tool args available        |
| `{"type":"tool-output-available","toolCallId":"...","output":{}}`                | `tool-output-available` | Tool result available      |
| `{"type":"finish-step"}`                                                         | `finish-step`           | Step complete              |
| `{"type":"finish"}`                                                              | `finish`                | Run complete               |
| `{"type":"error","errorText":"..."}`                                             | `error`                 | Error occurred             |
| `{"type":"user-message","content":"...","from":"..."}`                           | Custom                  | Cross-channel user message |

### Frontend Files (feat/ai-sdk-transport branch)

| File                                         | Purpose                                   |
| -------------------------------------------- | ----------------------------------------- |
| `src/lib/chat-v2/openclaw-chat-transport.ts` | SSE client, maps events to UIMessageChunk |
| `src/lib/chat-v2/use-ai-sdk-chat.ts`         | React hook wrapping AI SDK `useChat`      |
| `src/lib/chat-v2/sse-stream.ts`              | SSE stream utilities                      |
| `src/lib/chat-v2/stream-assembler.ts`        | Message assembly from stream chunks       |
| `src/lib/chat-v2/gateway-runtime.tsx`        | Gateway WS runtime context                |
| `src/lib/chat-v2/message-filters.ts`         | Message filtering/dedup                   |

### Key Frontend Commits

```
2da884d feat: per-view SSE lifecycle + history loading + edge case handling
28bc22a fix: wss→https protocol for SSE + fix consumer stream race condition
2663d91 refactor: native useChat + OpenClawChatTransport replaces manual assembler
9629bbb fix: index-based dedup — skip chatMessages already covered by history sync
```

## Gateway Internal Event Flow (Detailed)

### How emitAgentEvent connects to SSE

```
1. Pi SDK session generates event (thinking/tool/assistant)
2. pi-embedded-subscribe.ts calls emitAgentEvent({stream:"thinking|tool|assistant", runId, data})
   - NO explicit sessionKey — depends on runContextById lookup
3. agent-events.ts emitAgentEvent():
   a. Gets nextSeq from seqByRun Map
   b. Looks up context = runContextById.get(runId)
   c. sessionKey = event.sessionKey ?? context?.sessionKey  ← THIS IS WHERE THINKING BREAKS
   d. Enriches event with sessionKey, seq, ts
   e. Iterates over listeners Set, calls each listener(enriched)
4. createAgentEventHandler (server-chat.ts) is one of the listeners:
   a. For tool events (stream==="tool"): flush delta + broadcast("agent", toolPayload)
   b. For non-tool events: broadcast("agent", agentPayload)
   c. For assistant text: emitChatDelta → broadcast("chat", payload)
   d. ALSO: nodeSendToSession(sessionKey, "agent"|"chat", payload)
5. broadcast() in server-broadcast.ts:
   a. Emits to gatewayEventBus (EventEmitter singleton) → SSE picks up
   b. Sends to connected WS clients
6. server-sse.ts onAgentEvent(payload):
   a. Filters by sessionKey match
   b. If stream==="thinking": emits reasoning-start/delta/end
   c. If stream==="tool": emits tool-input-start/available/output-available
7. server-sse.ts onChatEvent(payload):
   a. Filters by sessionKey match
   b. If state==="delta": emits text-start/text-delta
   c. If state==="final": emits finish-step/finish
```

### The Bundler Chunk Problem

The gateway builds with tsdown which splits code into chunks. With upstream v2026.3.13:

- agent-events.ts ends up in 6+ different chunks
- Each chunk gets its OWN copy of module-level variables (Maps, Sets)
- `registerAgentRunContext(runId, {sessionKey})` writes to chunk A's Map
- `emitAgentEvent({runId})` reads from chunk B's Map → context not found → sessionKey=undefined
- SSE filters by sessionKey → undefined never matches → event dropped

**Fix required:** All module-level state in agent-events.ts MUST use globalThis singleton with lazy getter pattern (function that reads globalThis at call time, not import time).

### The Thinking Problem (sessionKey=NONE)

Even with globalThis lazy getters, thinking events showed `sessionKey=NONE`. This means:

1. Either the lazy getter pattern doesn't fully solve the ESM hoisting race
2. Or `registerAgentRunContext` is called with a different runId than the Pi SDK uses internally
3. Or the Pi SDK 0.58.0 generates a different internal runId for the session

The alpha (Pi SDK 0.55.3) did NOT have this problem — suggesting the SDK changed how runIds are propagated to the subscribe callback.

## Errors Encountered During Merge (2026-03-15)

### Error 1: Tool streaming broken

- **Symptom:** Tool calls appear only after full response, not in real-time
- **Root cause:** Upstream `isControlUiVisible` gate + bundler chunk duplication
- **Fix that worked:** Restore server-chat.ts, agent-events.ts, server-broadcast.ts, server-sse.ts from alpha

### Error 2: WA delivery broken (from merge attempt 1, 2026-03-15 02:45)

- **Symptom:** Webchat messages never reach WhatsApp
- **Root cause:** Upstream `resolveChatSendOriginatingRoute` resolves webchat→WA as `internal`
- **Fix:** Keep our `INTERNAL_MESSAGE_CHANNEL` routing (patch #23)

### Error 3: Thinking streaming broken

- **Symptom:** `reasoning-start`/`reasoning-delta` never appear on SSE
- **Root cause (confirmed):** `emitAgentEvent({stream:"thinking"})` emits with `sessionKey=NONE` → SSE filters it out
- **Why:** runContextById Map in emitAgentEvent's chunk ≠ Map in registerAgentRunContext's chunk (bundler split)
- **Attempted fixes:** globalThis singleton, lazy getters — confirmed the singleton works (same state ID) but sessionKey still NONE
- **Status:** UNRESOLVED — likely Pi SDK 0.58.0 runId mismatch

### Error 4: `reasoning: false` in model catalog

- **Symptom:** Even with thinkingLevel=high, Anthropic API doesn't receive thinking params
- **Root cause:** API discovery reports `reasoning: false` for Opus 4.6; Pi SDK checks `model.reasoning`
- **Fix:** Override `model.reasoning = true` for `anthropic-messages` models in attempt.ts
