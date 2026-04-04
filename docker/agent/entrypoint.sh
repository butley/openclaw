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
import socket
from copy import deepcopy

config_path = "/root/.openclaw/openclaw.json"
auth_profiles_path = "/root/.openclaw/agents/main/agent/auth-profiles.json"

OPENAI_PRIMARY = "openai/gpt-5.4"
OPENAI_FALLBACKS = [
    "openai/gpt-5.2",
    "openai/gpt-5-mini",
]


def load_json_file(path):
    try:
        with open(path, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        return None
    except Exception as e:
        print(f"[entrypoint] Warning: could not read {path}: {e}")
        return None


def write_json_if_changed(path, original, updated):
    if updated != original:
        with open(path, "w") as f:
            json.dump(updated, f, indent=2)
        return True
    return False


config = load_json_file(config_path)
if not isinstance(config, dict):
    print(f"[entrypoint] Warning: {config_path} is missing or malformed; skipping config patching")
else:
    changed = False
    plugins = config.setdefault("plugins", {})
    entries = plugins.setdefault("entries", {})

    registry_url = os.environ.get("AGENT_REGISTRY_URL", "").strip()

    # Force default model to OpenAI GPT-5.4 and keep fallbacks OpenAI-first.
    agents = config.setdefault("agents", {})
    defaults = agents.setdefault("defaults", {})
    model_defaults = defaults.setdefault("model", {})
    if model_defaults.get("primary") != OPENAI_PRIMARY:
        model_defaults["primary"] = OPENAI_PRIMARY
        changed = True
        print(f"[entrypoint] Set agents.defaults.model.primary to {OPENAI_PRIMARY}")

    existing_fallbacks = model_defaults.get("fallbacks")
    if not isinstance(existing_fallbacks, list):
        existing_fallbacks = []

    seen = set()
    normalized_fallbacks = []
    for model in OPENAI_FALLBACKS:
        if model not in seen:
            normalized_fallbacks.append(model)
            seen.add(model)
    for model in existing_fallbacks:
        if not isinstance(model, str):
            continue
        normalized = model.strip()
        if not normalized or normalized.startswith("anthropic/") or normalized in seen or normalized == OPENAI_PRIMARY:
            continue
        normalized_fallbacks.append(normalized)
        seen.add(normalized)

    if model_defaults.get("fallbacks") != normalized_fallbacks:
        model_defaults["fallbacks"] = normalized_fallbacks
        changed = True
        print(f"[entrypoint] Set agents.defaults.model.fallbacks to {normalized_fallbacks}")

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
            print("[entrypoint] agent-registry plugin already configured")

    # Enable agent-registry channel with default account
    # Channels config is channels.<channel-id>, not channels.entries.<channel-id>
    channels = config.setdefault("channels", {})
    api_key = os.environ.get("AGENT_REGISTRY_API_KEY", "").strip()

    if "agent-registry" not in channels:
        if registry_url:
            # Use INSTALLATION_ID env var as hostname, fallback to container hostname
            hostname = os.environ.get("INSTALLATION_ID", socket.gethostname())

            account = {
                "id": "default",
                "enabled": True,
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
                if "enabled" not in acc:
                    acc["enabled"] = True
                    changed = True
                    print("[entrypoint] Set agent-registry account enabled=true")
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

# Migrate persisted auth state away from Anthropic and toward OpenAI placeholders.
auth_profiles = load_json_file(auth_profiles_path)
if auth_profiles is None:
    pass
elif not isinstance(auth_profiles, dict):
    print(f"[entrypoint] Warning: {auth_profiles_path} is malformed; skipping auth profile migration")
else:
    original_auth_profiles = deepcopy(auth_profiles)

    profiles = auth_profiles.get("profiles")
    if not isinstance(profiles, list):
        profiles = []

    filtered_profiles = []
    openai_profile_ids = []
    for profile in profiles:
        if not isinstance(profile, dict):
            filtered_profiles.append(profile)
            continue
        provider = str(profile.get("provider", "")).strip().lower()
        if provider == "anthropic":
            continue
        filtered_profiles.append(profile)
        if provider == "openai":
            profile_id = profile.get("id")
            if isinstance(profile_id, str) and profile_id.strip():
                openai_profile_ids.append(profile_id)

    auth_profiles["profiles"] = filtered_profiles

    if not openai_profile_ids:
        placeholder_profile = {
            "id": "openai-placeholder",
            "provider": "openai",
            "label": "OpenAI (placeholder)",
            "placeholder": True,
        }
        auth_profiles["profiles"].append(placeholder_profile)
        openai_profile_ids.append(placeholder_profile["id"])
        print("[entrypoint] Added OpenAI auth placeholder profile")

    last_good = auth_profiles.get("lastGood")
    if not isinstance(last_good, dict):
        last_good = {}
    if "anthropic" in last_good:
        last_good.pop("anthropic", None)
        print("[entrypoint] Removed lastGood.anthropic")
    if openai_profile_ids:
        preferred_openai_id = openai_profile_ids[0]
        if last_good.get("openai") != preferred_openai_id:
            last_good["openai"] = preferred_openai_id
            print(f"[entrypoint] Set lastGood.openai to {preferred_openai_id}")
    auth_profiles["lastGood"] = last_good

    if write_json_if_changed(auth_profiles_path, original_auth_profiles, auth_profiles):
        print("[entrypoint] Migrated auth-profiles.json to OpenAI-first state")
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
