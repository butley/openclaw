#!/bin/bash
set -e

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

# Enable agent-registry plugin if not already configured
if "agent-registry" not in entries:
    entries["agent-registry"] = {
        "enabled": True,
        "config": {
            "registryUrl": os.environ.get("AGENT_REGISTRY_URL", "")
        }
    }
    changed = True
    print("[entrypoint] Enabled agent-registry plugin")
else:
    changed = False
    print("[entrypoint] agent-registry plugin already configured")

# Enable agent-registry channel with default account
# Channels config is channels.<channel-id>, not channels.entries.<channel-id>
channels = config.setdefault("channels", {})
if "agent-registry" not in channels:
    channels["agent-registry"] = {
        "accounts": [{
            "id": "default",
            "registryUrl": os.environ.get("AGENT_REGISTRY_URL", "")
        }]
    }
    changed = True
    print("[entrypoint] Added agent-registry channel account")
else:
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

# Bootstrap runs in parallel — credentials, QMD indexing, gateway readiness, onboarding.
python3 /bootstrap.py &

# Gateway starts as PID 1 (receives signals properly).
exec openclaw gateway \
    --port "${OPENCLAW_PORT:-18789}" \
    --bind "${OPENCLAW_BIND:-lan}" \
    --allow-unconfigured \
    --verbose
