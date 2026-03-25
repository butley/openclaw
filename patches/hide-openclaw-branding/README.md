# Patch #38 — Hide OpenClaw Branding from Agent System Prompt

## Problem

The `BUTLEY_IDENTITY_PROMPT` (patch #36) instructs the agent to never reveal its framework/platform/runtime name. However, the rest of `system-prompt.ts` still contained ~12 references to "OpenClaw" in tool descriptions, section headers, and documentation lines. The LLM sees the full concatenated prompt, creating a contradiction: "never mention OpenClaw" alongside repeated mentions of "OpenClaw."

## Solution

Replaced all user-visible "OpenClaw" references in `system-prompt.ts` with neutral terms:

| Before | After |
|--------|-------|
| `OpenClaw handles all routing internally` | `the runtime handles all routing internally` |
| `OpenClaw docs: ${docsPath}` | `Documentation: ${docsPath}` |
| `OpenClaw CLI Quick Reference` | `CLI Quick Reference` |
| `OpenClaw Self-Update` | `Self-Update` |
| `OpenClaw pings the last active session` | `the runtime pings the last active session` |
| `control OpenClaw's dedicated browser` | `control the dedicated browser` |
| `OpenClaw treats HEARTBEAT_OK` | `The runtime treats HEARTBEAT_OK` |
| `running OpenClaw process` (gateway desc) | `running gateway process` |
| `OpenClaw agent ids` (agents_list desc) | `agent ids` |
| `For OpenClaw behavior...` | `For runtime behavior...` |
| `run openclaw status yourself` | `check runtime status yourself` |

### Kept as-is:
- CLI commands (`openclaw gateway start/stop/restart`) — internal tool invocations, not user-facing text
- Documentation links (docs.openclaw.ai, github, community, clawhub) — useful for agent self-research

## Scope

- **File:** `src/agents/system-prompt.ts`
- **Category:** Agents

## Verification

```bash
# No user-visible "OpenClaw" in system prompt (excluding imports and comments)
! grep -n "OpenClaw" src/agents/system-prompt.ts | grep -v "import\|//"
```

## Depends On

- Patch #36 (Butley System Prompt) — provides the `BUTLEY_IDENTITY_PROMPT` identity block
