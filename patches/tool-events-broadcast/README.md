# P16 — Tool Events Broadcast

**Status:** ✅ Active — bulletproof rewrite  
**Branch:** `feat/rebase-3.22`  
**Author:** Bob (AI agent) with Luke (Lucas Machado)  
**Created:** 2026-02 (alpha/v3.13)  
**Last rewrite:** 2026-03-25 (v3.22 rebase)  
**Upstream risk:** Low — 1 line + 1 import touch upstream code

---

## Why This Patch Exists

### The Product Problem

In Butley's webchat dashboard, when an agent uses tools (searching the web,
reading files, calling APIs), the user should see **live tool cards** — not
just wait in silence for a final text blob. Tool streaming is what makes the
dashboard feel alive: you see the agent thinking, acting, and producing
results in real time.

Without tool streaming:
- Agent starts running → owner sees a pulsing dot for 30+ seconds → suddenly
  a wall of text appears → no insight into what happened

With tool streaming:
- Agent starts running → owner sees "🔧 web_search" card appear → arguments
  visible → result arrives → next tool fires → text weaves between tools →
  the whole process is legible and supervisable

### Why It Broke in v3.22

In alpha (v3.13), OpenClaw delivered **all agent events** — text, thinking,
and tools — via a single global `broadcast()` call. Every connected WebSocket
client and every SSE listener received everything.

Upstream v3.22 made a deliberate **security improvement**: tool events were
moved from global broadcast to **targeted delivery** via three scoped
registries. The rationale was sound — tool payloads carry sensitive data
(API keys, file contents, query results) and shouldn't leak across sessions
in a multi-tenant deployment.

The problem: **they forgot SSE.**

### How the Gateway Delivers Events

The gateway has two independent delivery mechanisms:

| Mechanism | How clients connect | How events arrive |
|---|---|---|
| **WebSocket** | Direct TCP connection, registered in client sets | `broadcast()` → iterate all clients; or `broadcastToConnIds()` → iterate targeted set |
| **SSE** | HTTP long-poll, subscribes to `gatewayEventBus` | `gatewayEventBus.emit("agent", payload)` → SSE handler filters by sessionKey |

The key function is `broadcast()` in `server-broadcast.ts`:

```ts
const broadcast = (event, payload, opts) => {
  gatewayEventBus.emit(event, payload);  // SSE delivery
  broadcastInternal(event, payload, opts); // WS delivery
};
```

And `broadcastToConnIds()`:

```ts
const broadcastToConnIds = (event, payload, connIds, opts) => {
  // NO gatewayEventBus.emit — SSE doesn't receive anything
  broadcastInternal(event, payload, opts, connIds);
};
```

**This is the root cause.** When upstream moved tool events from `broadcast()`
to `broadcastToConnIds()`, the `gatewayEventBus.emit()` call was silently
dropped. SSE listeners — which is how the Butley webchat dashboard receives
streaming events — went deaf to tools.

Non-tool events (text deltas, thinking, lifecycle) still use `broadcast()` and
work fine. Only tools broke.

### Why Upstream Doesn't Notice

Upstream's primary webchat (the OpenClaw Control UI) receives tool events via
**WebSocket agent events** (`event: "agent"` frames). The WS path was preserved
by the three targeted registries. SSE is a secondary/newer transport that
upstream may not test as thoroughly for tool events. Their multi-tenant scenario
(if any) probably doesn't exercise the SSE + tool combination.

---

## Conceptual Specification (for reimplementation)

If the codebase is completely refactored, here's what needs to be true:

### The Contract

1. **Tool events must reach both WS and SSE clients.** WS via targeted delivery
   (for security). SSE via `gatewayEventBus` (the only channel SSE listens on).

2. **WS delivery must be session-scoped.** Tool payloads contain sensitive data.
   Never broadcast globally to all WS clients. Use the three registries:
   - `toolEventRecipients` (run-scoped, clients declaring `TOOL_EVENTS` cap)
   - `sessionEventSubscribers` (operator UIs joining mid-run)
   - `sessionMessageSubscribers` (session-scoped message subscribers)

