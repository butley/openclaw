# Live Tool Narration Patch

> **Status:** Experimental (local only, not committed to fork)  
> **Date:** 2026-02-10  
> **Author:** Bob 🦞

## What It Does

Sends contextual status messages to WhatsApp when tools start executing, BEFORE the final output arrives. Instead of the user seeing nothing for 5-10 seconds, they get real-time narration:

```
User: Pesquisa sobre Convex database

🔍 Pesquisando "Convex database"...        ← instant
🌐 Acessando docs.convex.dev...            ← 2s later
                                            
The weather in Paris is 15°C, partly cloudy. ← final output
```

## Files Modified

### 1. `src/agents/pi-embedded-subscribe.handlers.tools.ts`

**Line ~85:** Added `args` to the `onAgentEvent` callback for `tool:start`.

Previously, the callback only received `{ phase, name, toolCallId }` — no args. The `emitAgentEvent` (for WebSocket/UI) already included args, but the callback (used by the reply pipeline) stripped them.

```diff
  void ctx.params.onAgentEvent?.({
    stream: "tool",
-   data: { phase: "start", name: toolName, toolCallId },
+   data: { phase: "start", name: toolName, toolCallId, args: args as Record<string, unknown> },
  });
```

### 2. `src/auto-reply/reply/agent-runner-execution.ts`

**Line ~350:** Added narration logic inside the `onAgentEvent` handler, triggered on `tool:start`.

Uses a switch statement to map each tool name to:
- An emoji (🔍, 📖, ⚙️, etc.)
- A contextual Portuguese description using the tool's args

Example outputs:
- `web_search` with query "convex" → `🔍 _Pesquisando "convex"..._`
- `Read` with path "auth.ts" → `📖 _Lendo auth.ts..._`
- `exec` → `⚙️ _Executando comando..._`
- `memory_search` with query "jwks" → `🧠 _Buscando na memória "jwks"..._`
- `message` → `💬 _Enviando mensagem..._`

Messages are sent via `onToolResult` (same mechanism as tool summaries).

## Known Limitation: Groups

**Tool narration does NOT appear in group chats.**

Root cause in `src/auto-reply/reply/dispatch-from-config.ts` line 322:
```typescript
const shouldSendToolSummaries = ctx.ChatType !== "group" && ctx.CommandSource !== "native";
```

This disables `onToolResult` entirely for groups. Our narration piggybacks on `onToolResult`, so it's also disabled.

### Fix Options

1. **Quick:** Change the condition to allow narration in groups
2. **Clean:** Create a separate `liveNarration` callback independent of `shouldSendToolSummaries`
3. **Configurable:** Add `agents.defaults.liveNarration: { enabled: true, groups: false }` to openclaw.json

## TODO

- [ ] Enable for group chats (separate flag from toolSummaries)
- [ ] Add config option (`agents.defaults.liveNarration`) to enable/disable per agent/channel
- [ ] Refine messages — more contextual, smarter arg extraction
- [ ] Rate limit narration for rapid sequential tool calls (e.g., max 1 per 2s)
- [ ] Handle long args (currently truncated at 40-50 chars)
- [ ] Strip model's inline narration from final output to avoid duplication
- [ ] i18n support (currently hardcoded Portuguese)
- [ ] Test interaction with Opus 4.6 inline narration — potential duplication
- [ ] Consider showing tool duration ("🔍 Pesquisando... (2.3s)")

## How to Apply

These changes are currently applied directly to the local OpenClaw install at `~/openclaw/src/`. To apply to a clean fork:

```bash
# The two files to modify:
# 1. src/agents/pi-embedded-subscribe.handlers.tools.ts (add args to onAgentEvent callback)
# 2. src/auto-reply/reply/agent-runner-execution.ts (add narration switch in onAgentEvent handler)

cd ~/openclaw
npm run build
openclaw gateway restart
```

## Related

- Proposal doc: `~/openclaw/docs/proposals/whatsapp-narration-status.md`
- GitHub issue body: `~/clawd/GITHUB_ISSUE_BODY.md`
- Branch (proposal only): `feature/whatsapp-narration-status-proposal`
