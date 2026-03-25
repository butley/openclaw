# OpenClaw Upstream Sync Analysis

**Generated:** 2026-02-03  
**Our fork:** `butley/openclaw` (branch `dev`)  
**Upstream:** `openclaw/openclaw` (branch `main`)  
**Status:** 7 commits ahead, 192 commits behind  
**Merge base:** `d5593d647c2f1aed1fef6f938f4d6ae95a503af3`

---

## Executive Summary

**Recommendation:** ⚠️ **Proceed with caution - Manual merge required**

The upstream sync is **feasible but requires manual conflict resolution** in one critical file. Our custom patches are well-isolated but touch core gateway infrastructure that has undergone significant upstream refactoring.

**Key findings:**

- ✅ Most of our patches are isolated (new files or independent sections)
- ⚠️ One merge conflict in `src/gateway/server-methods/chat.ts` (import statements)
- ⚠️ Upstream has major security hardening and gateway refactoring
- ✅ Our WhatsApp patches are independent of upstream changes
- ⚠️ Upstream changed gateway initialization and tool event handling

---

## 1. Our Custom Patches (7 commits)

### Commit 1: `ffcbba0f5` - TypeScript cleanup for dev build

**Files modified:**

- `src/auto-reply/reply/dispatch-from-config.ts`
- `src/gateway/server-methods/chat.ts`
- `src/web/inbound/monitor.ts`

**Functionality:** Cleanup unused imports and fix TypeScript types for development build.

**Core modules touched:** Auto-reply dispatch, gateway chat methods, WhatsApp monitor

---

### Commit 2: `73c81b466` - Add RUN_OPENCLAW_DEV.md documentation

**Files modified:**

- `RUN_OPENCLAW_DEV.md` (new file)

**Functionality:** Documentation for running OpenClaw from source on custom port.

**Core modules touched:** None (docs only)

---

### Commit 3: `c754bcf46` - Merge patches/2026-02-03 into dev (resolved conflicts)

**Files modified:**

- `docs/channels/whatsapp.md`
- `docs/concepts/agent-loop.md`
- `docs/tts.md`
- `docs/tui.md`
- `docs/web/webchat.md`
- `src/agents/tools/tts-tool.ts`
- `src/auto-reply/reply/get-reply.ts`
- `src/gateway/server-chat.ts`
- `src/gateway/server-methods/chat.ts`
- `src/web/inbound/brazil-jid-resolver.ts`
- `src/web/inbound/monitor.ts`
- `src/web/inbound/send-api.ts`
- `src/web/outbound.ts`

**Functionality:** Merge of multiple patches including WhatsApp improvements, TTS enhancements, and chat system changes. Includes a "mirror" feature to echo messages back to WhatsApp.

**Core modules touched:** TTS, auto-reply, gateway chat, WhatsApp inbound/outbound, Brazil JID resolver

---

### Commit 4: `0cad3339c` - feat: add WebSocket inbound message push

**Files modified:**

- `src/auto-reply/reply/dispatch-from-config.ts`
- `src/gateway/server-close.ts`
- `src/gateway/server-methods-list.ts`
- `src/gateway/server.impl.ts`
- `src/infra/inbound-events.ts` (new file)

**Functionality:** Real-time WebSocket push notifications for inbound messages. Adds `message.inbound` event to gateway events. Creates pub/sub mechanism for dashboard real-time updates.

**Core modules touched:** Gateway server, auto-reply dispatch, infrastructure events

**Event payload includes:** messageId, sessionKey, channel, accountId, from, senderName, content, timestamp, chatType, conversationId, threadId, hasMedia, mediaType, metadata

---

### Commit 5: `0a99b9f16` - Apply WhatsApp/TTS/chat patches

**Files modified:**

