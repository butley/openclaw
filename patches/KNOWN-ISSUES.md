# Patch Audit — Known Issues & Pending Work

> Last updated: 2026-03-11  
> Branch: `alpha`

This document tracks findings from the patch quality audit. All items below were identified
after the SSE implementation landed. Items are grouped by priority.

---

## ✅ Fixed (this branch)

### [server-sse.ts] Persistent mode emitted `{ type: "start", messageId: null }` on connection open
- **Patches affected:** #18 SSE Streaming Endpoint
- **Severity:** Protocol correctness — undefined behavior per AI SDK Data Stream Protocol
- **Root cause:** On connection open, the handler always emitted `{ type: "start", messageId: runId }`.
  In persistent mode `runId` is null (connection opens before any run exists), resulting in
  `messageId: null`. The protocol doesn't define behavior for this. The frontend worked around
  it by treating `start` with `null` as a connection signal, but that conflated two distinct
  concepts: "session connected" vs "a run started".
- **Architectural context:** In Butley, the chat UI subscribes to a *session* (which may have
  WA activity), not to a specific run. The connection must be ready independently of whether
  any run is active. A WA session may be observed via the chat UI even when WhatsApp isn't
  actively streaming — the SSE stream needs to stay open and signal its own readiness cleanly.
- **Fix:**
  - Persistent mode: emit `{ type: "connected", sessionKey }` on open — signals readiness
    without implying a run started.
  - Non-persistent mode: unchanged — emits `{ type: "start", messageId: runId }` immediately
    (run is known at connection time).
  - Added `currentRunId` per-connection state. When the first delta of a new run arrives in
    persistent mode (`payload.runId !== currentRunId`), emit `{ type: "start", messageId }` then.
  - `handleRunEnd()` resets `currentRunId = null` so the next run emits a fresh `start`.
- **⚠️ Frontend change required:** `feat/chat-ui-sse` must handle the new `connected` event
  (instead of `start` with `messageId: null`) and `start` events mid-stream. The assembler
  should reset state on `start` and treat `connected` as ready-signal only.
- **Commit:** see patch audit commit


### [server-broadcast.ts] `gatewayEventBus.emit` skipped when no WS clients connected
- **Patches affected:** #18 SSE Streaming Endpoint
- **Severity:** Medium — SSE stops receiving events if WS disconnects while SSE stays open
- **Root cause:** `gatewayEventBus.emit` was inside `broadcastInternal` after an early-return
  guard `if (params.clients.size === 0) { return; }`. If no WS client was connected (e.g.
  network hiccup causes WS reconnect while SSE stream stays open), the event bus never fired
  and the SSE stream went silent.
- **Fix:** Moved `gatewayEventBus.emit` before the `clients.size === 0` guard. SSE consumers
  now receive all non-targeted broadcasts regardless of WS client count. Targeted broadcasts
  (`broadcastToConnIds`) remain WS-only and skip the event bus.
- **Commit:** see patch audit commit

### [server-sse.ts] Duplicate run-end reset block (3×)
- **Patches affected:** #18 SSE Streaming Endpoint
- **Severity:** Code quality — DRY violation, maintenance risk
- **Root cause:** The persistent-mode state reset (`activeTextId = null`, `lastTextLen = 0`,
  etc.) and non-persistent end (`sseEnd + cleanup`) were copy-pasted identically for each of
  the three terminal states: `final`, `error`, `aborted`.
- **Fix:** Extracted `handleRunEnd()` helper inside `handleSseStream`. Each terminal state now
  calls `handleRunEnd()` — single source of truth for reset/teardown logic.
- **Commit:** see patch audit commit


### [server-sse.ts] `lastTextLen = 0` on tool/reasoning start caused text duplication
- **Patches affected:** #18 SSE Streaming Endpoint
- **Severity:** High — visible text duplication in any run with tool calls
- **Root cause:** Tool start and reasoning handlers reset `lastTextLen = 0` and
  `lastReasoningLen = 0`. The gateway buffer (`chatRunState.buffers`) accumulates text across
  the entire run (never resets between tools). Each SSE delta delivers the full accumulated
  buffer, with the handler extracting the new portion via `fullText.slice(lastTextLen)`.
  Resetting `lastTextLen` to 0 made the next delta re-deliver ALL previously sent text.
