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
auth_profiles_seed_path = os.environ.get(
    "OPENCLAW_AUTH_PROFILES_SEED_PATH",
    "/root/.openclaw/agents/main/agent/auth-profiles.seed.json",
)

DEFAULT_PRIMARY = "openai-codex/gpt-5.4"
DEFAULT_FALLBACKS = [
    "deepseek/deepseek-chat",
]
DEEPSEEK_API_KEY = "sk-554e49d546244b738d874805a8de847d"


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


def is_valid_auth_profile(profile):
    if not isinstance(profile, dict):
        return False
    provider = str(profile.get("provider", "")).strip()
    if not provider:
        return False
    # Persist only real auth profiles (mode/type present), drop placeholders/partial entries.
    has_mode = isinstance(profile.get("mode"), str) and profile.get("mode").strip()
    has_type = isinstance(profile.get("type"), str) and profile.get("type").strip()
    return bool(has_mode or has_type)


def sanitize_auth_profile_store(raw):
    if not isinstance(raw, dict):
        return None, 0

    store = deepcopy(raw)
    profiles = store.get("profiles")
    kept_profile_ids = set()
    removed = 0

    # Preferred auth-profiles format: profiles is an object map {id: profile}
    if isinstance(profiles, dict):
        cleaned_profiles = {}
        for profile_id, profile in profiles.items():
            if not isinstance(profile, dict):
                removed += 1
                continue
            provider = str(profile.get("provider", "")).strip().lower()
            if provider == "anthropic" or not is_valid_auth_profile(profile):
                removed += 1
                continue
            cleaned_profiles[profile_id] = profile
            kept_profile_ids.add(profile_id)
        store["profiles"] = cleaned_profiles

    # Backward compatibility: if profiles is a list, normalize to the expected object map.
    elif isinstance(profiles, list):
        cleaned_profiles = {}
        for i, profile in enumerate(profiles):
            if not isinstance(profile, dict):
                removed += 1
                continue
            provider = str(profile.get("provider", "")).strip().lower()
            if provider == "anthropic" or not is_valid_auth_profile(profile):
                removed += 1
                continue
            profile_id = profile.get("id")
            if not isinstance(profile_id, str) or not profile_id.strip():
                profile_id = f"migrated:{provider or 'unknown'}:{i}"
            cleaned_profiles[profile_id] = profile
            kept_profile_ids.add(profile_id)
        store["profiles"] = cleaned_profiles
        print("[entrypoint] Normalized auth profiles list to object map")
    else:
        store["profiles"] = {}

    last_good = store.get("lastGood")
    if isinstance(last_good, dict):
        if "anthropic" in last_good:
            last_good.pop("anthropic", None)
            print("[entrypoint] Removed lastGood.anthropic")
        for provider_name, profile_id in list(last_good.items()):
            if isinstance(profile_id, str) and profile_id and profile_id not in kept_profile_ids:
                last_good.pop(provider_name, None)
        store["lastGood"] = last_good
    else:
        store["lastGood"] = {}

    usage_stats = store.get("usageStats")
    if isinstance(usage_stats, dict):
        store["usageStats"] = {
            k: v for k, v in usage_stats.items()
            if isinstance(k, str) and k in kept_profile_ids
        }
    else:
        store["usageStats"] = {}

    if not isinstance(store.get("version"), int):
        store["version"] = 1

    return store, len(kept_profile_ids)


config = load_json_file(config_path)
if not isinstance(config, dict):
    print(f"[entrypoint] Warning: {config_path} is missing or malformed; skipping config patching")
