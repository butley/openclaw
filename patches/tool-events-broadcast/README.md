# P16 — Tool Events Broadcast (Session-Scoped)

**Branch:** `feat/rebase-3.22`
**Type:** Scoped → session-only (hardened 2026-03-24)
**Files:** `src/gateway/server-chat.ts`, `src/gateway/server.impl.ts`

## What It Does

Broadcasts tool events (start/output/end) to webchat clients watching a session. Originally sent to ALL connected clients (cross-session leak). Now session-scoped.

## How It Works

Uses existing `sessionMessageSubscribers` registry (`Map<sessionKey, Set<connId>>` managed by `sessions.ts`). Only clients subscribed via `sessions.messages.subscribe` receive events.

```ts
const msgSubscribers = sessionMessageSubscribers.get(sessionKey);
if (msgSubscribers.size > 0) {
  _broadcastToConnIds("agent", toolPayload, msgSubscribers, { dropIfSlow: true });
}
```

**Key detail:** `.get()` returns empty Set (not undefined) — safe for `.size` check.

Also includes buffer reset on tool-start (deletes `chatRunState.buffers` to prevent text duplication).

## History

Original: `broadcast("agent", toolPayload)` → ALL clients. Security issue for multi-tenant Butley.
Hardened: session-scoped via `sessionMessageSubscribers`.

## Merge Resilience

**Watch closely** — if upstream changes `SessionMessageSubscriberRegistry` API or `_broadcastToConnIds` signature, update accordingly. Wiring: 1 line in `server.impl.ts` passes registry to handler.

## Verify

```bash
grep -q 'sessionMessageSubscribers' src/gateway/server-chat.ts && echo "OK" || echo "MISSING"
```

## Author

Bob — tool events for Butley dashboard (original), session-scoped security fix (hardening).
