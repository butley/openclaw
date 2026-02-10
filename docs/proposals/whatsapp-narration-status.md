# Live Narration Status Messages for WhatsApp

## Problem Description

### Current Behavior

Opus 4.6 produces inline narration (e.g., "Now let me search...", "Analyzing the results...") mixed into its output. On platforms with streaming support (TUI, web chat), this narration appears naturally as the agent "thinks out loud."

However, on WhatsApp:

- **Messages aren't streamed** — they arrive complete
- **Narration arrives AFTER the final output**, appearing out of order
- The WhatsApp chunker (`src/channels/plugins/outbound/whatsapp.ts`) splits long messages by length
- This causes narration lines to appear as **separate messages AFTER the actual result**

### Example Flow (Current - Broken)

```
User: Search for the weather in Paris

[5 seconds pass with typing indicator...]

Agent: The current weather in Paris is 15°C, partly cloudy.
Agent: Now let me search...         ← TOO LATE!
Agent: Analyzing the results...     ← TOO LATE!
```

### What We Want

```
User: Search for the weather in Paris

[Agent immediately sends:]
Agent: 🔍 Searching...

[3 seconds pass...]

Agent: 📊 Analyzing the results...

[Agent then sends final response:]
Agent: The current weather in Paris is 15°C, partly cloudy.
```

The final output should **NOT** include the narration text (it was already sent as separate status messages).

---

## Research Findings

### 1. Streaming Architecture

The OpenClaw streaming pipeline emits agent events through `emitAgentEvent` (from `src/infra/agent-events.ts`).

**Key event streams:**

- `stream: "tool"` with phases: `"start"`, `"update"`, `"result"`
- `stream: "assistant"` for assistant text
- `stream: "lifecycle"` for run start/end
- `stream: "compaction"` for memory operations

**Source:** `src/agents/pi-embedded-subscribe.handlers.tools.ts`

```typescript
export async function handleToolExecutionStart(
  ctx: EmbeddedPiSubscribeContext,
  evt: AgentEvent & { toolName: string; toolCallId: string; args: unknown },
) {
  // ...
  emitAgentEvent({
    runId: ctx.params.runId,
    stream: "tool",
    data: {
      phase: "start",
      name: toolName,
      toolCallId,
      args: args as Record<string, unknown>,
    },
  });

  void ctx.params.onAgentEvent?.({
    stream: "tool",
    data: { phase: "start", name: toolName, toolCallId },
  });
  // ...
}
```

### 2. Existing Hooks and Events

**Agent Runner (`src/auto-reply/reply/agent-runner-execution.ts`):**

The `runEmbeddedPiAgent` call accepts callbacks:

- `onAgentEvent` - Receives all agent events (tool start/update/end, etc.)
- `onToolResult` - Called to emit tool summaries
- `onBlockReply` - Called for streaming text blocks
- `onAssistantMessageStart` - Called when assistant begins responding
- `onPartialReply` - Called for partial streaming content

**Current implementation for typing:**

```typescript
onAgentEvent: async (evt) => {
  if (evt.stream === "tool") {
    const phase = typeof evt.data.phase === "string" ? evt.data.phase : "";
    if (phase === "start" || phase === "update") {
      await params.typingSignals.signalToolStart();
    }
  }
};
```

### 3. WhatsApp Outbound Plugin

**Location:** `src/channels/plugins/outbound/whatsapp.ts`

**Key functions:**

- `chunkText` - Splits long messages (limit: 4000 chars)
- `sendText` - Sends plain text messages
- Uses `src/web/outbound.ts` for actual WhatsApp API calls

**WhatsApp API (`src/web/outbound.ts`):**

```typescript
export async function sendMessageWhatsApp(
  to: string,
  body: string,
  options: { verbose: boolean; mediaUrl?: string; ... }
) {
  // ...
  await active.sendComposingTo(to);  // ← Typing indicator!
  const result = await active.sendMessage(to, text, mediaBuffer, mediaType);
  // ...
}
```

**Note:** `sendComposingTo` already exists for typing indicators!

### 4. Typing Controller

**Location:** `src/auto-reply/reply/typing.ts`

The typing controller manages:

- `startTypingLoop()` - Continuous typing indicator
- `refreshTypingTtl()` - Keep typing alive during long operations
- `markRunComplete()` - Signal when run is done

**Currently used for:**

