# Fork Next Steps — Post v3.22 Rebase

**Branch:** `feat/rebase-3.22`
**Last commit:** `c53690954c` (P15 reasoning guard fix)
**Status:** Waves 1-6 complete + P15 fix. Wave 7 (build+test) awaiting approval.

---

## Wave 7 — Build & Test (BLOCKED: needs Luke's approval)

1. Build `feat/rebase-3.22` in **separate directory** (never in live gateway repo)
2. Run test suite
3. Manual smoke test: webchat → WA → tool streaming → thinking stream → WA inbound→response
4. `openclaw doctor --fix`
5. Swap live gateway from `alpha` to `feat/rebase-3.22`
6. Verify tailscale funnel

---

## Patch Health — Fixes After Wave 7

### Priority 1: P15 — Reasoning Stream ✅ DONE

**Problem:** Upstream v3.22 merged two independent guards into one line:
```ts
if (!state.streamReasoning || !params.onReasoningStream) return;
```
This kills `emitAgentEvent` (WS/SSE broadcast) when no channel callback is passed.
Webchat always hits this because `typingPolicy='internal_webchat'` → `onReasoningStream=undefined`.

**Fix applied:** Split guards back (commit `c53690954c`). `emitAgentEvent` depends only on
`streamReasoning`. `onReasoningStream` callback is optional and called separately.
1 file changed, surgical, proven architecture from alpha.

**Merge resilience:** ⭐⭐⭐⭐ — if upstream changes the guard again, conflict is visible
and easy to resolve (it's a clearly commented block).

---

### Priority 2: P4 — Chat Mirror (dedup ~50 duplicate lines)

**Problem:** WA mirror code is copy-pasted in both "done" and "error" branches of
`server-chat.ts` event handler. Any upstream change to that handler = double conflict.

**Current risk:** Medium. Upstream touches this file every 2-3 releases.

**Proposed fix:** Extract `maybeMirrorToChannel(params)` function. Called once after
reply resolution, covers both success and error paths.

**Files:** `src/server-chat.ts` (extract function), no new files needed.

**Merge resilience:** ⭐⭐⭐⭐⭐ — extracted function is our code, upstream changes
to the handler don't touch it.

**Effort:** ~30 min (Claude Code, surgical prompt).

---

### Priority 3: P23 — Control UI Routing

**Problem:** Butley dashboard (`openclaw-control-ui`, mode `"ui"`) gets treated as webchat
because `isWebchatClient()` was hacked to include control-ui. This conflates two different
client types.

**Proposed fix (frontend side):** Dashboard should send `client.mode: "webchat"` in its
WebSocket handshake — because functionally it IS a webchat client that happens to also
have admin UI. Then `isWebchatClient()` stays clean.

**Alternative (fork side):** Add `isInternalClient()` helper that covers webchat + control-ui
+ CLI. Use for routing decisions. Keep `isWebchatClient()` pure.

**Recommendation:** Frontend fix is cleaner but requires Butley frontend deploy. Fork-side
alternative is safer for now, can migrate later.

**Merge resilience:**
- Frontend fix: ⭐⭐⭐⭐⭐ (zero fork code)
- Fork helper: ⭐⭐⭐⭐ (isolated function, low conflict surface)

**Effort:** ~1hr (includes testing both paths).

---

## Patches That Are Fine (No Action Needed)

These are isolated, well-scoped, and survive merges cleanly:

| Patch | What | Why it's solid |
|-------|------|----------------|
| P2 | Brazil JID resolver | Own file, no upstream deps |
| P5 | Config defaults | Additive only |
| P7 | Session metadata | Own fields, no conflicts |
| P9 | WA formatting | Isolated formatter |
| P10 | Bundled plugin metadata | Additive config |
| P11 | Contact name resolver | Own file |
| P13 | Verbose light mode | Additive flag |
| P14 | WA contact names | Uses P11, isolated |
| P18 | Plugin SDK exports | Additive |
| P25 | Gateway client names | Constants file |
| P29 | Sender metadata | Additive fields |
| P30 | Chat history | Own helper |
| P31 | P32 | Config/env additions |

---

## Previously Fragile — Now Hardened ✅

All 4 formerly-fragile patches resolved in commit `f576eefa8d`:

| Patch | Was | Fix | Merge Resilience |
|-------|-----|-----|-----------------|
| P8 (status card) | 78 lines inline in `status.ts` | Extracted to `status-card-format.ts` | ⭐⭐⭐⭐⭐ — own file |
| P4 (chat mirror) | 40 lines copy-pasted 2x in `server-chat.ts` | Extracted to `chat-mirror.ts` | ⭐⭐⭐⭐⭐ — own file |
| P17 (stream throttle) | Magic number `50` inline | Named constant `STREAM_DELTA_THROTTLE_MS` | ⭐⭐⭐⭐ — visible in conflicts |
| P16 (tool broadcast) | 3 lines in event handler | Improved comments (code was already minimal) | ⭐⭐⭐⭐ — clear intent |
| P26 (thinkingDefault) | Re-evaluated: NOT fragile | Additive early return wrapping upstream code | ⭐⭐⭐⭐⭐ — never conflicts |

---

## Pending Decisions

- **P21 (audio attachments):** Upstream removed `ChatAudioAttachment` type. Awaiting
  Guilherme's input via WhatsApp group. May need complete reimplementation or drop.
- **P24 (silent reply filter):** No evidence of the original bug. Skipped. Revisit if
  silent reply issues appear.

---

## Rules for Future Merges

1. **Never build in live gateway repo** (AGENTS.md rule, learned the hard way)
2. **Sacred files** (always restore from our branch, never merge): `server-chat.ts`,
   `server-methods/chat.ts`, `server-broadcast.ts`, `server-sse.ts`
3. Use `--no-verify` for commits (fork has ~100+ TS errors in untracked upstream files)
4. Sub-agent prompts must be ultra-surgical with "DO NOT remove existing code"
5. Tagged releases only — never blind-merge unreleased HEAD
