# Context Harvester

Scans active OpenClaw sessions and generates a live briefing at `~/clawd/memory/CONTEXT.md` using DeepSeek Chat.

## How it works

1. Fetches active sessions (last 60 min) via `openclaw sessions --json --active 60`
2. Reads message history for each non-private session
3. Loads existing `CONTEXT.md` (if any)
4. Sends everything to DeepSeek Chat to produce an updated snapshot
5. Overwrites `~/clawd/memory/CONTEXT.md`

**CONTEXT.md is a live snapshot, not a log.** Each run rewrites it from scratch. Resolved topics disappear naturally. Only active/relevant topics survive.

## Setup

```bash
cd ~/clawd/tools/context-harvester
npm install
```

## Run

```bash
bash run.sh
# or directly:
npx tsx harvester.ts
```

## Configuration

- `.env` — `DEEPSEEK_API_KEY` for the DeepSeek Chat API
- Sessions with "private" in their label are automatically filtered out

## Dependencies

- `openai` — OpenAI-compatible SDK (used with DeepSeek endpoint)
- `dotenv` — env file loader
- `tsx` — TypeScript runner (no build step)
