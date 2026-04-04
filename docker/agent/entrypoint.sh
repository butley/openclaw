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

DEFAULT_PRIMARY = "deepseek/deepseek-chat"
DEFAULT_FALLBACKS = [
    "deepseek/deepseek-reasoner",
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

    # Force default model to DeepSeek chat and keep fallbacks DeepSeek-first.
    agents = config.setdefault("agents", {})
    defaults = agents.setdefault("defaults", {})
    model_defaults = defaults.setdefault("model", {})
    if model_defaults.get("primary") != DEFAULT_PRIMARY:
        model_defaults["primary"] = DEFAULT_PRIMARY
        changed = True
        print(f"[entrypoint] Set agents.defaults.model.primary to {DEFAULT_PRIMARY}")

    existing_fallbacks = model_defaults.get("fallbacks")
    if not isinstance(existing_fallbacks, list):
        existing_fallbacks = []

    seen = set()
    normalized_fallbacks = []
    for model in DEFAULT_FALLBACKS:
        if model not in seen:
            normalized_fallbacks.append(model)
            seen.add(model)
    for model in existing_fallbacks:
        if not isinstance(model, str):
            continue
        normalized = model.strip()
        if not normalized or normalized.startswith("anthropic/") or normalized in seen or normalized == DEFAULT_PRIMARY:
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

# Migrate persisted auth state by removing Anthropic entries only.
auth_profiles = load_json_file(auth_profiles_path)
if auth_profiles is None:
    pass
elif not isinstance(auth_profiles, dict):
    print(f"[entrypoint] Warning: {auth_profiles_path} is malformed; skipping auth profile migration")
else:
    original_auth_profiles = deepcopy(auth_profiles)

    profiles = auth_profiles.get("profiles")

    # Preferred auth-profiles format: profiles is an object map {id: profile}
    if isinstance(profiles, dict):
        cleaned_profiles = {}
        removed = 0
        for profile_id, profile in profiles.items():
            if not isinstance(profile, dict):
                cleaned_profiles[profile_id] = profile
                continue
            provider = str(profile.get("provider", "")).strip().lower()
            if provider == "anthropic":
                removed += 1
                continue
            cleaned_profiles[profile_id] = profile
        auth_profiles["profiles"] = cleaned_profiles
        if removed:
            print(f"[entrypoint] Removed {removed} anthropic auth profile(s)")

    # Backward compatibility: if profiles is a list, sanitize list entries without reshaping.
    elif isinstance(profiles, list):
        filtered_profiles = []
        removed = 0
        for profile in profiles:
            if not isinstance(profile, dict):
                filtered_profiles.append(profile)
                continue
            provider = str(profile.get("provider", "")).strip().lower()
            if provider == "anthropic":
                removed += 1
                continue
            filtered_profiles.append(profile)
        auth_profiles["profiles"] = filtered_profiles
        if removed:
            print(f"[entrypoint] Removed {removed} anthropic auth profile(s)")

    last_good = auth_profiles.get("lastGood")
    if isinstance(last_good, dict) and "anthropic" in last_good:
        last_good.pop("anthropic", None)
        auth_profiles["lastGood"] = last_good
        print("[entrypoint] Removed lastGood.anthropic")

    if write_json_if_changed(auth_profiles_path, original_auth_profiles, auth_profiles):
        print("[entrypoint] Migrated auth-profiles.json (anthropic entries removed)")
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
