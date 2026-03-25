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

## SSE Formatting Strip

Upstream's `emitAgentEvent` wraps reasoning text with a `Reasoning:\n` prefix and
`_italic_` markdown. This formatting is meant for channel delivery (WhatsApp/Telegram)
but leaks into the SSE stream, which the webchat frontend doesn't expect — it renders
its own reasoning UI and the prefix/wrapping shows as literal text.

**Fix:** `server-sse.ts` strips the formatting at output time (consumer-side), before
emitting `reasoning_delta` SSE events:

```ts
const stripReasoningFormat = (s: string): string =>
  s.replace(/^Reasoning:\n/i, "").replace(/^_/, "").replace(/_$/, "");
```

This is intentionally done at the SSE consumer (not the producer) because:
- The formatting is correct for other consumers (WA, Telegram)
- Changing the producer (`pi-embedded-subscribe.ts`) would be invasive and affect all channels
- SSE is the only path that needs raw text — it's the right place to strip

## Merge Resilience

**Watch closely** — if upstream changes the guard in `pi-embedded-subscribe.ts`, verify `emitAgentEvent` for thinking events is NOT gated on `onReasoningStream`.

## Verify

```bash
grep -q 'streamReasoning: true' src/agents/pi-embedded-subscribe.ts && echo "OK" || echo "MISSING"
```

## Author

Bob — thinking/reasoning invisible in Butley webchat.