3. **SSE delivery can use the event bus safely** because the SSE handler already
   filters by `sessionKey`. A tool event for session A won't be forwarded to an
   SSE client listening to session B. Cross-session isolation is preserved.

4. **Buffer reset on tool-start is mandatory.** When a tool-start event arrives,
   `chatRunState.buffers` and `deltaLastBroadcastLen` must be cleared. The Pi
   SDK resets its internal text accumulator between tool calls — the gateway
   buffer must match, or SSE re-emits the entire conversation prefix.

### The Data Flow

```
Agent emits tool event (start/result/end)
                │
                ▼
┌─ Flush pending text delta ──────────┐
│  (tool-start only: snap UI text)    │
│  Reset text buffer for next turn    │
└─────────────┬───────────────────────┘
              ▼
┌─ WS: Targeted delivery ────────────┐
│  1. toolEventRecipients (run-scope) │
│  2. sessionEventSubscribers (ops)   │
│  3. sessionMessageSubscribers (P16) │
│  Each set filtered by runId/session │
│  Uses broadcastToConnIds()          │
└─────────────┬───────────────────────┘
              ▼
┌─ SSE: Event bus delivery ───────────┐
│  gatewayEventBus.emit("agent", ...) │
│  SSE handler filters by sessionKey  │
│  Emits tool-input-start/available   │
│  and tool-output-available to client│
└─────────────────────────────────────┘
```

### Frontend Consumption

The frontend has **dual transport with SSE priority**:

| Transport | When active | Tool handling |
|---|---|---|
| **SSE** | Always (persistent connection) | `onToolStart` / `onToolEnd` callbacks → assembler → React state |
| **WS** | Fallback when SSE disconnects | `event.stream === "tool"` → assembler → React state |

When SSE is active (`sseActiveRef.current = true`), WS agent events are
**skipped** (line ~447: `if (event.runId && sseActiveRef.current) continue`).
This prevents duplicate rendering. Media events (imageReady, audioReady) are
exceptions — they pass through WS even when SSE is active.

### Critical Invariant

**`gatewayEventBus.emit("agent", toolPayload)` must fire for every tool event,
regardless of whether any WS recipients exist.**

If this emit is missing, SSE clients get zero tool events. If it's duplicated
(e.g., inside `broadcastToConnIds`), SSE clients get 2-3x duplicates per tool
call (once per registry). The emit must happen exactly once, after all WS
delivery, outside any conditional block.

---

## Current Implementation (v3.22)

### The Fix: 1 Line + 1 Import

**`src/gateway/server-chat.ts`** — after all three `broadcastToConnIds()` calls
in the `isToolEvent` block:

```ts
// [FORK-PATCH-16] SSE tool event delivery.
gatewayEventBus.emit("agent", toolPayload);
```

Import at top of file:

```ts
import { gatewayEventBus } from "./server-broadcast.js";
```

That's it. The SSE handler (`server-sse.ts`) already knows how to process tool
events — it parses `phase`, `toolCallId`, `toolName` and emits structured SSE
events (`tool-input-start`, `tool-input-available`, `tool-output-available`).
It already filters by `sessionKey`. Nothing else needs to change.

### Also Included: Buffer Reset (pre-existing)

On `tool-start` phase, the handler clears `chatRunState.buffers` and
`deltaLastBroadcastLen` for the current run. This prevents text from prior
turns bleeding into post-tool text via SSE.

### Also Included: Session Message Subscribers (pre-existing)

Webchat clients that open after a run starts aren't in `toolEventRecipients`
(which is run-scoped). They ARE in `sessionMessageSubscribers` via
`sessions.messages.subscribe`. The handler broadcasts to those connIds too,
ensuring late-joining dashboard clients see live tools.

---

## Files Modified

| File | Ownership | What changed | Lines |
|---|---|---|---|
| `src/gateway/server-chat.ts` | Upstream + fork | Import `gatewayEventBus` + 1-line emit after targeted WS delivery + buffer reset on tool-start + sessionMessageSubscribers broadcast | ~20 |
| `src/gateway/server-sse.ts` | Upstream + fork | (No P16 changes — tool parsing is upstream. Debug log removed.) | 0 |

