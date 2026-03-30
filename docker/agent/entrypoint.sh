#!/bin/bash
set -e

# Cleanup function for graceful shutdown
cleanup() {
    echo "[entrypoint] Shutting down..."
    # Stop Pilot daemon if running
    if command -v pilotctl &> /dev/null; then
        pilotctl daemon stop 2>/dev/null || true
    fi
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

# Start Pilot Protocol daemon for P2P agent communication
if command -v pilot-daemon &> /dev/null; then
    # Use INSTALLATION_ID as hostname if available
    PILOT_HOSTNAME="${INSTALLATION_ID:-agent-$(hostname | cut -c1-8)}"
    # Email must be unique per agent to get unique Node ID from registry
    PILOT_EMAIL="agent-${INSTALLATION_ID:-$(hostname)}@butley.ai"
    
    # Init config (creates /root/.pilot/identity.json if not exists)
    # The identity directory is mounted as a volume, so trust is preserved across restarts
    pilotctl init --non-interactive 2>/dev/null || true
    
    # Get public IP and port from environment (set by orchestrator)
    PUBLIC_IP="${PILOT_PUBLIC_IP:-}"
    PILOT_PORT="${PILOT_PORT:-30000}"
    
    # Start daemon directly with fixed endpoint (skips STUN)
    if [ -n "$PUBLIC_IP" ]; then
        # Create identity directory — mounted as volume for persistence
        mkdir -p /root/.pilot
        
        # Use fixed endpoint mode with persistent identity
        # -identity preserves Ed25519 keypair and trust relationships across restarts
        pilot-daemon -hostname "$PILOT_HOSTNAME" -email "$PILOT_EMAIL" \
            -listen ":${PILOT_PORT}" \
            -endpoint "${PUBLIC_IP}:${PILOT_PORT}" \
            -identity /root/.pilot/identity.json \
            >> /root/.pilot/pilot.log 2>&1 &
        echo "[entrypoint] Pilot daemon started with fixed endpoint ${PUBLIC_IP}:${PILOT_PORT} (hostname=$PILOT_HOSTNAME)"
    else
        # Fallback to pilotctl daemon start (STUN mode)
        pilotctl daemon start --hostname "$PILOT_HOSTNAME" --email "$PILOT_EMAIL" --background 2>/dev/null && \
            echo "[entrypoint] Pilot Protocol daemon started in STUN mode (hostname=$PILOT_HOSTNAME)" || \
            echo "[entrypoint] Pilot Protocol daemon failed to start (optional, continuing...)"
    fi
fi

# Bootstrap runs in parallel — credentials, QMD indexing, gateway readiness, onboarding.
python3 /bootstrap.py &

# Gateway starts as PID 1 (receives signals properly).
exec openclaw gateway \
    --port "${OPENCLAW_PORT:-18789}" \
    --bind "${OPENCLAW_BIND:-lan}" \
    --allow-unconfigured \
    --verbose