- Basic typing indicator during agent execution
- Refreshed on tool start/update events

### 5. Tool Summary Mechanism

**Location:** `src/auto-reply/reply/dispatch-from-config.ts`

```typescript
onToolResult: shouldSendToolSummaries
  ? (payload: ReplyPayload) => {
      const run = async () => {
        // Apply TTS if needed
        const ttsPayload = await maybeApplyTtsToPayload({ ... });

        // Send tool summary as separate message
        await dispatcher.dispatch([ttsPayload]);
      };
      void run();
    }
  : undefined
```

**This already sends separate messages during tool execution!** But it only sends tool _results_, not narration.

---

## Proposed Architecture

### 1. Narration Detection

Add a new module: `src/agents/narration-detector.ts`

```typescript
export type NarrationPattern = {
  pattern: RegExp;
  emoji?: string;
  priority: number;
};

const DEFAULT_NARRATION_PATTERNS: NarrationPattern[] = [
  { pattern: /^Now let me (search|look|check|find)/i, emoji: "🔍", priority: 1 },
  { pattern: /^Searching\.\.\./i, emoji: "🔍", priority: 1 },
  { pattern: /^Analyzing (the |these )?results?/i, emoji: "📊", priority: 2 },
  { pattern: /^Let me (think|consider|analyze)/i, emoji: "🤔", priority: 1 },
  { pattern: /^Reading (the |this )?file/i, emoji: "📄", priority: 1 },
  { pattern: /^Checking/i, emoji: "👀", priority: 1 },
  { pattern: /^Looking (up|at|for)/i, emoji: "🔍", priority: 1 },
];

export function detectNarration(text: string): {
  isNarration: boolean;
  emoji?: string;
  narrationText: string;
} {
  const trimmed = text.trim();

  for (const { pattern, emoji } of DEFAULT_NARRATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isNarration: true,
        emoji,
        narrationText: trimmed,
      };
    }
  }

  return { isNarration: false, narrationText: "" };
}

export function stripNarration(text: string): string {
  const lines = text.split("\n");
  const filtered = lines.filter((line) => {
    const { isNarration } = detectNarration(line);
    return !isNarration;
  });
  return filtered.join("\n").trim();
}
```

### 2. Narration Status Messages

Add new callback to agent runner: `onNarrationStatus`

**Modify:** `src/auto-reply/reply/agent-runner-execution.ts`

```typescript
// Add to the runEmbeddedPiAgent params:
onBlockReply: params.opts?.onBlockReply
  ? async (payload) => {
      const { text } = normalizeStreamingText(payload);

      // NEW: Detect and send narration as separate status message
      const narration = detectNarration(text);
      if (narration.isNarration && params.opts?.onNarrationStatus) {
        await params.opts.onNarrationStatus({
          text: narration.emoji
            ? `${narration.emoji} ${narration.narrationText}`
            : narration.narrationText,
        });
        return; // Don't process further - we sent it as status
      }

      // Regular block reply processing...
      // ...existing code...
    }
  : undefined,
```

### 3. WhatsApp Status Message Sender

**Modify:** `src/auto-reply/reply/dispatch-from-config.ts`

```typescript
const shouldSendNarrationStatus =
  channel === "whatsapp" &&
  cfg.agents?.narrationStatusMessages !== false; // Allow disabling

// Add to getReplyFromConfig call:
{
  ...params.replyOptions,
  onNarrationStatus: shouldSendNarrationStatus
    ? (payload: ReplyPayload) => {
        const run = async () => {
          // Send immediately, without TTS (these are quick status updates)
          await dispatcher.dispatch([{
            text: payload.text,
            // Mark as "ephemeral" to prevent logging duplication
            ephemeral: true,
          }]);
        };
        void run();
      }
    : undefined,
}
```

### 4. Strip Narration from Final Output

**Modify:** `src/agents/pi-embedded-subscribe.handlers.messages.ts`

After the assistant message is complete, strip narration lines:

```typescript
export function handleMessageEnd(ctx: EmbeddedPiSubscribeContext) {
  // ...existing code...

  // NEW: Strip narration if status messages are enabled
  if (ctx.params.stripNarration) {
    ctx.state.cleanedText = stripNarration(ctx.state.cleanedText);
  }

  // ...continue with existing logic...
}
```

### 5. Configuration

**Add to:** `src/config/zod-schema.agents.ts`