else:
    changed = False
    plugins = config.setdefault("plugins", {})
    entries = plugins.setdefault("entries", {})

    registry_url = os.environ.get("AGENT_REGISTRY_URL", "").strip()

    # Force requested defaults exactly:
    # primary = gpt-5.4
    # fallbacks = deepseek-chat
    agents = config.setdefault("agents", {})
    defaults = agents.setdefault("defaults", {})
    model_defaults = defaults.setdefault("model", {})
    if model_defaults.get("primary") != DEFAULT_PRIMARY:
        model_defaults["primary"] = DEFAULT_PRIMARY
        changed = True
        print(f"[entrypoint] Set agents.defaults.model.primary to {DEFAULT_PRIMARY}")

    if model_defaults.get("fallbacks") != DEFAULT_FALLBACKS:
        model_defaults["fallbacks"] = list(DEFAULT_FALLBACKS)
        changed = True
        print(f"[entrypoint] Set agents.defaults.model.fallbacks to {DEFAULT_FALLBACKS}")

    defaults_models = defaults.setdefault("models", {})
    required_models = {
        "openai-codex/gpt-5.4": {"alias": "gpt"},
        "deepseek/deepseek-chat": {"alias": "deepseek"},
        "deepseek/deepseek-reasoner": {},
    }
    if defaults_models.pop("openai-codex/gpt-5.4-mini", None) is not None:
        changed = True
        print("[entrypoint] Removed stale managed model openai-codex/gpt-5.4-mini")
    for model_name, model_cfg in required_models.items():
        if defaults_models.get(model_name) != model_cfg:
            defaults_models[model_name] = model_cfg
            changed = True

    providers = config.setdefault("models", {}).setdefault("providers", {})
    if "deepseek" not in providers:
        providers["deepseek"] = {
            "baseUrl": "https://api.deepseek.com/v1",
            "apiKey": DEEPSEEK_API_KEY,
            "api": "openai-completions",
            "models": [
                {
                    "id": "deepseek-chat",
                    "name": "DeepSeek V3",
                    "api": "openai-completions",
                    "reasoning": False,
                    "input": ["text"],
                    "cost": {"input": 0.27, "output": 1.1, "cacheRead": 0, "cacheWrite": 0},
                    "contextWindow": 64000,
                    "maxTokens": 8192,
                },
                {
                    "id": "deepseek-reasoner",
                    "name": "DeepSeek R1",
                    "api": "openai-completions",
                    "reasoning": True,
                    "input": ["text"],
                    "cost": {"input": 0.55, "output": 2.19, "cacheRead": 0, "cacheWrite": 0},
                    "contextWindow": 64000,
                    "maxTokens": 8192,
                },
            ],
        }
        changed = True
        print("[entrypoint] Added deepseek provider config")

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

# Migrate persisted auth state and seed empty installs when a colocated auth seed exists.
auth_profiles = load_json_file(auth_profiles_path)
seed_auth_profiles = load_json_file(auth_profiles_seed_path)
sanitized_seed_auth_profiles, seed_profile_count = sanitize_auth_profile_store(seed_auth_profiles)

if sanitized_seed_auth_profiles is None and seed_auth_profiles is not None:
    print(f"[entrypoint] Warning: {auth_profiles_seed_path} is malformed; ignoring auth seed")
elif seed_profile_count == 0 and sanitized_seed_auth_profiles is not None:
    print(f"[entrypoint] Ignoring empty auth seed at {auth_profiles_seed_path}")

if auth_profiles is None:
    if seed_profile_count > 0:
        os.makedirs(os.path.dirname(auth_profiles_path), exist_ok=True)
        with open(auth_profiles_path, "w") as f:
            json.dump(sanitized_seed_auth_profiles, f, indent=2)
        print(f"[entrypoint] Seeded auth-profiles.json from {auth_profiles_seed_path}")
elif not isinstance(auth_profiles, dict):
    if seed_profile_count > 0:
        os.makedirs(os.path.dirname(auth_profiles_path), exist_ok=True)
        with open(auth_profiles_path, "w") as f:
            json.dump(sanitized_seed_auth_profiles, f, indent=2)
        print(f"[entrypoint] Replaced malformed auth-profiles.json from {auth_profiles_seed_path}")
    else:
        print(f"[entrypoint] Warning: {auth_profiles_path} is malformed; skipping auth profile migration")
else:
    sanitized_auth_profiles, existing_profile_count = sanitize_auth_profile_store(auth_profiles)
    if sanitized_auth_profiles is None:
        print(f"[entrypoint] Warning: {auth_profiles_path} is malformed; skipping auth profile migration")
    elif write_json_if_changed(auth_profiles_path, auth_profiles, sanitized_auth_profiles):
        print("[entrypoint] Migrated auth-profiles.json (invalid/anthropic entries removed)")

    if existing_profile_count == 0 and seed_profile_count > 0:
        with open(auth_profiles_path, "w") as f:
            json.dump(sanitized_seed_auth_profiles, f, indent=2)
        print(f"[entrypoint] Seeded empty auth-profiles.json from {auth_profiles_seed_path}")
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
