# Patch Audit — Known Issues & Pending Work

> Last updated: 2026-03-24
> Branch: `feat/rebase-3.22` (base: upstream v2026.3.22)

---

## ✅ Fixed in v3.22 Rebase

### P15 — Reasoning stream dead code
- **Commit:** `c53690954c`
- **Was:** Upstream merged two guards into `if (!state.streamReasoning || !params.onReasoningStream) return;`. Webchat never passes `onReasoningStream` (because `typingPolicy='internal_webchat'` → callback undefined), so `emitAgentEvent` never fires for reasoning.
- **Fix:** Split guards. `emitAgentEvent` depends only on `state.streamReasoning`. Channel callback is optional, called separately.

### P16 — Cross-session tool event leak
- **Commit:** `046b03c80b`
- **Was:** `broadcast("agent", toolPayload)` sent tool events to ALL WS/SSE clients. Session A could see Session B's tool calls.
- **Fix:** Uses `sessionMessageSubscribers.get(sessionKey)` for session-scoped delivery. Same UX, zero leak.

### P4 — Chat mirror code duplication
- **Commit:** `f576eefa8d`
- **Was:** 20-line mirror block copy-pasted in both success and error paths of `server-chat.ts`.
- **Fix:** Extracted to `src/gateway/chat-mirror.ts` — `maybeMirrorToChannel()`.

### P8 — Status card formatting inline
- **Commit:** `f576eefa8d`
- **Was:** 78 lines of formatting (padLabel, Unicode, code blocks) inline in `status.ts`.
- **Fix:** Extracted to `src/auto-reply/status-card-format.ts`.

### P17 — Magic number throttle
- **Commit:** `f576eefa8d`
- **Was:** Hardcoded `50` in `if (now - last < 50)`.
- **Fix:** Named constant `STREAM_DELTA_THROTTLE_MS` at top of file.

---

## ✅ Fixed in alpha (carried forward to v3.22)

### SSE endpoint — numerous bugs
All SSE bugs from `KNOWN-ISSUES.md` (alpha era) were fixed before the rebase:
- Persistent mode `start` with null messageId → emits `connected` event instead
- EventBus skipped when no WS clients → moved emit before guard
- Duplicate run-end reset → extracted `handleRunEnd()`
- `lastTextLen = 0` on tool start → removed (only reset on run end)
- Thinking before `start` race → added `currentRunId` detection in `onAgentEvent`
- Global block counters → per-connection locals
- Text duplication across tool turns → replay detection
- Cron session pollution → now handled by P16 session scoping

---

## ⚠️ Architecture Limitations

### Mid-run join: thinking and tools before join point are lost
- **Affects:** P18 SSE Streaming
- **Severity:** Medium UX — users who open chat during an active run
- **Detail:** Gateway only writes to history on `lifecycle: end`. During a run, intermediate thinking/tool data exists only in-memory. Text catches up (full buffer on first delta), but thinking and completed tool calls before the join point are lost.
- **No fix planned.** Proper solution requires streaming intermediate steps to Convex or gateway-side run state snapshot.

---

## 🐛 Open Bugs

### WA outbound mentions — false positives in DMs
- **Patch:** P14
- **Severity:** Medium UX
- **Detail:** `processOutboundMentions` injects all `@` occurrences as Baileys `mentions` without validating they're real JIDs. In DMs, `@somename` creates unwanted green highlights.
- **Fix needed:** Validate against session contact list before injecting.

### Health-monitor stale-socket restarts break cron WA sends
- **Upstream issues:** #30177, #36017, #1260
- **Severity:** High — all cron/subagent WA sends fail after overnight inactivity
- **Root cause:** `lastEventAt` not updated on outbound sends or keepalive pings. After 30 min without inbound messages, monitor restarts WA socket, corrupting listener Map state.
- **Fix needed:** Update `lastEventAt` on outbound sends, or hook Baileys keepalive.
- **Workaround:** `gateway.channelHealthCheckMinutes: 0` (disables monitor).

### Stuck run / lane blocking
- **Severity:** High — run Promise never resolves, blocks lane permanently
- **Root cause:** Unknown. Possibly compaction interference, failover retry loop, or abort propagation bug.
- **Workaround:** Gateway restart clears run registry.
- **Upstream ref:** PR #16125 (stuck detection watchdog — not yet merged).

---

## ⚠️ Pre-Launch Security Requirements

### SSE endpoint has no authentication
- **Patch:** P18
- **Detail:** `handleSseStream` accepts any request with a valid `sessionKey` param. No token/auth.
- **Mitigation now:** Gateway behind Tailscale.
- **Fix needed:** Validate gateway token or session-bound auth header.

### SSE CORS wildcard
- **Patch:** P18
- **Detail:** `Access-Control-Allow-Origin: "*"` — should use `gateway.controlUi.allowedOrigins`.

---

## 📋 Pre-Launch Checklist

- [ ] SSE auth implemented or explicitly deferred with threat model
- [ ] CORS narrowed from `*` to allowed origins
- [ ] WA outbound mentions fixed (P14 false positives)
- [ ] Regression test: full streaming chain (text + tools + thinking + WA delivery)
- [ ] Docker image rebuilt with rebase branch
