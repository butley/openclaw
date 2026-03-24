# QMD Memory Backend Setup Guide

**For:** OpenClaw v2026.2.2+ (any installation using the Butley fork or upstream)  
**What it does:** Replaces the built-in SQLite memory indexer with QMD — a local search engine that combines BM25 + vector embeddings + reranking for better memory recall.

---

## Prerequisites

- OpenClaw `>= 2026.2.2` (QMD support was added in this version)
- Linux or macOS

## Step 1: Install Bun

QMD runs on Bun (a fast JS runtime). Install it:

```bash
curl -fsSL https://bun.sh/install | bash
```

Then add to your PATH:

```bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

Verify:

```bash
bun --version
# Expected: 1.x.x
```

## Step 2: Install QMD

```bash
bun add -g tobi/qmd
```

Verify:

```bash
qmd --help
# Should show QMD commands
```

## Step 3: Ensure QMD is on Gateway PATH

If running OpenClaw via systemd, the service needs `~/.bun/bin` in its PATH.

Check your service file:

```bash
systemctl --user cat openclaw-gateway
# or
systemctl --user cat clawdbot-gateway
```

Look for the `Environment=PATH=...` line. If `~/.bun/bin` is NOT listed, add it:

```bash
systemctl --user edit openclaw-gateway
```

Add under `[Service]`:

```
Environment="PATH=/home/YOUR_USER/.bun/bin:/home/YOUR_USER/.local/bin:/usr/local/bin:/usr/bin:/bin"
```

Then reload:

```bash
systemctl --user daemon-reload
```

## Step 4: Enable QMD in Config

Add to your OpenClaw config (`~/.openclaw/openclaw.json` or `~/.clawdbot/clawdbot.json`):

```json
{
  "memory": {
    "backend": "qmd",
    "citations": "auto",
    "qmd": {
      "includeDefaultMemory": true,
      "update": {
        "interval": "5m",
        "debounceMs": 15000
      },
      "limits": {
        "maxResults": 6,
        "timeoutMs": 4000
      }
    }
  }
}
```

Or if the agent has gateway tool access, use:

```
/config memory.backend qmd
```

## Step 5: Restart Gateway

```bash
systemctl --user restart openclaw-gateway
# or
openclaw gateway restart
```

## Step 6: First-Time Embedding (Slow!)

The first time QMD runs, it:

1. Downloads embedding model (~300MB): `embeddinggemma-300M-Q8_0`
2. Downloads reranker model: `qwen3-reranker-0.6b-q8_0`
3. Downloads generation model: `Qwen3-0.6B-Q8_0`
4. Indexes all memory files and generates embeddings

**This can take 5-10 minutes on first run.** Subsequent runs are fast (<10s).

To trigger manually and warm up models:

```bash
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
export XDG_CONFIG_HOME="$STATE_DIR/agents/main/qmd/xdg-config"
export XDG_CACHE_HOME="$STATE_DIR/agents/main/qmd/xdg-cache"

qmd update
qmd embed
qmd query "test" -c memory-root --json >/dev/null 2>&1
```

## Step 7: Verify

Check QMD status (using gateway's XDG dirs):

```bash
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
export XDG_CONFIG_HOME="$STATE_DIR/agents/main/qmd/xdg-config"
export XDG_CACHE_HOME="$STATE_DIR/agents/main/qmd/xdg-cache"

qmd status
```

Expected output should show:

- Documents indexed > 0
- Vectors embedded > 0
- Collections with your memory files

## How It Works

- OpenClaw writes memory files (`MEMORY.md`, `memory/*.md`) as usual
- QMD indexes them every 5 minutes (configurable)
- When `memory_search` is called, OpenClaw runs `qmd query --json` instead of its built-in SQLite search
- Results combine BM25 keyword matching + vector similarity + reranking
- If QMD fails for any reason, OpenClaw **falls back to the built-in SQLite search** automatically

## Troubleshooting

**QMD binary not found:**

- Check `which qmd` — should point to `~/.bun/bin/qmd`
- Ensure PATH includes `~/.bun/bin` in the systemd service

**No documents indexed:**

- Run `qmd update` manually with the XDG env vars
- Check that workspace has `MEMORY.md` or `memory/*.md` files

**Embedding stuck/slow:**

- First run downloads ~1GB of models. Be patient.
- Check CPU usage: `ps aux | grep qmd`
- If no GPU available, it runs on CPU (slower but works)

**Memory search returns nothing:**

- Check `openclaw memory status` — should show `backend: qmd`
- Ensure embeddings were generated: `qmd status` should show Vectors > 0

---

**Source:** OpenClaw docs `docs/concepts/memory.md`, changelog `2026.2.2`  
**Last updated:** 2026-02-05