```typescript
const agentsSchema = z.object({
  // ...existing fields...
  narrationStatusMessages: z.boolean().optional().default(true),
  narrationPatterns: z
    .array(
      z.object({
        pattern: z.string(),
        emoji: z.string().optional(),
        priority: z.number().optional(),
      }),
    )
    .optional(),
});
```

---

## Implementation Plan

### Phase 1: Detection & Stripping (Safe, No Behavior Change)

1. Create `src/agents/narration-detector.ts` with pattern detection
2. Add unit tests for pattern matching
3. Add stripping logic (not yet enabled)
4. **Files to modify:**
   - ✨ **NEW:** `src/agents/narration-detector.ts`
   - ✨ **NEW:** `src/agents/narration-detector.test.ts`

### Phase 2: Status Message Hook (Infrastructure)

1. Add `onNarrationStatus` callback type to agent runner options
2. Wire through `agent-runner-execution.ts` and `dispatch-from-config.ts`
3. Add config schema for enabling/disabling feature
4. **Files to modify:**
   - 📝 `src/auto-reply/reply/types.ts` (add callback type)
   - 📝 `src/auto-reply/reply/agent-runner-execution.ts` (wire callback)
   - 📝 `src/auto-reply/reply/dispatch-from-config.ts` (enable for WhatsApp)
   - 📝 `src/config/zod-schema.agents.ts` (add config)
   - 📝 `src/config/types.agents.ts` (add types)

### Phase 3: WhatsApp Integration (Feature Complete)

1. Enable narration detection in `onBlockReply` handler
2. Send narration as separate WhatsApp messages via `onNarrationStatus`
3. Strip narration from final output
4. **Files to modify:**
   - 📝 `src/auto-reply/reply/agent-runner-execution.ts` (enable detection)
   - 📝 `src/agents/pi-embedded-subscribe.handlers.messages.ts` (strip from final)

### Phase 4: Testing & Polish

1. Add integration tests for WhatsApp flow
2. Test edge cases (see below)
3. Add documentation
4. **Files to modify:**
   - ✨ **NEW:** `src/auto-reply/reply/agent-runner.narration-status.test.ts`
   - 📝 `docs/configuration.md` (document new config)

---

## Edge Cases & Considerations

### 1. Multiple Tool Calls

**Scenario:** Agent calls multiple tools in sequence

```
🔍 Searching...
📊 Analyzing the results...
📄 Reading file...
[Final response]
```

**Solution:** Each narration message is sent immediately when detected. No queueing needed.

### 2. Rapid Narration Spam

**Scenario:** Agent produces many narration lines quickly

**Solution:**

- Add a short debounce (200ms) to prevent flooding
- If multiple narration lines arrive in debounce window, send only the last one
- Alternative: Rate limit to max 1 narration message per 2 seconds

```typescript
let lastNarrationTime = 0;
const NARRATION_MIN_INTERVAL = 2000; // 2 seconds

if (narration.isNarration) {
  const now = Date.now();
  if (now - lastNarrationTime < NARRATION_MIN_INTERVAL) {
    return; // Skip this narration, too soon
  }
  lastNarrationTime = now;
  await sendNarrationStatus(narration);
}
```

### 3. Tool Errors

**Scenario:** Tool fails, but narration was already sent

```
🔍 Searching...
[Tool fails]
Agent: I encountered an error while searching.
```

**Solution:** This is fine! The status message reflects what the agent _tried_ to do. No special handling needed.

### 4. WhatsApp Rate Limiting

**Scenario:** WhatsApp API rate limits or throttles messages

**Solution:**

- Status messages use the same `dispatcher.dispatch` as tool summaries
- The dispatcher already handles queueing and throttling
- No special handling needed

### 5. Long-Running Tools

**Scenario:** Tool takes 30+ seconds to complete

**Solution:**

- Keep existing typing indicator mechanism
- Narration message sent at start: "🔍 Searching..."
- Typing indicator stays active throughout
- This is actually better UX than just typing alone!

### 6. Non-WhatsApp Channels

**Scenario:** Feature should only apply to WhatsApp

**Solution:**

- Gate the feature with `channel === "whatsapp"` check
- Other channels continue to use streaming or standard message delivery
- Code is isolated to WhatsApp-specific dispatch logic

### 7. Narration in Tool Results

**Scenario:** Tool result contains narration-like text

**Solution:**

