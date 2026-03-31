#!/bin/bash
set -e

# Cleanup function for graceful shutdown
cleanup() {
    echo "[entrypoint] Shutting down..."
}
trap cleanup EXIT TERM INT

# Add bun to PATH (for QMD memory search)
export PATH="/root/.bun/bin:$PATH"

# Sync platform extensions from image to mounted volume (manifest-driven)
if [ -f /opt/openclaw/scripts/sync-platform.sh ]; then
    bash /opt/openclaw/scripts/sync-platform.sh
fi

# Apply baked extension configs (agent-registry, butley-api)
if [ -f /root/.openclaw/openclaw.json ]; then
    python3 - <<'PYEOF'
import json
import os

config_path = "/root/.openclaw/openclaw.json"
with open(config_path, "r") as f:
    config = json.load(f)

plugins = config.setdefault("plugins", {})
entries = plugins.setdefault("entries", {})

registry_url = os.environ.get("AGENT_REGISTRY_URL", "").strip()

# Enable agent-registry plugin if not already configured
if "agent-registry" not in entries:
    if registry_url:
        entries["agent-registry"] = {
            "enabled": True,
            "config": {
                "registryUrl": registry_url
            }
        }
        changed = True
        print(f"[entrypoint] Enabled agent-registry plugin (url={registry_url})")
    else:
        changed = False
        print("[entrypoint] Skipping agent-registry plugin — no AGENT_REGISTRY_URL configured")
else:
    # Update registryUrl if env var provides one and existing is empty
    existing_cfg = entries["agent-registry"].get("config", {})
    existing_url = existing_cfg.get("registryUrl", "")
    if registry_url and not existing_url:
        existing_cfg["registryUrl"] = registry_url
        entries["agent-registry"]["config"] = existing_cfg
        changed = True
        print(f"[entrypoint] Updated agent-registry plugin registryUrl to {registry_url}")
    else:
        changed = False
        print("[entrypoint] agent-registry plugin already configured")

# Enable agent-registry channel with default account
# Channels config is channels.<channel-id>, not channels.entries.<channel-id>
channels = config.setdefault("channels", {})
api_key = os.environ.get("AGENT_REGISTRY_API_KEY", "").strip()

if "agent-registry" not in channels:
    if registry_url:
        # Use INSTALLATION_ID env var as hostname, fallback to container hostname
        import socket
        hostname = os.environ.get("INSTALLATION_ID", socket.gethostname())
        
        account = {
            "id": "default",
            "hostname": hostname,
            "registryUrl": registry_url
        }
        if api_key:
            account["registryApiKey"] = api_key
        channels["agent-registry"] = {"accounts": [account]}
        changed = True
        print(f"[entrypoint] Added agent-registry channel (hostname={hostname}, url={registry_url})")
    else:
        print("[entrypoint] Skipping agent-registry channel — no registry URL")
else:
    # Inject missing fields into existing config
    ar_ch = channels["agent-registry"]
    if "accounts" in ar_ch:
        for acc in ar_ch["accounts"]:
            if api_key and "registryApiKey" not in acc:
                acc["registryApiKey"] = api_key
                changed = True
                print("[entrypoint] Injected registryApiKey into agent-registry channel")
            if registry_url and not acc.get("registryUrl", ""):
                acc["registryUrl"] = registry_url
                changed = True
                print(f"[entrypoint] Set agent-registry registryUrl to {registry_url}")
    if not changed:
        print("[entrypoint] agent-registry channel already configured")

# Set session.dmScope to "per-channel-peer" for isolated DM sessions per peer
session = config.setdefault("session", {})
if session.get("dmScope") != "per-channel-peer":
    session["dmScope"] = "per-channel-peer"
    changed = True
    print("[entrypoint] Set session.dmScope to per-channel-peer")

if changed:
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
PYEOF
fi

# Export gateway token — must happen before exec so the gateway process inherits it.
if [ -f /root/.openclaw/gateway-credentials.json ]; then
    export OPENCLAW_GATEWAY_TOKEN=$(python3 -c \
        "import json; print(json.load(open('/root/.openclaw/gateway-credentials.json'))['gatewayToken'])")
fi

# P2P WebSocket communication is handled natively by the plugin
echo "[entrypoint] P2P WebSocket ready (no daemon required)"

# Bootstrap runs in parallel — credentials, QMD indexing, gateway readiness, onboarding.
python3 /bootstrap.py &

# Gateway starts as PID 1 (receives signals properly).
exec openclaw gateway \
    --port "${OPENCLAW_PORT:-18789}" \
    --bind "${OPENCLAW_BIND:-lan}" \
    --allow-unconfigured \
    --verbose
