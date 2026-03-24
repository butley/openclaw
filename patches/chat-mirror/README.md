# P4 — Chat Mirror

**Branch:** `feat/rebase-3.22`
**Type:** Extracted → own file (hardened 2026-03-24)
**Files:** `src/gateway/chat-mirror.ts` (new), `src/gateway/server-chat.ts` (calls), `src/gateway/server-methods/chat.ts` (schema + propagation), `src/gateway/protocol/schema/logs-chat.ts` (schema), `src/infra/agent-events.ts` (merge logic)

## What It Does

When `mirror: true` is set on `chat.send`, AI responses from webchat are relayed to the session's original channel (e.g., WhatsApp). Core Butley functionality — webchat→WA delivery.

## Architecture

### Flow
1. **Schema** — `ChatSendParamsSchema` in `logs-chat.ts` declares `mirror: Type.Optional(Type.Boolean())`
2. **Handler** — `chat.ts` casts `mirror` from params, passes to `registerAgentRunContext(runId, { mirror: p.mirror })` in `onAgentRunStart`
3. **Merge** — `agent-events.ts` `registerAgentRunContext()` merges `mirror` into existing context (required because context is created first by `agent-runner-execution.ts` without mirror, then updated by `onAgentRunStart`)
4. **Delivery** — `maybeMirrorToChannel(sessionKey, runId, text)` in `chat-mirror.ts` reads `getAgentRunContext(runId).mirror` and sends via `sendMessageWhatsApp`

### Key Detail
`registerAgentRunContext` uses field-by-field merge (not spread) when context already exists. Each fork field (`mirror`, etc.) MUST have an explicit merge clause — otherwise it's silently dropped. This was a bug in the initial v3.22 rebase (mirror was set but never merged into existing context).

### `maybeMirrorToChannel`
1. Parses `channel` + `peerId` from sessionKey format `agent:{id}:{channel}:{kind}:{peer}`
2. Validates WA channel
3. Calls `sendMessageWhatsApp`

Called from both success and error paths in `server-chat.ts`.

## History

- **Original:** 20-line mirror block copy-pasted in 2 places in `server-chat.ts` (Guilherme)
- **Hardened (2026-03-24):** Extracted to `chat-mirror.ts` — single function, 2 one-line call sites
- **v3.22 rebase fix (2026-03-24):** Added `mirror` to `ChatSendParamsSchema` (v3.22 added `additionalProperties: false` which rejected unknown fields), propagation in `chat.ts`, and merge clause in `agent-events.ts`

## Merge Resilience

**Low conflict** — own file for delivery logic. Schema/handler changes are 1-2 lines each.

**Watch for:** If upstream adds more fields to `registerAgentRunContext` merge logic, our `mirror` clause stays safe. If upstream changes `ChatSendParamsSchema` to a different validation lib, mirror field needs re-adding.

## Verify

```bash
test -f src/gateway/chat-mirror.ts && echo "OK" || echo "MISSING"
grep -q 'maybeMirrorToChannel' src/gateway/server-chat.ts && echo "OK" || echo "MISSING"
grep -q 'mirror.*Type.Optional' src/gateway/protocol/schema/logs-chat.ts && echo "OK" || echo "MISSING"
grep -q 'context.mirror' src/infra/agent-events.ts && echo "OK" || echo "MISSING"
```

## Author

Bob + Guilherme (original), Bob (extraction + v3.22 fix) — webchat→WA cross-channel for Butley.