- **Scenario:** Model generates 500 chars → tool call → model generates 200 more.
  Without fix: SSE re-emits all 700 chars (500 duplicated). With fix: only 200 new chars.
- **Fix:** Removed `lastTextLen = 0` and `lastReasoningLen = 0` from tool start and reasoning
  handlers. Only `handleRunEnd()` resets these counters (when the run actually ends).
- **Found by:** Opus 4.6 deep review of Sonnet-written code
- **Commit:** `b9b81a593`

### [server-sse.ts] Thinking events arrived before `start` in persistent mode — race condition
- **Patches affected:** #18 SSE Streaming Endpoint
- **Severity:** Medium — thinking content could flash and disappear in frontend
- **Root cause:** `onAgentEvent` (thinking/tool events) had no `currentRunId` detection. Only
  `onChatEvent` emitted `start` when a new run was detected. Since thinking events arrive
  before the first chat delta, the frontend received `reasoning-delta` without a preceding
  `start`. The frontend's defensive fallback created a synthetic runId — but when the real
  `start` arrived later (from the first chat delta), `resetAssembler()` cleared all
  accumulated thinking. Users would see thinking appear then vanish.
- **Fix:** Added `currentRunId` detection in `onAgentEvent` — same logic as `onChatEvent`.
  Now `start` fires before any thinking content, and the assembler resets cleanly before
  content accumulation begins.
- **Found by:** Opus 4.6 deep review of Sonnet-written code
- **Commit:** `b9b81a593`

### [server-sse.ts] Global block counters shared across concurrent SSE connections
- **Patches affected:** #18 SSE Streaming Endpoint
- **Severity:** Low (no visible bug with single-user sessions, but non-idiomatic)
- **Root cause:** `textBlockCounter` and `reasoningBlockCounter` were module-level globals.
  With 2+ concurrent SSE streams, IDs would interleave across connections (e.g., `text_1`
  from session A, `text_2` from session B). Functionally harmless today (Butley is
  single-user per session), but wrong by design.
- **Fix:** Removed module-level globals. Changed `emitTextStart`/`emitReasoningStart` to
  accept a `counter: { n: number }` param. Added `textCounter`/`reasoningCounter` as
  per-connection locals inside `handleSseStream`.
- **Commit:** see patch audit commit

### [server-chat.ts] Stale comment referencing removed `broadcastToConnIds`
- **Patches affected:** #16 Tool Events Broadcast
- **Severity:** Trivial (documentation only)
- **Root cause:** Comment said "WS clients already received the event above via broadcastToConnIds"
  but Patch #16 replaced `broadcastToConnIds` with `broadcast("agent", ...)`. The old reference
  to the removed function was left behind.
- **Fix:** Updated comment to correctly reference `broadcast("agent", ...)` and Patch #16.
- **Commit:** see patch audit commit

### [server-sse.ts] Text duplication across tool call turns — Patch #29
- **Patches affected:** #18 SSE Streaming Endpoint
- **Severity:** High UX — text before tool call appeared twice in chat UI
- **Root cause:** The provider (Claude) resets its accumulated text buffer between tool call
  turns. After a tool executes, the provider re-sends all previous text from scratch before
  adding new content. The SSE handler's `lastTextLen` reset on tool start (or the defensive
  `fullText.length < lastTextLen` guard) caused re-emission of already-sent text.
- **Fix:** Added `totalTextEmitted` counter (total chars emitted across ALL turns in a run)
  and `inTextReplay` flag. When text buffer shrinks (new turn after tool), enter replay mode.
  Skip all text until accumulated length exceeds `totalTextEmitted`, then emit only new content.
  Counter resets in `handleRunEnd()` between runs.
- **Commit:** `9bba224be`

### [server-sse.ts] SSE cron session pollution — Patch #28
- **Patches affected:** #18 SSE Streaming Endpoint
- **Severity:** Medium UX — cron runs (scribe, curator) appeared in chat UI and blocked composer
- **Root cause:** SSE `onAgentEvent` matches by agent prefix (`agent:main`). Cron sessions
  like `agent:main:cron:xyz` matched the prefix, so cron tool events streamed into the chat UI.
  Upstream control-ui uses exact `sessionKey` matching; our prefix matching needed exclusion.
- **Fix:** Filter events where `agentSessionKey.includes(":cron:")`.
- **Commit:** `246997912`