**Files NOT modified (by design):**
- `src/gateway/server-broadcast.ts` — `broadcastToConnIds` intentionally does
  NOT emit on eventBus (it would cause multi-fire for every targeted call)
- `src/gateway/server.impl.ts` — passes `sessionMessageSubscribers` to handler
  (wired during v3.22 rebase, no additional changes needed)

---

## Upstream Merge Guide

### If upstream changes the `isToolEvent` block in `createAgentEventHandler`:
→ Ensure `gatewayEventBus.emit("agent", toolPayload)` is present after all
   `broadcastToConnIds()` calls. Position: last statement in the `if (isToolEvent)`
   block, before the `else`.

### If upstream adds `gatewayEventBus.emit` to `broadcastToConnIds`:
→ **Remove our line.** The fix becomes unnecessary. This is the "clean upstream
   fix" — if they do it, our patch is absorbed.

### If upstream changes how SSE subscribes to events:
→ Check if SSE still uses `gatewayEventBus.on("agent", ...)`. If they switch
   to a different mechanism, the emit target must change accordingly.

### If upstream adds native SSE tool delivery:
→ Remove our line. Test that tools appear in webchat via SSE.

---

## verify-patches.sh

```bash
grep -q 'gatewayEventBus.emit.*agent.*toolPayload' "$DIST_FILE" && echo "OK" || echo "MISSING"
grep -q 'sessionMessageSubscribers' "$DIST_FILE" && echo "OK" || echo "MISSING"
```

---

## Bug History

| Version | What happened | Commit |
|---|---|---|
| v3.13 (alpha) | ✅ Worked — `broadcast("agent", toolPayload)` sent to everyone (WS + SSE) | — |
| v3.22 (upstream) | ❌ Broke — upstream moved to `broadcastToConnIds()` only → SSE went deaf | — |
| v3.22 (band-aid #1) | ⚠️ Added `gatewayEventBus.emit` inside `broadcastToConnIds()` — fired for ALL targeted calls, not just tools | superseded |
| v3.22 (band-aid #2) | ⚠️ Re-added `broadcast("agent", toolPayload)` globally — worked but duplicated WS delivery | `543ef46920` |
| v3.22 (bulletproof) | ✅ Current — targeted `gatewayEventBus.emit` after WS delivery. Zero duplication. | `676820ca3f` |

### Failed Approaches (for future reference)

**Adding `gatewayEventBus.emit` inside `broadcastToConnIds`:** Sounds clean but
causes multi-fire. `broadcastToConnIds` is called 3x in the tool block (once per
registry). SSE would get 3 copies of every tool event. Also affects non-tool
uses of `broadcastToConnIds` elsewhere in the codebase.

**Re-adding `broadcast()` for tools:** Works but duplicates WS delivery. Clients
registered in `toolEventRecipients` receive the event twice — once via targeted
delivery, once via global broadcast. Frontend handles duplicates gracefully
(idempotent assembler), but it's wasteful and architecturally wrong.

**Creating a `broadcastToolEvent()` helper:** Over-engineering for a single call
site. Adds a function with 5 injected dependencies used in 1 place. More code
to maintain across upstream rebases with zero benefit.

---

## Why This Matters for Butley

Tool streaming is a **core differentiator** for the Butley dashboard. Competing
agent platforms show a loading spinner and dump the final answer. Butley shows
the agent's thought process live — which tools it's calling, what data it's
reading, how it's reasoning. This transparency is what makes owners trust the
agent enough to let it talk to their clients unsupervised.

Without P16, the dashboard degrades to spinner + text dump. The product story
falls apart.

---

## Relationship to Other Patches

| Patch | Relationship |
|---|---|
| **P17** (Stream Delta Throttle) | Controls text delta throttle (50ms vs upstream 150ms). Independent but complementary — P17 makes text smooth, P16 makes tools visible. |
| **P31** (SSE Event Bus) | P31 added `gatewayEventBus.emit` to `broadcast()` for SSE delivery of ALL events. P16's fix is specifically for tool events that bypass `broadcast()`. |
| **P4** (Chat Mirror) | Both P4 and P16 solve delivery gaps caused by v3.22's stricter scoping. P4 = mirror text to WA, P16 = mirror tools to SSE. Similar pattern, different target. |