- `docs/channels/whatsapp.md`
- `docs/concepts/agent-loop.md`
- `docs/tts.md`
- `docs/tui.md`
- `docs/web/webchat.md`
- `src/agents/tools/tts-tool.ts`
- `src/auto-reply/reply/get-reply.ts`
- `src/gateway/server-chat.ts`
- `src/gateway/server-methods/chat.ts`
- `src/web/inbound/brazil-jid-resolver.ts`
- `src/web/inbound/monitor.ts`
- `src/web/inbound/send-api.ts`
- `src/web/outbound.ts`

**Functionality:** WhatsApp-specific patches including TTS optimizations and chat improvements. Brazil phone number JID resolution improvements.

**Core modules touched:** TTS tool, auto-reply, gateway chat, WhatsApp integration

---

### Commit 6 & 7: `aea535abf` + `5bc13be14` - Apply local clawdbot patches to source (duplicate)

**Files modified:**

- `docs/local-patches.md` (new file)
- `src/agents/tools/tts-tool.ts`
- `src/auto-reply/reply/get-reply.ts`
- `src/gateway/protocol/schema/logs-chat.ts`
- `src/gateway/server-chat.ts`
- `src/gateway/server-methods/chat.ts`
- `src/infra/agent-events.ts`
- `src/tts/tts.ts`
- `src/tui/theme/theme.ts`
- `src/web/active-listener.ts`
- `src/web/inbound/brazil-jid-resolver.ts` (new file, 240 lines)
- `src/web/inbound/monitor.ts`
- `src/web/inbound/send-api.ts`
- `src/web/outbound.ts`

**Functionality:** Comprehensive local patches including:

- Brazil JID resolver (240-line new file for +55 phone number handling)
- TTS format improvements (opus support)
- TUI theme adjustments (darker backgrounds)
- Agent event tracking enhancements
- WhatsApp message logging improvements

**Core modules touched:** TTS, gateway, agent events, WhatsApp integration, TUI theme

---

## 2. Upstream Changes (192 commits)

### Security & Auth (High Priority)