### [server-sse.ts] Diagnostic logging added
- **Patches affected:** #18 SSE Streaming Endpoint
- **Severity:** Operational improvement
- **Details:** Added `console.warn` logging for: text replay detection (with lengths), `sseWrite`
  failures (connection dead/errors), SSE connection close stats (duration, event count, runActive,
  lastTextLen). Logs go to `~/.openclaw/logs/gateway.err.log` (stderr).
- **Commit:** `9bba224be`

---

## ⚠️ Architecture Limitations

### [server-sse.ts] Mid-run join: thinking and tool calls before join point are lost
- **Patches affected:** #18 SSE Streaming Endpoint
- **Severity:** Medium UX — affects users who open chat while a run is already executing
- **How it works:**
  - Gateway only writes to session history (`session transcript`) on `lifecycle: end`
  - During an active run, intermediate data exists only in-memory and on the SSE/WS stream
  - Convex history only has completed runs — the current run isn't there yet
- **What a mid-run join gets:**
  - ✅ **Text:** full catch-up via first delta (gateway sends full accumulated buffer each time,
    so `lastTextLen = 0` on join → first event delivers everything generated so far)
  - ❌ **Thinking/reasoning:** only from join point onward — no accumulated buffer in gateway
  - ❌ **Tool calls already completed before join:** lost — not in history yet, not replayable
- **Scenario:** user opens Butley chat during a long multi-tool run (e.g. agent ran 3 tools,
  is now generating the final response). They see the text reconstruct correctly but miss the
  tool chain that already executed. Full picture only available after the run completes.
- **Gateway crash mid-run:** entire run lost — history shows the user message with no response.
- **No fix planned short-term.** Proper solution would require either:
  - Streaming intermediate steps to Convex as they happen (complex, high write volume)
  - Gateway-side run state snapshot on SSE connect (replay buffer for current run)
- **Workaround:** for Butley's typical use case (user initiates from the chat UI), they're
  always connected from run start. Mid-run join only affects cases where the user navigates
  away and back, or opens a session someone else started (e.g. WA session observed via chat).

---

## ✅ Fixed (2026-03-09)

### [server-sse.ts] SSE sessionKey matching — prefix vs exact (RESOLVED: exact wins)
- **History:** Went through 3 iterations:
  1. `9eeec977a` (Mar 8) — `onAgentEvent` exact→prefix for tools
  2. `bb6cb8b6f` (Mar 10) — `onChatEvent` exact→prefix for text
  3. `3c0b33f3b` (Mar 10) — **REVERTED BOTH back to exact match**
- **Why prefix failed:** Prefix match (`agent:main:*`) leaked events across channels.
  Slack runs streamed text into WA chat UI. Cron tool events hijacked active sessions.
- **Why exact works:** Butley frontend always uses the specific session key from the thread
  list. Unlike upstream's control-ui (which may use a broad agent key), our chat UI
  subscribes to one session at a time. Exact match = correct isolation.
- **Root cause of original "SSE broken":** Anthropic API rate limits caused all `chat.send`
  runs to fail — NOT a sessionKey matching issue. The prefix match fix happened to coincide
  with the rate limit clearing, creating a false correlation.
- **Also in `3c0b33f3b`:** Simplified text dedup (removed `totalTextEmitted`/`inTextReplay`
  — 4 approaches all failed, per CHAT-UI-REFACTOR.md). Correct fix: per-block `lastTextLen`
  with reset on tool start.

## ✅ Fixed (2026-03-08)

### [server-sse.ts] Cross-channel tool events not reaching chat UI SSE — FIXED
- **Commit:** `9eeec977a` (fork), `c7f09f6` (frontend)
- **Root cause:** `onAgentEvent` in SSE handler filtered by exact `sessionKey` match.
  WA-initiated runs have `sessionKey=agent:main:whatsapp:direct:+N` while chat UI
  subscribes with `sessionKey=agent:main:main`. Tool events were silently dropped.
- **Fix:** Match by agent prefix (`agent:main:`) instead of exact sessionKey.
  All events from the same agent reach the SSE stream regardless of originating channel.
- **Frontend:** SSE handles text, thinking, AND tools. WS agent events are fully skipped
  when SSE is active (`if (sseActiveRef.current) continue`). WS tools still work as
  fallback when SSE is not connected.

