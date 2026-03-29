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

# Resolve registry URL: env var > existing config > Docker bridge default
def resolve_registry_url(existing_url=""):
    url = os.environ.get("AGENT_REGISTRY_URL", "").strip()
    if url:
        # Replace localhost/127.0.0.1 with Docker bridge gateway (containers can't reach host localhost)
        import re
        url = re.sub(r'(https?://)(?:localhost|127\.0\.0\.1)', r'\1172.17.0.1', url)
        return url
    if existing_url:
        return existing_url
    return ""

registry_url = resolve_registry_url()

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
    # Fix existing config: inject missing fields
    ar_ch = channels["agent-registry"]
    if "accounts" in ar_ch:
        for acc in ar_ch["accounts"]:
            # Inject API key if missing
            if api_key and "registryApiKey" not in acc:
                acc["registryApiKey"] = api_key
                changed = True
                print("[entrypoint] Injected registryApiKey into agent-registry channel")
            # Fix registryUrl if empty or pointing to localhost
            acc_url = acc.get("registryUrl", "")
            if registry_url and (not acc_url or "localhost" in acc_url or "127.0.0.1" in acc_url):
                acc["registryUrl"] = registry_url
                changed = True
                print(f"[entrypoint] Fixed agent-registry registryUrl to {registry_url}")
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

# Bootstrap runs in parallel — credentials, QMD indexing, gateway readiness, onboarding.
python3 /bootstrap.py &

# Gateway starts as PID 1 (receives signals properly).
exec openclaw gateway \
    --port "${OPENCLAW_PORT:-18789}" \
    --bind "${OPENCLAW_BIND:-lan}" \
    --allow-unconfigured \
    --verbose