- Only detect narration in `onBlockReply` (assistant text), not in tool results
- Tool results are already sent via `onToolResult` and should remain as-is

### 8. False Positives

**Scenario:** User message or quoted text triggers narration detection

**Example:**

```
User: Can you explain "Now let me search for files"?
Agent: "Now let me search for files" means...  ← Should NOT be stripped
```

**Solution:**

- Only apply detection to _streaming assistant blocks_, not final compiled text
- Add context-aware detection (e.g., don't detect within quotes)
- Allow configuration to disable feature per agent

---

## Configuration Example

**File:** `~/.openclaw/agents/main/config.toml` (or workspace config)

```toml
[agents]
# Enable live narration status messages for WhatsApp (default: true)
narrationStatusMessages = true

# Optional: Custom patterns
[[agents.narrationPatterns]]
pattern = "^Fetching data from"
emoji = "📡"
priority = 1

[[agents.narrationPatterns]]
pattern = "^Compiling results"
emoji = "⚙️"
priority = 2
```

---

## Benefits

1. **Better UX on WhatsApp** - Users see progress in real-time, not after the fact
2. **Cleaner Final Messages** - No duplicate "Searching..." after results are shown
3. **Consistent with Other Platforms** - Mimics streaming behavior on non-streaming channels
4. **Backward Compatible** - Can be disabled via config
5. **Extensible** - Pattern matching allows customization per workspace

---

## Alternative Approaches Considered

### Alternative 1: Send All Text as Streaming

**Idea:** Send every text delta as a separate WhatsApp message

**Rejected because:**

- Would spam users with many partial messages
- WhatsApp doesn't support message editing (unlike Discord, Slack)
- Existing chunker works well for long responses

### Alternative 2: Only Show Typing Indicator

**Idea:** Keep current behavior, just use typing indicator

**Rejected because:**

- Typing indicator is generic, doesn't tell user what's happening
- ChatGPT-style status messages are now user expectation
- No visibility into which tool is being used

### Alternative 3: Single "Working..." Message

**Idea:** Send one "⏳ Working..." message at start

**Rejected because:**

- Less informative than narration-specific messages
- Doesn't reflect what agent is actually doing
- Narration text already exists, just needs reordering

---

## Success Criteria

- [ ] Narration messages sent DURING tool execution, not after
- [ ] Final response does NOT contain narration text
- [ ] No duplicate messages
- [ ] Feature can be disabled via config
- [ ] Works correctly with multiple tool calls
- [ ] Doesn't spam users with excessive status messages
- [ ] No impact on non-WhatsApp channels
- [ ] Integration tests pass

---

## Files Summary

### New Files

- `src/agents/narration-detector.ts` - Pattern matching and detection
- `src/agents/narration-detector.test.ts` - Unit tests
- `src/auto-reply/reply/agent-runner.narration-status.test.ts` - Integration tests

### Modified Files

- `src/auto-reply/reply/types.ts` - Add `onNarrationStatus` callback type
- `src/auto-reply/reply/agent-runner-execution.ts` - Wire narration detection and callback
- `src/auto-reply/reply/dispatch-from-config.ts` - Enable for WhatsApp channel
- `src/agents/pi-embedded-subscribe.handlers.messages.ts` - Strip narration from final output
- `src/config/zod-schema.agents.ts` - Add configuration schema
- `src/config/types.agents.ts` - Add TypeScript types
- `docs/configuration.md` - Document new feature

---

## Next Steps

Since **issues are disabled** on `butley/openclaw`, recommended approach:

1. **Enable GitHub Issues** on the fork (recommended)
2. **OR** Create feature branch: `git checkout -b feature/whatsapp-narration-status`
3. **OR** Save this document to `docs/proposals/whatsapp-narration-status.md` in the repo
4. Discuss with team (tag @butley org members)
5. Implement in phases (safe, incremental changes)

---

## References

- **Streaming Architecture:** `src/agents/pi-embedded-subscribe.handlers.tools.ts`
- **Agent Runner:** `src/auto-reply/reply/agent-runner-execution.ts`
- **WhatsApp Outbound:** `src/channels/plugins/outbound/whatsapp.ts`, `src/web/outbound.ts`
- **Typing Controller:** `src/auto-reply/reply/typing.ts`
- **Tool Summaries:** `src/auto-reply/reply/dispatch-from-config.ts`
- **Config Schema:** `src/config/zod-schema.agents.ts`