---

## 🐛 Open Bugs

### [wa-outbound-mentions] Any `@` in message text becomes a WA mention — including in DMs
- **Patch:** #14 WA Outbound Mentions
- **Severity:** Medium — real UX impact in production
- **Root cause:** `processOutboundMentions` injects all `@` occurrences as Baileys `mentions`
  entries without validating that the target is a real JID. In DMs, `@` in text (e.g.
  `@lucasmachado.ag`) resolves to a contact name highlight in green.
- **Reproducer:** Send any message containing `@somename` from a DM session.
- **Fix needed:** Validate that `@` targets are real JIDs from the session contact list
  before injecting into `mentions` field. Only inject if pattern matches a known JID.
- **Convex task:** `m57b5fp3xhh956v5skbj9yjfts828q2y`
- **Status:** Open — not yet fixed

---

## 🐛 Open Bugs — Health Monitor / WhatsApp Cron Delivery

### Health-monitor `stale-socket` restarts break WA outbound via `message` tool
- **Upstream issues:** [#30177](https://github.com/openclaw/openclaw/issues/30177), [#36017](https://github.com/openclaw/openclaw/issues/36017), [#1260](https://github.com/openclaw/openclaw/issues/1260)
- **Upstream PR (partial fix):** [#32367](https://github.com/openclaw/openclaw/pull/32367) (v2026.3.2 — added grace window, doesn't fully resolve)
- **Severity:** High — all cron/subagent WA sends fail after prolonged inactivity
- **Introduced:** v2026.3.3 merge (commit `38a929efb`, 2026-03-03). Health-monitor was generalized from Slack to all channels.
- **Last working:** 2026-03-07 (intermittent Mar 3-7, fully broken Mar 8-10)
- **Symptoms:**
  - Crons (Morning Briefing, Daily Digest) fail at 08:00/08:30 BRT with `No active WhatsApp Web listener`
  - Auto-replies (inbound → response) work fine — they use the listener directly from scope
  - `message` tool (WS → `requireActiveWebListener()`) fails — listener Map returns null
  - Health-monitor logs show `stale-socket` restart every ~35 min during overnight inactivity
- **Root cause:** `lastEventAt` in `src/web/auto-reply/monitor.ts` is only updated on:
  1. Inbound messages (line 211)
  2. Connection events (line 220)
  3. Disconnect/shutdown (lines 377, 471)
  
  It does NOT update on: outbound sends, Baileys keepalive pings, or any internal activity.
  After 30 min without inbound messages (`DEFAULT_STALE_EVENT_THRESHOLD_MS`), the monitor
  marks the WA socket as "stale" and restarts it — even though Baileys is connected and
  healthy. The restart cycle (`stopChannel` → `setActiveWebListener(null)` → `startChannel`)
  corrupts the listener Map state over repeated cycles.
- **Evidence:**
  - Mar 7 08:00 (success): 10 min after restart, listener still valid
  - Mar 8 08:00 (failure): 5 min after restart, listener null despite "Listening" log
  - Mar 8 10:01: `message` tool fails but inbound at 10:02 works — listener exists but Map is stale
  - Test Mar 11 02:38: cron succeeds when WA had recent activity (conversation ongoing)
- **Proposed fix (fork patch):** Update `lastEventAt` on outbound sends in monitor.ts,
  or hook into Baileys connection keepalive events. This prevents false stale-socket detection
  while preserving the monitor for actual dead connections. One-liner change in
  `src/web/auto-reply/monitor.ts`.
- **Alternative (quick):** `gateway.channelHealthCheckMinutes: 0` — disables monitor entirely
  (global, affects all channels). Baileys has its own reconnect. Tradeoff: no safety net if
  WA truly dies silently.
- **Status:** Root cause identified, fix not yet applied.

---

## ⚠️ Pre-Launch Requirements (security)

### [server-sse.ts] SSE endpoint has no authentication
- **Patch:** #18 SSE Streaming Endpoint
- **Severity:** Medium pre-launch, Low currently (gateway behind Tailscale/Cloudflare)
- **Detail:** `handleSseStream` accepts any request with a valid `sessionKey` query param.
  No token/auth header is checked. Anyone who knows a sessionKey can subscribe to that
  session's event stream.
- **Mitigation now:** Gateway is only reachable via Tailscale (authenticated network).
- **Fix needed before public launch:** Validate a gateway token or session-bound auth header.
  Could reuse the existing `Authorization: Bearer <gatewayToken>` pattern from the WS
  handshake, or derive a short-lived SSE token on `chat.send`.

### [server-sse.ts] CORS wildcard (`Access-Control-Allow-Origin: "*"`)
- **Patch:** #18 SSE Streaming Endpoint
- **Severity:** Low currently, Medium pre-launch
- **Detail:** SSE endpoint accepts requests from any origin. For production, this should be
  limited to the same allowed origins as `gateway.controlUi.allowedOrigins`.
- **Fix needed before public launch:** Replace `"*"` with the configured allowed origins list.

---

## 🔍 Code Quality Notes (non-blocking)

### [chat-mirror/README.md] References `.js` files (pre-TypeScript migration)
- **Patch:** #4 Chat Mirror
- **Severity:** Documentation only
- **Detail:** The README was written in Feb 2026 before the codebase was fully TypeScript.
  It references `server-methods/chat.js`, `server-chat.js`, etc. The actual patch applies to
  `.ts` files. The logic is correct but the README paths are outdated.
- **Fix:** Update README paths to `.ts` equivalents (low priority).

### [chat-mirror] Uses `console.log`/`console.warn` instead of gateway logger
- **Patch:** #4 Chat Mirror
- **Severity:** Low
- **Detail:** Mirror log lines use `console.log(\`[mirror] sent to ...\`)` and
  `console.warn(\`[mirror] failed: ...\`)` instead of the structured gateway logger.
  This means mirror logs won't be captured by `openclaw logs --pretty` filters.
- **Fix:** Replace with `import { logger } from "../infra/logger.js"` and use
  `logger.info`/`logger.warn` with structured metadata.

---

## ✅ Merge Checklist (`feat/sse-endpoint` → `alpha`) — DONE 2026-03-08

- [x] Build passes (`npm run build`)
- [x] `bash patches/verify-patches.sh .` — 16/16 passed
- [x] Merge commit: `18d4ab30a`
- [x] Post-merge fixes: counters, event bus, handleRunEnd, connected/start, text dupe, thinking race

## 📋 Merge Checklist (before `alpha` → `work` — Butley provisioning)

- [ ] SSE auth implemented or explicitly deferred with threat model documented
- [ ] CORS narrowed from `*` to allowed origins
- [ ] WA Outbound Mentions fixed (affects all WA users)
- [ ] Regression test: WS broadcast still works (SSE is additive — verify no regressions)
- [ ] Docker image rebuilt with new fork

---

## Stuck Run / Lane Blocking (Confirmed 2026-03-12)

**Symptom:** Frontend pulsing forever, messages queue indefinitely, `lane wait exceeded` in logs with `queueAhead=0` but no `lane task done/error` ever fires.

**Evidence (2026-03-12):**
- `waitedMs=76116` (76s) without any lane task completion
- SSE closes with `runActive=true` — run never emits lifecycle `end`/`error`
- Only gateway restart clears the blocked lane (`maxConcurrent=1`)

**Root cause:** Unknown. The run's Promise never resolves or rejects. Possibly related to:
- Compaction/memory flush interfering with active runs
- LLM failover retry loop swallowing the final error without propagating to the Promise
- The `abortTimer` in `pi-embedded-runner/run/attempt.ts` (line 1314) fires `abortRun(true)` but the subscription may not propagate the abort cleanly to the Promise

**What it's NOT:**
- NOT `removeChatRun` bug (add/remove both use runId as key — consistent)
- NOT the Anthropic SDK timeout (default 10min, runs die in <60s)
- NOT agent timeout (default 600s, not configured in our config)

**Upstream refs:** PR #16125 (stuck run detection — `stuckDetection` watchdog config). Not yet merged upstream.

**Workaround:** Gateway restart (`openclaw gateway restart`) clears the run registry and unblocks lanes.

**Related symptoms observed same day:**
- LLM timeouts (`FailoverError: LLM request timed out`) — 8 retries over 26s, all fail
- SSE `webchat:main` dying after exactly 30.0s with 0 events (separate issue — webchat SSE not receiving group session events)
- WA message coalescence: 2 `final` states at same ms → only last one delivered
