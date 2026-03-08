# Patch Audit — Known Issues & Pending Work

> Last updated: 2026-03-07  
> Branch: `feat/sse-endpoint`

This document tracks findings from the patch quality audit. All items below were identified
after the SSE implementation landed. Items are grouped by priority.

---

## ✅ Fixed (this branch)

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

## 📋 Merge Checklist (before `feat/sse-endpoint` → `alpha`)

- [ ] Build passes (`npm run build`)
- [ ] `bash patches/verify-patches.sh .` passes all checks
- [ ] WA Outbound Mentions bug (#14) — decision: fix or disable before merge?
- [ ] SSE auth + CORS — acknowledged as pre-launch (not blocker for internal merge)
- [ ] Chat Mirror README — low priority, can be deferred

## 📋 Merge Checklist (before `alpha` → `work` — Butley provisioning)

- [ ] SSE auth implemented or explicitly deferred with threat model documented
- [ ] CORS narrowed from `*` to allowed origins
- [ ] WA Outbound Mentions fixed (affects all WA users)
- [ ] Regression test: WS broadcast still works (SSE is additive — verify no regressions)
- [ ] Docker image rebuilt with new fork
