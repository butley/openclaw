# Running OpenClaw from Source on Custom Port

Guide for running a development instance of OpenClaw (or butley/openclaw fork) from source code on an alternate port without conflicting with production.

**Author:** Gee (via Guilherme)  
**Date:** 2026-02-03

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Build source
pnpm build

# 3. Build Control UI
pnpm ui:build

# 4. Configure isolated profile (example: "test")
node dist/entry.js --profile test config set gateway.mode local
node dist/entry.js --profile test config set gateway.port 18795
node dist/entry.js --profile test config set canvasHost.enabled false

# 5. Run with environment override (most reliable)
OPENCLAW_GATEWAY_PORT=18795 OPENCLAW_SKIP_CANVAS_HOST=1 \
  node dist/entry.js --profile test gateway run --force --verbose
```

## How It Works

### Profile System

`--profile <name>` creates isolated state in `~/.openclaw-<name>/`:
- Separate config
- Separate credentials
- Separate session logs
- No conflicts with other profiles

Example profiles:
- `test` → `~/.openclaw-test/`
- `dev` → `~/.openclaw-dev/`
- `staging` → `~/.openclaw-staging/`

### Port Configuration Precedence

When OpenClaw starts, it respects this priority order:

1. **Environment variable** (highest): `OPENCLAW_GATEWAY_PORT`
2. **CLI flag**: `--port 18795`
3. **Config file**: `gateway.port` in `~/.openclaw-<profile>/config.json`
4. **Default** (lowest): `18789`

This means env vars always win, making them most reliable for dev instances.

### Canvas Host Configuration

Canvas Host runs on port `18790` by default. For dev instances:

**Option A: Disable Canvas (simpler)**
```bash
OPENCLAW_SKIP_CANVAS_HOST=1 node dist/entry.js --profile test gateway run
```

**Option B: Use different port**
```bash
OPENCLAW_CANVAS_HOST_PORT=18796 node dist/entry.js --profile test gateway run
```

### Force Flag

`--force` uses `lsof` to kill any existing listeners on the target port before starting.

Useful when:
- Process didn't shut down cleanly
- Port is still bound from previous run
- You want guaranteed port availability

## Real-World Example

Running butley/openclaw dev branch on port 18795:

```bash
cd ~/path/to/butley/openclaw

# First time setup
pnpm install
pnpm build
pnpm ui:build

node dist/entry.js --profile dev config set gateway.mode local
node dist/entry.js --profile dev config set gateway.port 18795
node dist/entry.js --profile dev config set canvasHost.enabled false

# Start (and restart later)
OPENCLAW_GATEWAY_PORT=18795 OPENCLAW_SKIP_CANVAS_HOST=1 \
  node dist/entry.js --profile dev gateway run --force --verbose
```

Now you have:
- **Production**: Running on 18789 (via `npm install -g`)
- **Dev fork**: Running on 18795 (from source)
- **No conflicts**: Separate configs, credentials, state

## Logs & Debugging

Check logs for the dev instance:

```bash
tail -f ~/.openclaw-test/logs/gateway.log
```

View all profiles:

```bash
ls -la ~/ | grep openclaw
```

## Cleanup

To remove a dev profile:

```bash
rm -rf ~/.openclaw-test/
```

This deletes:
- Config
- Credentials
- Session logs
- State

**Warning:** This is non-recoverable. Only do this for temporary dev instances.

## Troubleshooting

**Port already in use:**
```bash
# Check what's using the port
lsof -i :18795

# Use --force to auto-kill
OPENCLAW_GATEWAY_PORT=18795 node dist/entry.js --profile test gateway run --force
```

**Config not applying:**
- Verify: `cat ~/.openclaw-<profile>/config.json`
- Env vars take precedence: use them if config doesn't stick
- Try deleting the profile and recreating

**Canvas Host conflicts:**
```bash
# Use SKIP to disable completely
OPENCLAW_SKIP_CANVAS_HOST=1 node dist/entry.js --profile test gateway run

# Or move to different port
OPENCLAW_CANVAS_HOST_PORT=18796 node dist/entry.js --profile test gateway run
```

---

**Updated:** 2026-02-03
