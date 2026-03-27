# Context Harvester Setup Guide

## Overview

The Context Harvester is a cron-based tool that generates live context snapshots by:
1. Reading active sessions every 30 minutes
2. Sending recent messages to DeepSeek for summarization
3. Writing a concise `CONTEXT.md` to the workspace

**Key point:** The script runs from the **agent's workspace** (e.g., `~/clawd/tools/context-harvester/`), not from the OpenClaw repo.

## Installation per Agent

For each OpenClaw agent that should run the harvester:

### 1. Create the tool directory
```bash
mkdir -p ~/clawd/tools/context-harvester
cd ~/clawd/tools/context-harvester
```

### 2. Copy the script files
```bash
# From this repo
cp docker/agent/context-harvester-files/* ~/clawd/tools/context-harvester/
```

Or manually create:
- `harvester.ts` — Main TypeScript script
- `package.json` — Dependencies (openai, dotenv)
- `tsconfig.json` — TypeScript config
- `run.sh` — Executable wrapper
- `.env` — API keys (gitignored)
- `.gitignore` — Ignore node_modules and .env

### 3. Install dependencies
```bash
cd ~/clawd/tools/context-harvester
npm install
```

### 4. Configure API key
```bash
# Create .env
echo "DEEPSEEK_API_KEY=sk_your_key_here" > .env
```

### 5. Test the script
```bash
bash run.sh
# Should output: ~/clawd/memory/CONTEXT.md updated
```

## Cron Job Configuration

Add to agent's `~/.openclaw/openclaw.json`:

```json
{
  "agents": {
    "cron": {
      "jobs": [
        {
          "name": "context-harvester",
          "schedule": {
            "kind": "every",
            "everyMs": 1800000
          },
          "sessionTarget": "isolated",
          "payload": {
            "kind": "agentTurn",
            "message": "Run the context harvester script: cd ~/clawd/tools/context-harvester && bash run.sh. Report a brief summary of what changed (sessions scanned, messages collected, topics added/removed). If it fails, report the error."
          },
          "delivery": {
            "mode": "none"
          },
          "enabled": true
        }
      ]
    }
  }
}
```

## How It Works

### Execution Flow
1. **Every 30 min:** Cron fires in isolated subagent session
2. **Script runs:** `cd ~/clawd/tools/context-harvester && bash run.sh`
3. **Sessions scanned:** Reads `~/.openclaw/agents/main/sessions/*.jsonl`
4. **Messages extracted:** Grabs last 60 min of messages from active sessions
5. **DeepSeek call:** Sends to API with current CONTEXT.md
6. **File written:** Updates `~/clawd/memory/CONTEXT.md` with new snapshot
7. **Subagent reports:** Brief summary sent to main session (no delivery = silent)

### Output Format
```markdown
# CONTEXT.md - Live Context Map
> Last updated: 2026-03-27T02:19:01Z
> Sessions scanned: 14 | New messages: 137

## 👤 [Person Name]
### [Channel]
#### [Topic]
- Status: 🟡 IN PROGRESS / ✅ DONE / ⏳ WAITING
```

**Key design:** File is rewritten each cycle, not appended. Completed topics naturally disappear.

## Troubleshooting

### Script fails with SIGKILL
- Cron timeout (>5 min execution)
- Reduce session window or message limit in `harvester.ts`

### DeepSeek API errors
- Check `.env` has valid key
- Script retries 3x automatically
- Check rate limits at DeepSeek console

### CONTEXT.md not updating
- Check that `~/clawd/memory/` directory exists
- Check script permissions: `chmod +x run.sh`
- Run manually: `bash run.sh` and check output

### Sessions not found
- Ensure `~/.openclaw/agents/main/sessions/` exists
- At least one active session required
- Script handles zero sessions gracefully

## Performance

- **Typical execution:** 30-60 seconds
- **Sessions per cycle:** 10-20
- **Messages per cycle:** 100-300
- **Output file size:** 2-5KB

## Privacy

- Script filters sessions with "private" in label (customizable)
- Only reads message text and metadata
- DeepSeek API call is made — ensure API key is secure

## Files Reference

- **harvester.ts:** Main script, edit for customization
- **run.sh:** Wrapper that sources .env and runs via npx tsx
- **package.json:** Dependencies (openai, dotenv, tsx)
- **tsconfig.json:** TypeScript configuration
- **.env:** API keys (never commit!)
- **.gitignore:** Excludes node_modules and .env

## Production Checklist

- [ ] `npm install` completed without errors
- [ ] `.env` created with DEEPSEEK_API_KEY
- [ ] `run.sh` tested manually: `bash run.sh`
- [ ] Cron config added to `openclaw.json`
- [ ] Gateway restarted after config change
- [ ] First cron execution verified (check logs)
- [ ] CONTEXT.md being updated every 30 min

## Integration with Butley

For Butley agents:
1. Include context-harvester files in docker build
2. Set DEEPSEEK_API_KEY via secret/vault
3. Add cron config to reference template
4. Document in CONTEXT-HARVESTER-CRON-CONFIG.md
