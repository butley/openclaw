# Patch #15: Webchat Thinking Stream

**Scope:** Agents (`src/agents/pi-embedded-subscribe.ts`)
**Upstream issue:** #5086
**Risk:** Low — only adds WS agent events, no channel delivery impact

## Problem

`emitReasoningStream()` was gated by TWO conditions that prevented thinking events from reaching WebSocket clients:

1. `streamReasoning` init required `typeof params.onReasoningStream === "function"` — but the callback is only created when `typingMode === "thinking"` (most installs use `"instant"`)
2. Inside `emitReasoningStream()`, guard `!params.onReasoningStream` returned early even if streamReasoning was true

Result: thinking/reasoning content was NEVER streamed via WS to any client (TUI, webchat, Control UI). It only appeared after history reload.

## Fix

1. `streamReasoning: reasoningMode !== "off"` — removed callback dependency
2. `emitReasoningStream()` — `emitAgentEvent()` (WS broadcast) always fires regardless of callback. Channel typing callback gated separately with `if (params.onReasoningStream)`

## Verify

```bash
grep -q 'reasoningMode !== "off"' src/agents/pi-embedded-subscribe.ts
```
