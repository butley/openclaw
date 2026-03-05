# Butley Fork — Patch Map

This document describes every custom change in `butley/openclaw` relative to upstream `openclaw/openclaw`.

---

## Branch Structure

| Branch           | Purpose                                         | Status          |
| ---------------- | ----------------------------------------------- | --------------- |
| `alpha`          | Production-ready patches — clean, upstream-safe | ✅ Active       |
| `streaming`      | WA paragraph delay + typing indicator           | 🧪 Experimental |
| `tool-narration` | WA tool narration + verbose gate fix            | 🧪 Experimental |

---

## `alpha` branch

### What's in it

Two commits on top of the upstream merge:

#### 1. `feat(logs-pretty)` (2 commits: `3588b29`, `e5fcab0`)

Pretty-formatter for `openclaw logs`. Adds `--pretty` flag, collapsing exec heredoc content, formatting session-memory hook lines, tool emoji display with meta extraction.

#### 2. `feat(whatsapp): blockStreaming config-driven` (`6de789248` → trimmed to `dbc10f25`)

**What it does:**

- Makes `blockStreaming` a config flag instead of hardcoded `false`
- When `blockStreaming: true` in config, LLM responses are delivered block-by-block as they're generated (one WA message per block), instead of waiting for the full final reply
- A "block" = text generated between tool call boundaries. For simple responses (no tool calls), the entire text is one block

**What it does NOT do:**

- Does NOT artificially split paragraphs (that's `streaming` branch)
- Does NOT add delays between messages
- Does NOT include toolNarration (removed, lives in `tool-narration` branch)

**Config:**

```json
"channels": {
  "whatsapp": {
    "blockStreaming": true   // default: false
  }
}
```

**Files changed:**

- `src/channels/dock.ts` — registers blockStreaming capability
- `src/web/auto-reply/monitor/process-message.ts` — reads config, gates block delivery

---

## `streaming` branch

Base: `6de789248` (same as alpha) + 1 commit on top.

### `feat(wa): paragraph reading-delay + typing indicator` (`c59a821b4`)

**What it does:**
Adds artificial reading-time delays between paragraphs in direct WA conversations. While waiting, shows the WA typing indicator.

**How it works:**

- Pre-delivery: before each block (except first), calculate delay based on PREVIOUS block's char count
- Show `sendComposing` → wait → send next block
- After all blocks: `sendAvailable` clears the typing indicator immediately

**Delay formula:**

```
Math.max(4000, Math.min(12000, prevBlockText.length * 50))
```

- ≤80 chars → 4s (min)
- 150 chars → 7.5s
- 200 chars → 10s
- 240+ chars → 12s (max)

**Config:** Hardcoded for now. Roadmap: per-channel/per-group config (see `docs/wa-paragraph-delay.md`).

**Files changed:**

- `src/web/auto-reply/monitor/process-message.ts` — pre-delivery delay + typing loop + `sendAvailable`
- `src/web/auto-reply/deliver-reply.ts` — intra-chunk fallback delay
- `src/web/inbound/types.ts` — adds `sendAvailable` to `WebInboundMsg`
- `src/web/inbound/monitor.ts` — implements `sendAvailable`
- `docs/wa-paragraph-delay.md` — detailed feature docs

**What it does NOT affect:**

- Mirror (webchat → WA): paragraphs arrive as-is, no delay
- Agent-to-agent messages: currently still delayed (future: detect @mention → skip delay)

---

## `tool-narration` branch

Base: `6de789248` + 2 commits on top.

### Commit 1: `feat(whatsapp): toolNarration config flag` (part of `6de789248`)

**What it does:**
Adds `toolNarration: true/false` config flag to WA channel. When enabled, tool call summaries (e.g. "🔍 Searching...", "📁 Reading file") are sent as WA messages during a response.

**Config:**

```json
"channels": {
  "whatsapp": {
    "toolNarration": true   // default: false
  }
}
```

**Difference from `/verbose`:**

- `/verbose` = debug mode for web UI, shows full tool inputs/outputs
- `toolNarration` = user-facing status updates sent as WA messages

**Files changed:**

- `src/config/types.whatsapp.ts` — type definition
- `src/config/zod-schema.core.ts` — schema
- `src/config/zod-schema.providers-whatsapp.ts` — schema
- `src/web/accounts.ts` — resolver
- `src/web/auto-reply/monitor/process-message.ts` — delivery gate

### Commit 2: `fix(tool-narration): decouple emitToolSummary from verbose gate` (`ec71552a9`)

**The bug:** `toolNarration: true` had no effect because `emitToolSummary` was gated on `verbose !== "off"`. If `/verbose` was off (default), tool summaries were never generated regardless of the config flag.

**The fix:** `createShouldEmitToolResult` always returns `true`. Delivery is still gated at channel level via the `toolNarration` config flag.

**File changed:**

- `src/auto-reply/reply/agent-runner-helpers.ts`

### Commit 3: `fix(chat): propagate mirror flag to agent run context` (part of `6de789248`)

**What it does:**
4-line fix in `chat.ts` — when `p.mirror` is set on a chat.send RPC, registers `mirror: true` in the agent run context. Fixes `emitChatFinal` not mirroring to WA in Opus agent runs.

**File changed:**

- `src/gateway/server-methods/chat.ts`

---

## Other patches (all on all branches)

These are additional custom patches present across all branches:

| Patch                    | Description                                 |
| ------------------------ | ------------------------------------------- |
| Brazil JID Resolution    | Resolves Brazilian phone numbers to WA JIDs |
| Audio Transcript Hook    | Hooks audio messages for transcription      |
| WS Inbound Push          | WebSocket inbound push mechanism            |
| TTS Caption Logging      | Logs TTS captions                           |
| TUI Dark Theme           | Dark theme for TUI                          |
| Status Card Redesign     | Monospace status card with Unicode          |
| QMD Log Output Limit Fix | Raised from 200k to 10MB                    |
| Logs Pretty Formatter    | `openclaw logs --pretty`                    |

Full patch registry: `~/openclaw/patches/` and `~/bob/skills/butley-fork-update/references/patches.md`

---

## Pending / Future Work

| Feature                                      | Branch      | Status                                |
| -------------------------------------------- | ----------- | ------------------------------------- |
| paragraphDelay config (per-channel/group)    | `streaming` | 🔲 Not started                        |
| Agent-to-agent bypass (no delay on @mention) | `streaming` | 🔲 Not started                        |
| WebCrypto device pairing                     | —           | 🔲 Not started (blocks public launch) |
| session-memory hook bug (#23027)             | —           | 🔲 Not started                        |

---

## Building

```bash
cd ~/Projects/openclaw
git checkout <branch>
npm run build
launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway
```