- **Security: owner-only tools + command auth hardening (#9202)**
- **Security: harden sandboxed media handling (#9182)**
- **Security: Prevent gateway credential exfiltration via URL override (#9179)**
- **fix(security): separate untrusted channel metadata from system prompt**
- **fix: stabilize windows acl tests and command auth registry (#9335)**
- **fix: enforce owner allowlist for commands**
- **fix(approvals): gate /approve by gateway scopes**

### Gateway & TUI Improvements

- **TUI/Gateway: fix pi streaming + tool routing + model display + msg updating (#8432)**
- **fix(control-ui): resolve header logo when gateway.controlUi.basePath is set (#7178)**
- **feat: add cloudflare ai gateway provider**
- **Tests: restore TUI gateway env**

### Telegram Improvements

- **fix(telegram): pass parentPeer for forum topic binding inheritance (#9789)**
- **fix: preserve telegram DM topic threadId (#9039)**
- **fix(telegram): preserve DM topic threadId in deliveryContext**
- **Telegram: remove @ts-nocheck from bot-handlers.ts, bot-message.ts, bot.ts**
- **fix(telegram): include forward_from_chat metadata in forwarded message context (#8133)**

### Refactoring & Code Quality

- **refactor(cron): improve delivery configuration handling**
- **chore: Typecheck test helper files**
- **Update deps**

### Features

- **feat(heartbeat): add accountId config option for multi-agent routing (#8702)**
- **feat: per-channel responsePrefix override (#9001)**
- **Discord: allow disabling thread starter context**
- **feat(discord): add set-presence action for bot activity and status**

### Bug Fixes

- **fix: resolve discord owner allowFrom matches**
- **fix: resolve bundled chrome extension assets (#8914)**
- **fix: gracefully downgrade xhigh thinking level in cron isolated agent (#9363)**
- **fix(imessage): detect self-chat echoes to prevent infinite loops (#8680)**
- **Message: clarify media schema + fix MEDIA newline**

### Documentation

- **docs(onboarding): streamline CLI onboarding docs (#9830)**
- **docs(onboarding): add bootstrapping page (#9767)**
- **Docs: streamline start and install docs (#9648)**
- **iMessage: promote BlueBubbles and refresh docs/skills (#8415)**

---

## 3. Conflict Analysis

### Files Modified by Both Sides

| File                                 | Our Changes                                  | Upstream Changes                                      | Severity                        |
| ------------------------------------ | -------------------------------------------- | ----------------------------------------------------- | ------------------------------- |
| `docs/tui.md`                        | Added theme section                          | Added credential note                                 | ✅ Low - Different sections     |
| `src/gateway/server-chat.ts`         | Added message mirror feature                 | Added tool event recipient registry                   | ⚠️ Medium - Different functions |
| `src/gateway/server-methods/chat.ts` | Added mirror param + registerAgentRunContext | Refactored responsePrefix to createReplyPrefixOptions | 🔴 **High - Import conflict**   |
| `src/gateway/server.impl.ts`         | Added inbound event subscription             | Added controlUi root resolution                       | ⚠️ Medium - Different sections  |

### Detailed Conflict Analysis

#### 🔴 **CRITICAL: `src/gateway/server-methods/chat.ts`**

**Our changes:**

- Import `extractShortModelName` and `ResponsePrefixContext` from `response-prefix-template.js`
- Import `registerAgentRunContext` from `agent-events.js`
- Add `mirror?: boolean` parameter to chat handler
- Add mirror logic to echo messages back to WhatsApp
- Register agent run context with mirror flag

**Upstream changes:**

- **BREAKING:** Removed imports of `extractShortModelName` and `ResponsePrefixContext`
- **BREAKING:** Replaced with `createReplyPrefixOptions` from `../../channels/reply-prefix.js`
- Refactored reply prefix handling
- Added `GatewayClientScopes` support
- Added tool event recipient tracking
- Added verbose level resolution

**Conflict:** Import statements clash. Upstream removed the imports we're using and replaced them with a new API.

**Resolution strategy:**

1. Keep upstream's new `createReplyPrefixOptions` import
2. Add our `registerAgentRunContext` import
3. Adapt our mirror logic to work with upstream's refactored prefix handling
4. Ensure our `mirror` parameter fits into upstream's updated handler signature

---

#### ⚠️ `src/gateway/server-chat.ts`

**Our changes:**

- Added mirror logic in agent event handler (lines 203-223)

**Upstream changes:**

- Added `createToolEventRecipientRegistry()` function (lines 123-194)

**Assessment:** No direct conflict - our changes are in the event handler, upstream adds a new registry. Should merge cleanly after manual review.

---

#### ⚠️ `src/gateway/server.impl.ts`

**Our changes:**

- Import `onInboundMessageEvent` from `inbound-events.js`
- Subscribe to inbound message events and broadcast via WebSocket

**Upstream changes:**

- Added controlUi root resolution logic
- Added `ensureControlUiAssetsBuilt` import and initialization

**Assessment:** No direct conflict - different sections of the file. Should merge cleanly.

---

#### ✅ `docs/tui.md`

**Our changes:**

- Added "Theme" section documenting darker backgrounds

**Upstream changes:**

- Added credential note for `--url` flag

**Assessment:** Different sections, no conflict.

---

## 4. Files We Modified That Upstream Did NOT Touch

These should merge without conflicts:

### New Files (Safe)

- ✅ `RUN_OPENCLAW_DEV.md` - Our documentation
- ✅ `src/infra/inbound-events.ts` - Our new pub/sub system
- ✅ `src/web/inbound/brazil-jid-resolver.ts` - Our Brazil phone handling (240 lines)
- ✅ `docs/local-patches.md` - Our patch documentation

### Modified Files (Safe - Upstream didn't touch)

- ✅ `docs/channels/whatsapp.md`
- ✅ `docs/concepts/agent-loop.md`
- ✅ `docs/tts.md`
- ✅ `docs/web/webchat.md`
- ✅ `src/agents/tools/tts-tool.ts`
- ✅ `src/auto-reply/reply/get-reply.ts`
- ✅ `src/auto-reply/reply/dispatch-from-config.ts`
- ✅ `src/gateway/server-close.ts`
- ✅ `src/gateway/server-methods-list.ts`
- ✅ `src/gateway/protocol/schema/logs-chat.ts`
- ✅ `src/infra/agent-events.ts`
- ✅ `src/tts/tts.ts`
- ✅ `src/tui/theme/theme.ts`
- ✅ `src/web/active-listener.ts`
- ✅ `src/web/inbound/monitor.ts`
- ✅ `src/web/inbound/send-api.ts`
- ✅ `src/web/outbound.ts`

---

## 5. Risk Assessment

### Overall Risk Level: ⚠️ **MEDIUM-HIGH**

**Why not low risk?**

1. **Import conflict requires manual resolution** - The `server-methods/chat.ts` conflict is in critical gateway code
2. **Upstream security hardening** - We need to ensure our patches don't bypass new security measures
3. **Gateway refactoring** - Upstream changed how response prefixes work (our mirror feature depends on this)
4. **192 commits is significant** - Lots of changes we haven't reviewed in detail

**Why not critical risk?**

1. **Only 1 actual merge conflict** - Most of our changes are isolated
2. **Our patches are well-documented** - We have `docs/local-patches.md`
3. **No upstream changes to our custom files** - Brazil JID resolver, inbound-events are safe
4. **WhatsApp integration is mostly isolated** - Upstream hasn't touched our WhatsApp code

### Specific Risks

| Risk                                            | Severity | Mitigation                                                        |
| ----------------------------------------------- | -------- | ----------------------------------------------------------------- |
| Mirror feature breaks after merge               | Medium   | Test thoroughly after adapting to new prefix API                  |
| Security hardening conflicts with our patches   | Medium   | Review all security commits, ensure our code follows new patterns |
| Brazil JID resolver becomes redundant           | Low      | Check if upstream added similar functionality                     |
| Inbound events conflict with new gateway events | Low      | Review upstream event changes, ensure no naming conflicts         |
| TTS patches become obsolete                     | Low      | Check if upstream improved TTS handling                           |

---

## 6. Recommended Strategy

### ✅ **Recommended Approach: Incremental Merge with Manual Conflict Resolution**

**Step-by-step plan:**

#### Phase 1: Preparation (1-2 hours)

1. **Create backup branch:** `git checkout -b dev-pre-upstream-merge`
2. **Push backup:** `git push origin dev-pre-upstream-merge`
3. **Create merge branch:** `git checkout -b merge-upstream-192 dev`
4. **Document current state:** Screenshot/test our current custom features (mirror, Brazil JID, inbound events)

#### Phase 2: Merge & Resolve Conflicts (2-4 hours)

1. **Attempt merge:** `git merge upstream/main --no-ff`
2. **Resolve `server-methods/chat.ts` conflict:**
   - Accept upstream's import changes (`createReplyPrefixOptions`)
   - Add our `registerAgentRunContext` import
   - Adapt our mirror logic to work with upstream's new API
   - Keep our `mirror?: boolean` parameter
3. **Review other files for semantic conflicts:**
   - Check `server-chat.ts` - ensure tool registry doesn't conflict with our mirror logic
   - Check `server.impl.ts` - ensure inbound events and controlUi don't clash
4. **Run TypeScript build:** `npm run build` or `tsc --noEmit`

#### Phase 3: Testing (2-3 hours)

1. **Test WhatsApp integration:**
   - Send messages
   - Test mirror feature
   - Verify Brazil JID resolution works
   - Check TTS/voice notes
2. **Test Gateway WebSocket:**
   - Verify `message.inbound` events still fire
   - Check dashboard receives real-time updates
3. **Test TUI:**
   - Verify theme still applies
   - Check gateway connection
4. **Security validation:**
   - Review our code against new security patterns
   - Ensure we're not bypassing command auth
   - Check media handling follows new sandboxing

#### Phase 4: Documentation & Commit (1 hour)

1. **Update `docs/local-patches.md`:**
   - Document merge date
   - Note any changes to our patches
   - Document new upstream version we're based on
2. **Update `RUN_OPENCLAW_DEV.md` if needed**
3. **Commit merge:** `git commit -m "Merge upstream/main (192 commits) - resolved conflicts in server-methods/chat.ts"`
4. **Tag merge point:** `git tag upstream-merge-2026-02-03`

#### Phase 5: Deploy & Monitor (ongoing)

1. **Test in staging environment first**
2. **Deploy to production**
3. **Monitor for issues over 24-48 hours**
4. **Be ready to rollback to `dev-pre-upstream-merge` if critical issues emerge**

---

### ❌ **NOT Recommended: Rebase**

**Why avoid rebasing our 7 commits onto upstream/main?**

- Risk of mangling merge commits (commit 3 is already a merge)
- Harder to rollback if something breaks
- Loses the merge history
- More complex conflict resolution across multiple commits

---

### 🤔 **Alternative: Cherry-pick Upstream Commits**

**Pros:**

- More control over what we merge
- Can skip problematic commits
- Incremental testing

**Cons:**

- Very time-consuming (192 commits!)
- Easy to miss dependencies between commits
- Harder to stay in sync long-term

**Verdict:** Only consider if full merge fails catastrophically.

---

## 7. Specific Files Requiring Manual Attention

### 🔴 **MUST FIX: `src/gateway/server-methods/chat.ts`**

**Location of conflict:** Import statements at top of file

**What to do:**

1. Remove conflict markers
2. Keep upstream's new import:
   ```typescript
   import { createReplyPrefixOptions } from "../../channels/reply-prefix.js";
   ```
3. Add our import:
   ```typescript
   import { registerAgentRunContext } from "../../infra/agent-events.js";
   ```
4. In the chat handler function:
   - Keep our `mirror?: boolean` parameter in the params type
   - Keep our `registerAgentRunContext(clientRunId, { sessionKey: p.sessionKey, mirror: p.mirror })` call
   - Adapt our mirror logic to work with upstream's `createReplyPrefixOptions`
5. Test thoroughly after merge

---

### ⚠️ **REVIEW: `src/gateway/server-chat.ts`**

**What to check:**

- Ensure our mirror logic (lines 203-223) doesn't interfere with upstream's tool event registry
- Verify the event handler flow still makes sense
- Test that both features work together

---

### ⚠️ **REVIEW: `src/gateway/server.impl.ts`**

**What to check:**

- Ensure our inbound event subscription doesn't conflict with controlUi initialization
- Verify cleanup order in server close is correct
- Test that WebSocket broadcasting still works

---

### ✅ **VERIFY: All our new files still work**

Test each of these after merge:

- `src/infra/inbound-events.ts` - Pub/sub still functional?
- `src/web/inbound/brazil-jid-resolver.ts` - Phone number resolution works?
- `docs/local-patches.md` - Update with merge notes
- `RUN_OPENCLAW_DEV.md` - Still accurate?

---

## 8. Post-Merge Validation Checklist

Use this checklist after completing the merge:

### Build & Type Checking

- [ ] `npm install` completes without errors
- [ ] `npm run build` completes without errors
- [ ] `tsc --noEmit` shows no type errors
- [ ] All tests pass: `npm test`

### Functional Testing - WhatsApp

- [ ] Can send messages to WhatsApp
- [ ] Can receive messages from WhatsApp
- [ ] Brazil phone numbers resolve correctly (+55 format)
- [ ] Mirror feature works (messages echo back)
- [ ] TTS/voice notes work
- [ ] Media uploads work

### Functional Testing - Gateway

- [ ] Gateway starts without errors
- [ ] WebSocket connections establish
- [ ] `message.inbound` events fire correctly
- [ ] Dashboard receives real-time updates
- [ ] TUI connects and works
- [ ] Chat history loads

### Functional Testing - Security

- [ ] Command auth is enforced
- [ ] Owner allowlist works
- [ ] Media handling is sandboxed
- [ ] No credential leaks in logs

### Code Quality

- [ ] No new TypeScript `@ts-ignore` or `@ts-nocheck` added
- [ ] No console.log left in production code
- [ ] Proper error handling in our patches
- [ ] Comments/docs updated where needed

### Documentation

- [ ] `docs/local-patches.md` updated with merge date
- [ ] `RUN_OPENCLAW_DEV.md` updated if needed
- [ ] This analysis file archived as `upstream-sync-analysis-2026-02-03.md`

---

## 9. Long-Term Maintenance Strategy

### Staying in Sync with Upstream

**Current status:** 192 commits behind is a lot. We should avoid this in the future.

**Recommendations:**

1. **Weekly upstream checks:**
   - Every Monday, check `git fetch upstream && git log dev..upstream/main --oneline | wc -l`
   - If >20 commits, plan a merge

2. **Monthly merges:**
   - Schedule time on the first week of each month to merge upstream changes
   - Prevents accumulation of merge debt

3. **Monitor upstream releases:**
   - Watch the openclaw/openclaw repo for release tags
   - Review release notes for breaking changes

4. **Document our patches better:**
   - Keep `docs/local-patches.md` updated
   - Consider upstreaming some patches (Brazil JID resolver might be useful to others)

5. **Automated conflict detection:**
   - Set up a CI job that attempts merge weekly and notifies if conflicts
   - Gives early warning before conflicts accumulate

### Potential Upstreaming Candidates

Consider contributing these to upstream:

1. **Brazil JID resolver** (`src/web/inbound/brazil-jid-resolver.ts`)
   - 240 lines of well-structured code
   - Solves a real problem for +55 users
   - Could benefit other Brazilian users

2. **Inbound message WebSocket events** (`src/infra/inbound-events.ts`)
   - Generic pub/sub for message events
   - Useful for any dashboard/monitoring tool
   - Clean implementation

3. **TTS improvements** (opus format support)
   - Better audio quality
   - Smaller file sizes
   - WhatsApp-compatible

**How to upstream:**

1. Open an issue discussing the feature
2. Create a clean PR against openclaw/openclaw
3. Follow their contribution guidelines
4. Be responsive to feedback

---

## 10. Emergency Rollback Plan

If the merge goes badly:

### Quick Rollback (5 minutes)

```bash
# Abort merge if in progress
git merge --abort

# Switch back to pre-merge state
git checkout dev
git reset --hard dev-pre-upstream-merge

# Verify we're back to working state
npm run build
npm test
```

### Full Rollback (if already pushed)

```bash
# Create revert branch
git checkout dev
git revert HEAD -m 1  # Revert the merge commit
git push origin dev

# Or force push (use with caution!)
git checkout dev
git reset --hard dev-pre-upstream-merge
git push origin dev --force-with-lease
```

**Always:**

1. Have the backup branch `dev-pre-upstream-merge` before starting
2. Test in a staging environment before production
3. Have monitoring in place to catch issues quickly
4. Communicate with team before rolling back

---

## Conclusion

**Summary:** The upstream sync is **feasible but requires careful manual work**. We have one import conflict that needs resolution, and we need to adapt our mirror feature to upstream's refactored API. The good news is that most of our patches are isolated and should merge cleanly.

**Time estimate:** 6-10 hours total (2-4 for merge, 2-3 for testing, 2-3 for documentation and contingency)

**Next steps:**

1. ✅ Review this analysis with the team
2. ✅ Schedule dedicated time for the merge (don't rush it)
3. ✅ Create backup branch
4. ✅ Follow the incremental merge strategy
5. ✅ Test thoroughly before declaring success

**Confidence level:** 7/10 - One real conflict, but it's manageable. Our patches are generally well-isolated. Main risk is semantic conflicts we haven't discovered yet.

---

**Analysis generated by:** Bob (AI Agent) via subagent `openclaw-fork-analysis`  
**Contact:** Luke (@+553196348700) for questions about this analysis
