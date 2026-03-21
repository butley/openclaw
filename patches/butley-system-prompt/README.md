# Butley System Prompt

**Scope:** Agents
**Depends on:** None

## What It Does

Replaces the hardcoded OpenClaw identity line with a comprehensive Butley-specific system prompt. The new prompt:

1. Never reveals the underlying framework, platform, or runtime by name
2. Implements a response filter that mechanically prevents leaking file names, paths, and infrastructure details
3. Provides internal file routing so the agent knows where to store different types of changes
4. Includes behavioral guidelines, memory handling, and native tool usage rules

## Files Modified

| File | Change |
|------|--------|
| `src/agents/butley-system-prompt.ts` | NEW — exports `BUTLEY_IDENTITY_PROMPT` constant |
| `src/agents/butley-system-prompt.md` | NEW — markdown source for the prompt (reference) |
| `src/agents/system-prompt.ts` | Import + use `BUTLEY_IDENTITY_PROMPT` instead of hardcoded string |

## How It Works

1. `butley-system-prompt.ts` exports a single constant `BUTLEY_IDENTITY_PROMPT` containing the full prompt
2. `system-prompt.ts` imports this constant and uses it in both:
   - The "none" mode return (just the identity block)
   - The full prompt mode (as the opening block)
3. The prompt includes:
   - **Response Filter**: Mechanical rules to prevent leaking internal file names, paths, infrastructure
   - **Internal Routing**: Silent mapping of user change requests to correct files
   - **Memory/Files**: Guidelines for memory persistence and user-uploaded files
   - **Pending Actions**: Cross-session context bridging mechanism
   - **Native Tool Usage**: TTS, voice, and messaging channel rules

## Re-apply

1. Create `src/agents/butley-system-prompt.ts` — exports `BUTLEY_IDENTITY_PROMPT` constant
2. Create `src/agents/butley-system-prompt.md` — markdown reference (not read at runtime)
3. In `src/agents/system-prompt.ts`:
   - Import: `import { BUTLEY_IDENTITY_PROMPT } from "./butley-system-prompt.js"`
   - Replace both occurrences of `"You are a personal assistant running inside OpenClaw."` with `BUTLEY_IDENTITY_PROMPT`

Key details:
- The identity line appears twice in `system-prompt.ts` — once for `promptMode === "none"` return, once at the start of the `lines` array
- The markdown file is for documentation/reference only; the actual prompt is the TS constant
- Response filter rules must NOT include specific path names (they would leak in the prompt itself)

## Verify

```bash
test -f src/agents/butley-system-prompt.ts && echo "OK" || echo "MISSING"
grep -q "BUTLEY_IDENTITY_PROMPT" src/agents/system-prompt.ts && echo "OK" || echo "MISSING"
```
