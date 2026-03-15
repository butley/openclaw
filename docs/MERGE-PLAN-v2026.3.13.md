# Fork Merge Plan: v2026.3.3 → v2026.3.13-1

**Created:** 2026-03-15
**Author:** Bob
**Status:** DRAFT — Awaiting Luke's review

---

## Branch State

### What "v2026.3.3" actually means

Our fork calls it "v2026.3.3" but upstream **never tagged a v2026.3.3 release**. They jumped from v2026.3.2 → v2026.3.7. What happened: we merged 103 commits from `upstream/main` after v2026.3.2, and the CHANGELOG at that point already had a "## 2026.3.3" section. Those 103 commits were later absorbed into upstream's v2026.3.7 release. So our `alpha` has ~95% of what became v2026.3.7, minus the last ~690 commits before the tag.

### Branch hierarchy

| Branch | Content | Merge base with upstream |
|--------|---------|--------------------------|
| **alpha** | v2026.3.2 + 103 pre-3.3 commits + all 30 fork patches | upstream `d5a7a3282` |
| **work** | alpha + 13 extra commits (see below) | same merge base |

### The 13 commits `work` has over `alpha`

| # | Author | Commit | What | Keep? |
|---|--------|--------|------|-------|
| 1 | Guilherme Ramos | `9e1137af` | `feat(system-prompt): replace hardcoded identity with butley-system-prompt.md` (fork PR #4) | ✅ YES |
| 2 | Lucas Machado | `9a395252` | Merge alpha into work (SSE + patches for frontend chat-v2) | N/A (merge commit) |
| 3 | Lucas Machado | `456f0911` | `fix: suppress SSE finalization on retryable rate-limit errors` | ✅ YES |
| 4 | Lucas Machado | `80833c1b` | Patch #33 — memory flush context priority | ❌ REVERTED |
| 5 | Lucas Machado | `c41339bf` | docs: register patch 33 | ❌ REVERTED |
| 6 | Lucas Machado | `b4652339` | Patch #34 — `previousSessionId` chain across session resets | ✅ YES |
| 7 | Lucas Machado | `58184f81` | docs: register patch 34 | ✅ YES |
| 8 | Lucas Machado | `d8745746` | Patch #35 v1 — contextTokens override | ❌ REVERTED |
| 9 | Lucas Machado | `87fca5ec` | Patch #35 v2 — context1m per-model | ❌ REVERTED |
| 10 | Lucas Machado | `8abd6c05` | Patch #35 v3 — all callsites | ❌ REVERTED |
| 11 | Lucas Machado | `0b32f54f` | docs: update patch 35 | ❌ REVERTED |
| 12 | Lucas Machado | `974921827` | revert: remove patches #33 + #35 | ❌ (the revert itself) |
| 13 | Lucas Machado | `dc84e380` | docs: mark #33 + #35 as REVERTED | ❌ (cleanup) |

**All commits authored as "Lucas Machado" were made by Bob (Co-authored-by: Bob) per our commit convention.**

### Plan

1. **Merge into `alpha`** (cleanest base — no dead #33/#35 code)
2. After merge succeeds: **cherry-pick the 3 valid `work` commits** (#1 Guilherme's system-prompt, #3 SSE rate-limit fix, #6-7 patch #34 session chain)
3. Then fast-forward `work` to match

---

## Overview

| Item | Value |
|------|-------|
| **Target** | v2026.3.13-1 |
| **Upstream commits to merge** | ~2,233 (from merge-base to target) |
| **Versions spanned** | rest of 3.7, 3.8, 3.11, 3.12, 3.13-1 |
| **Conflicted files** | 15 |
| **Active fork patches** | 30 |
| **Patches touching conflicted files** | 17 patches across 9 files |

---

## Breaking Changes Per Version

### v2026.3.1 (already merged)
- Node exec approval requires `systemRunPlan` → **N/A** (we don't use node exec approvals)
- Node `system.run` pins canonical paths → **N/A** (we don't use node allowlists)

### v2026.3.2 (already merged)
- `tools.profile` defaults to `messaging` → **N/A** (we set explicit profile)
- ACP dispatch defaults enabled → **N/A** (we don't use ACP)
- Plugin SDK removed `api.registerHttpHandler` → **LOW** (verify butley-api uses `registerHttpRoute`)
- Zalouser CLI removal → **N/A**

### v2026.3.7 (NEW — must address)
- **`gateway.auth.mode` required when both token + password configured** → ⚠️ CHECK our `openclaw.json`. If we only have token (likely), no action needed. If both, must set `mode: "token"` before upgrade.

### v2026.3.8
- No breaking changes listed.

### v2026.3.11 (NEW — must address)
- **Cron/doctor migration:** Legacy cron storage format changed. `openclaw doctor --fix` migrates automatically. Isolated cron delivery tightened — cron jobs can no longer notify through ad hoc agent sends or fallback main-session summaries. → ⚠️ **Must run `openclaw doctor --fix` post-merge.** Our cron jobs (Scribe, Curator, Architect, Git Auto-Commit, Daily Digest) need verification.

### v2026.3.12
- No new breaking changes (same ones from 3.7 repeated in changelog).
- **Security fixes:** Multiple GHSA patches — device pairing bootstrap tokens, exec approval hardening, webhook auth tightening. Good to have.
- **Dashboard v2** — major UI refresh.
- **Fast mode** for OpenAI + Anthropic.

### v2026.3.13-1
- No breaking changes listed.
- **Browser MCP attach mode** for Chrome DevTools.
- **Session reset preserves routing** (`lastAccountId`, `lastThreadId`).
- Pi agent deps bumped to 0.58.0.

---

## Upstream Changelog Highlights (By Area We Care About)

### Gateway/Chat (our sacred area)
- **v2026.3.7:** `broadcast` and `broadcastToConnIds` refactored as function params. Text normalization shared. Streamed prefixes preserved across tool boundaries. `stopReason` threaded through final events. Tool-boundary text retention in chat buffers.
- **v2026.3.12:** Dashboard v2 chat infrastructure. Fast mode toggle. Route inheritance hardened extensively (5+ commits on routing alone). `chat.inject` creates transcript files.
- **v2026.3.13:** Gateway RPC timeout + stale promise cleanup.

### WhatsApp (our delivery pipeline)
- **v2026.3.3:** `fromMe` context propagation. MIME normalization for voice notes. Self-message `(self)` annotation.
- **v2026.3.7:** Self-chat response prefix fix (stops forcing `[openclaw]` prefix).
- **v2026.3.12:** BlueBubbles/iMessage self-chat echo dedupe improvements.

### Routing/Sessions (affects our internal routing patch #23)
- **v2026.3.7:** Internal client routing continuity — prevents webchat/TUI inheriting stale external routes. Multiple route-hardening commits.
- **v2026.3.12:** Main-session routing keeps TUI on internal surface. Session reset preserves routing metadata.
- **v2026.3.13:** `lastAccountId`/`lastThreadId` preserved across resets.

### Memory
- **v2026.3.11:** Multimodal image/audio indexing for `extraPaths`. Gemini embedding support. Post-compaction session reindexing.
- **v2026.3.7:** Hybrid search BM25 scoring fix. QMD search result decoding improvements.

### Compaction
- **v2026.3.7:** `postCompactionSections` configurable. Context engine plugin interface.
- **v2026.3.11:** Compaction bounded retry. Embedded runner drains during SIGUSR1. Context-engine compaction hooks.
- **v2026.3.12:** Post-compaction `cache-ttl` marker skip. Safeguard persona continuity.
- **v2026.3.13:** Token sanity checks improved. Language continuity configurable.

### Cron
- **v2026.3.7:** File permission hardening (0600). Restart catch-up semantics refined. Announce delivery robustness.
- **v2026.3.8:** Restart catch-up staggering. Owner-only tools in cron runs.
- **v2026.3.11:** Doctor migration for legacy cron storage. Delivery tightened.
- **v2026.3.12:** Proactive delivery dedupe. Doctor fixes for false legacy warnings.
- **v2026.3.13:** Nested cron deadlock fix for isolated sessions.

### Security (significant batch in v2026.3.12)
- 15+ GHSA patches in v2026.3.12 alone
- Device pairing now uses short-lived bootstrap tokens
- Plugin workspace auto-load disabled
- Exec approval hardening (Unicode, shell tricks)
- WebSocket preauth hardening

### New Features We Might Want
- **Context Engine plugin** (v2026.3.7) — could replace custom compaction
- **`openclaw backup create/verify`** (v2026.3.8) — local state archives
- **Fast mode** (v2026.3.12) — `/fast` toggle for OpenAI + Anthropic
- **Dashboard v2** (v2026.3.12) — major UI refresh
- **`sessions_yield`** (v2026.3.12) — orchestrator can end turn immediately
- **Browser MCP attach** (v2026.3.13) — Chrome DevTools existing-session mode

---

## Conflict Map

### 🔴 SACRED FILES (highest risk — broke last time)

#### 1. `src/gateway/server-chat.ts`
**Our patches:** #4 (Chat Mirror), #16 (Tool Events Broadcast), #17 (Streaming Throttle)
**Upstream:** 6 new commits

| Upstream Commit | What Changed | Risk to Us |
|----------------|--------------|-----------|
| `a9ec75fe` | Flush throttled delta before `emitChatFinal` | ⚠️ HIGH — last time we replaced our flush with this |
| `d326861e` | Preserve streamed prefixes across tool boundaries | MEDIUM — adds to streaming logic |
| `777af476` | Respect source channel for agent event surfacing | LOW — additive |
| `43b36bfe` | Flush chat delta before tool-start events | ⚠️ HIGH — same area as our broadcast |
| `42f9737e` | Share gateway chat text normalization | MEDIUM — refactor |
| `0b3bbfec` | Thread `stopReason` through final event to ACP | LOW — additive |

**⚠️ WHAT BROKE LAST TIME:**
- Replacing our inline flush + SSE broadcast with upstream's `flushBufferedChatDeltaIfNeeded` killed tool streaming
- Our patches add SSE broadcasting alongside WS — upstream only does WS

**Strategy:**
1. KEEP all our patch code (mirror, broadcast, throttle, SSE emission)
2. Adopt upstream's new function signature for `broadcast`/`broadcastToConnIds`
3. Add upstream's NEW features (stopReason, text normalization) AROUND our patches
4. Where upstream and our code do the same thing (flush before final): keep ours, skip upstream's duplicate

---

#### 2. `src/gateway/server-methods/chat.ts`
**Our patches:** #22 (Media Pipeline), #23 (Internal Routing), #24 (Silent Reply Filter), #26 (ThinkingDefault), #29 (Sender Meta), #30 (Group Chat History)
**Upstream:** 16 new commits

| Upstream Commit | What Changed | Risk to Us |
|----------------|--------------|-----------|
| `7f2708a8` | Unify session delivery invariants for duplicate suppression | ⚠️ HIGH — touches routing |
| `8a7d1aa9` | Preserve route inheritance for legacy channel session keys | ⚠️ HIGH — touches routing |
| `b4e4e25e` | Narrow legacy route inheritance for custom session keys | ⚠️ HIGH — touches routing |
| `c4dab17c` | Prevent internal route leakage in chat.send | ⚠️ HIGH — touches our #23 area |
| `6c39616e` | Fix Control UI duplicate iMessage replies | MEDIUM — routing |
| `a939a156` | Coerce chat deliverable route boolean | LOW |
| `563a125c` | Stop shared-main chat.send inheriting stale external routes | ⚠️ HIGH — direct conflict with #23 |
| `b4bac484` | Stop webchat route inheritance on channel sessions | MEDIUM |
| `5acf6cae` | Fast mode toggle for OpenAI models | LOW — additive |
| `5c73ed62` | Create transcript file on chat.inject when missing | LOW — additive |
| `c5ea6134` + `5a659b0b` + `6b87489890` | Dashboard v2 chat infrastructure (+ revert + re-land) | MEDIUM |
| `e3df9436` | ACP ingress provenance receipts | LOW — additive |
| `d5bffcde` | Add fast mode toggle | LOW — additive |

**⚠️ WHAT BROKE LAST TIME:**
- Upstream's `resolveChatSendOriginatingRoute` resolved webchat→WA as `originatingChannel: "internal"`, killing WA delivery
- Our patch #23 uses `INTERNAL_MESSAGE_CHANNEL` to let the SESSION decide delivery channel

**Strategy:**
1. KEEP `INTERNAL_MESSAGE_CHANNEL` routing (patch #23) — this IS our WA delivery
2. Accept upstream route-hardening commits that are ADDITIVE (new guard functions, new checks)
3. Do NOT adopt upstream routing replacements that override our `INTERNAL_MESSAGE_CHANNEL` logic
4. Add fast mode, transcript creation, ACP provenance as additive code
5. For each [FORK-PATCH-N] marker: verify it survived, re-apply if not

---

### 🟡 MEDIUM RISK

#### 3. `src/gateway/server-http.ts`
**Our patches:** #19 (Media Endpoint), #27 (Media Inbound Path)
**Upstream:** 9 commits — hook proxy caching, plugin HTTP auth hardening, readiness probes, image_url support
**Strategy:** Keep our `/media` routes and inbound path. Add upstream's new routes/hardening around them.

#### 4. `src/gateway/tools-invoke-http.ts`
**Our patch:** #25 (HTTP Tools Channel Reg)
**Strategy:** Keep `listChannelAgentTools`. Merge upstream changes around it.

#### 5. `src/infra/agent-events.ts`
**Our patch:** #5 (WS Inbound Push)
**Strategy:** Keep our inbound-events import and event additions.

#### 6. `src/web/outbound.ts`
**Our patch:** #2 (Brazil JID Resolution)
**Upstream:** 3 commits — fromMe context, MIME normalization
**Strategy:** Keep `resolveJidWithBrazil`. Accept upstream additions.

#### 7. `src/auto-reply/status.ts`
**Our patch:** #8 (Status Card Redesign)
**Strategy:** Keep `padLabel` and our formatting. Accept upstream changes outside our modifications.

#### 8. `src/auto-reply/reply/get-reply.ts`
**Our patch:** #3 (Audio Transcript Hook)
**Strategy:** Keep `🎤` emoji hook. Accept upstream changes around it.

#### 9. `src/tts/tts-core.ts`
**No numbered patch** but may have fork changes.
**Strategy:** Review diff carefully. Accept upstream unless it breaks voice delivery.

#### 10-12. `src/auto-reply/reply/directive-handling.*.ts` + `get-reply-directives-apply.ts`
**Strategy:** Accept upstream unless conflicts with verbose light (#13) or thinking patches.

#### 13. `src/auto-reply/reply/session.ts`
**Strategy:** Review carefully — affects session routing. Accept upstream if no fork patches here.

#### 14. `src/tui/commands.ts`
**Strategy:** Accept upstream. Our TUI patch (#7) is in `theme.ts`, not here.

#### 15. `.gitignore`
**Strategy:** Trivial merge.

---

### ⚠️ FILE COLLISIONS: Upstream Created Files We Also Created

| File | Ours | Upstream | Resolution |
|------|------|---------|-----------|
| `src/gateway/chat-attachments.ts` | 244 lines (#21) | 184 lines | Compare both. If upstream is a subset of ours, keep ours. If different features, merge. |
| `src/gateway/server-broadcast.ts` | 167 lines (#31) | 131 lines | **KEEP OURS** — our `globalThis.__openclaw_gatewayEventBus__` singleton is essential for bundler chunk survival. Upstream likely uses module-level state that breaks with our bundler setup. |

---

### ✅ AUTO-MERGED (must verify post-merge)

| File | Patch | Verify |
|------|-------|--------|
| `pi-embedded-subscribe.ts` | #15 Webchat Thinking Stream | `grep -q 'streamReasoning: true'` |
| `thinking.ts` | #13 Verbose Light | `grep -q '"light"'` |
| `qmd-manager.ts` | #9 QMD Output Limit | `grep -q "maxOutputChars"` |
| `theme.ts` | #7 TUI Dark Theme | `grep -q "236"` |
| `deliver-reply.ts` | #11 WA Paragraph Streaming | `grep -q "streamDelayMs"` |

### ✅ OUR FILES ONLY (no upstream equivalent)

| File | Patch |
|------|-------|
| `src/gateway/server-sse.ts` | #18 SSE Streaming |
| `src/infra/inbound-events.ts` | #5 WS Inbound Push |
| `src/agents/tools/image-generate-tool.ts` | #20 Image Generate |
| `src/cli/logs-pretty-formatter.ts` | #10 Logs Pretty |

---

## Execution Plan

### Phase 0: Pre-merge Checks
- [ ] Verify `gateway.auth.mode` in `openclaw.json` (v2026.3.7 breaking change)
- [ ] Verify butley-api plugin uses `registerHttpRoute` not `registerHttpHandler`
- [ ] Tag safety point: `git tag safe/pre-merge-3.13 alpha`

### Phase 1: Branch Setup
- [ ] `git checkout alpha`
- [ ] `git checkout -b feat/upstream-merge-3.13` (from alpha HEAD)
- [ ] `git merge --no-commit --no-ff v2026.3.13-1`

### Phase 2: Resolve 15 Conflicts (in order)

**Sacred files first:**
1. `server-chat.ts` — keep patches #4/#16/#17, adopt upstream signature changes
2. `server-methods/chat.ts` — keep patches #22/#23/#24/#26/#29/#30, keep `INTERNAL_MESSAGE_CHANNEL`

**Then medium risk:**
3. `server-http.ts` — keep patches #19/#27
4. `tools-invoke-http.ts` — keep patch #25
5. `agent-events.ts` — keep patch #5
6. `outbound.ts` — keep patch #2
7. `status.ts` — keep patch #8
8. `get-reply.ts` — keep patch #3
9. `session.ts` — review, accept upstream
10-12. `directive-handling.*.ts` — review, accept upstream
13. `tts-core.ts` — review, accept upstream
14. `commands.ts` — accept upstream
15. `.gitignore` — trivial

### Phase 3: File Collisions
- [ ] Compare `chat-attachments.ts` (ours 244 lines vs upstream 184)
- [ ] Compare `server-broadcast.ts` (keep ours — globalThis singleton)

### Phase 4: Verify Auto-Merged Patches
- [ ] `bash patches/verify-patches.sh .`
- [ ] Manual check any failures

### Phase 5: Build
- [ ] `npm run build` — zero errors
- [ ] Fix TypeScript errors from upstream API changes

### Phase 6: Functional Tests (MANDATORY)
- [ ] (a) Webchat send → arrives on WhatsApp
- [ ] (b) Tool calls stream with intermediate text in chat UI
- [ ] (c) Thinking blocks render
- [ ] (d) WA inbound → response arrives
- [ ] (e) SSE streaming works in Butley chat UI
- [ ] (f) `openclaw doctor --fix` passes (cron migration!)
- [ ] (g) `tailscale funnel status` says "Available on the internet"

### Phase 7: Commit & Push
- [ ] Commit merge as Lucas Machado, Co-authored-by: Bob
- [ ] Push `feat/upstream-merge-3.13`

### Phase 8: Cherry-pick work-only commits
- [ ] `git cherry-pick 9e1137af` — Guilherme's system-prompt (fork PR #4)
- [ ] `git cherry-pick 456f0911` — SSE rate-limit fix
- [ ] `git cherry-pick b4652339 58184f81` — Patch #34 (session chain) + docs
- [ ] Build again to verify cherry-picks don't break anything

### Phase 9: Promote & Align
- [ ] Merge `feat/upstream-merge-3.13` → `alpha`
- [ ] Fast-forward `work` to `alpha`
- [ ] Run `sessions-adopt.sh --apply` if needed
- [ ] Run `openclaw doctor --fix` (v2026.3.11 cron migration)
- [ ] Verify all cron jobs still work (Scribe, Curator, Architect, Git Auto-Commit, Digest)

---

## Lessons from Failed v2026.3.12 Merge (Mar 15 02:45)

1. **Never replace our patch code with upstream equivalents** — patches exist BECAUSE upstream doesn't do what we need
2. **`server-chat.ts` + `server-methods/chat.ts` = SACRED** — patches #4, #16, #18, #23, #29, #30, #32 live there
3. **Test the full delivery chain** before declaring success — build passing ≠ working
4. **Upstream's `resolveChatSendOriginatingRoute`** kills WA delivery — our #23 is essential
5. **Upstream's `flushBufferedChatDeltaIfNeeded`** doesn't cover SSE — our inline flush is needed alongside
6. **Know your branches** — `alpha` is the merge target (clean patches), `work` has extra commits (some valid, some dead). Don't confuse them.
7. **Upstream never tagged v2026.3.3** — they jumped 3.2 → 3.7. Our "3.3" is a snapshot of upstream/main at that moment, later absorbed into v2026.3.7.

---

## Risk Assessment

**Overall: MEDIUM-HIGH**

- 15 conflicted files, 17 patches affected
- 2 file collisions (upstream created files we already had)
- Sacred files have 22 upstream commits combined
- v2026.3.11 has a cron migration that MUST run post-merge
- But: we now know exactly WHY the last merge broke, and the protocol prevents it

**Estimated time:** 3-5 hours for careful resolution + testing
