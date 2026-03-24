# P15 — Webchat Thinking Stream

**Branch:** `feat/rebase-3.22`
**Type:** Guard split (surgical)
**Files:** `src/agents/pi-embedded-subscribe.ts`

## What It Does

Ensures thinking/reasoning events reach webchat via WS/SSE. Without this, the Butley frontend shows no reasoning.

## The Bug (v3.22)

Upstream merged two independent guards into one:
```ts
if (!state.streamReasoning || !params.onReasoningStream) return;
```

Webchat never passes `onReasoningStream` (because `typingPolicy='internal_webchat'` → callback undefined), so `emitAgentEvent` never fires.

## The Fix

Split guards — broadcast and channel callback are independent concerns:
```ts
if (!state.streamReasoning) return;           // config check
emitAgentEvent({ stream: "thinking", ... });  // ALWAYS broadcast
if (params.onReasoningStream) {               // optional channel callback
  params.onReasoningStream({ text });
}
```

## Full Trace

See `docs/FORK.md` → "Diagnostic Traces → P15" for the complete 6-step trace from `resolveRunTypingPolicy` through `createTypingSignaler` to the guard.

## Merge Resilience

**Watch closely** — if upstream changes the guard in `pi-embedded-subscribe.ts`, verify `emitAgentEvent` for thinking events is NOT gated on `onReasoningStream`.

## Verify

```bash
grep -q 'streamReasoning: true' src/agents/pi-embedded-subscribe.ts && echo "OK" || echo "MISSING"
```

## Author

Bob — thinking/reasoning invisible in Butley webchat.
