#!/bin/bash
# Syncs platform extensions from host mount to the user's writable volume.
# Also applies config patches from the manifest to openclaw.json.
#
# Two phases:
#   1. File sync — controlled by stamp file, skipped when version matches
#   2. Config patches — ALWAYS run, because config may have been reset by provisioner
set -e

MANIFEST="/opt/openclaw/platform-extensions/platform-manifest.json"
STAMP="/root/.openclaw/.platform-manifest-applied"
TARGET_DIR="/root/.openclaw/extensions"
OPENCLAW_CONFIG="/root/.openclaw/openclaw.json"
LOG_PREFIX="[platform-sync]"

if [ ! -f "$MANIFEST" ]; then
    echo "$LOG_PREFIX No platform manifest found, skipping sync."
    exit 0
fi

MANIFEST_VERSION=$(python3 -c "import json; print(json.load(open('$MANIFEST'))['version'])" 2>/dev/null || echo "unknown")
APPLIED_VERSION=$(cat "$STAMP" 2>/dev/null || echo "none")

echo "$LOG_PREFIX Manifest version: $MANIFEST_VERSION | Applied version: $APPLIED_VERSION"

# ── Phase 1: File sync (skip if stamp matches) ──────────────────────
NEEDS_FILE_SYNC=false
if [ "$MANIFEST_VERSION" != "$APPLIED_VERSION" ]; then
    NEEDS_FILE_SYNC=true
fi

if [ "$NEEDS_FILE_SYNC" = true ]; then
    echo "$LOG_PREFIX Syncing extension files..."
    mkdir -p "$TARGET_DIR"

    _MANIFEST="$MANIFEST" _TARGET_DIR="$TARGET_DIR" _LOG="$LOG_PREFIX" python3 -c "
import json, os, sys, shutil

manifest_path = os.environ['_MANIFEST']
target_dir = os.environ['_TARGET_DIR']
log = os.environ['_LOG']

manifest = json.load(open(manifest_path))

for name, info in manifest.get('extensions', {}).items():
    source = info['source']
    target = os.path.join(target_dir, name)

    if not os.path.isdir(source):
        print(f'{log}  ✗ {name}: source not found at {source}', file=sys.stderr)
        continue

    if os.path.exists(target):
        shutil.rmtree(target)
        print(f'{log}  ↻ {name} v{info[\"version\"]}: updating')
    else:
        print(f'{log}  + {name} v{info[\"version\"]}: installing')

    shutil.copytree(source, target)
    print(f'{log}  ✓ {name} v{info[\"version\"]}: synced to {target}')
"
    # Update stamp
    echo "$MANIFEST_VERSION" > "$STAMP"
    echo "$LOG_PREFIX File sync complete. Stamp updated to $MANIFEST_VERSION"
else
    echo "$LOG_PREFIX Extension files up to date, skipping file sync."
fi

# ── Phase 2: Config patches (ALWAYS run) ────────────────────────────
echo "$LOG_PREFIX Applying config patches..."

_MANIFEST="$MANIFEST" _CONFIG="$OPENCLAW_CONFIG" _LOG="$LOG_PREFIX" python3 -c "
import json, os, sys

manifest_path = os.environ['_MANIFEST']
config_path = os.environ['_CONFIG']
log = os.environ['_LOG']

manifest = json.load(open(manifest_path))
config_changed = False

# Load existing openclaw.json
if os.path.isfile(config_path):
    try:
        config = json.load(open(config_path))
    except json.JSONDecodeError:
        print(f'{log}  ⚠ openclaw.json is invalid JSON, treating as empty')
        config = {}
else:
    config = {}

for name, info in manifest.get('extensions', {}).items():
    patches = info.get('config', {})
    if not patches:
        continue

    for dot_path, value in patches.items():
        keys = dot_path.split('.')
        obj = config
        for key in keys[:-1]:
            if key not in obj or not isinstance(obj[key], dict):
                obj[key] = {}
            obj = obj[key]
        if obj.get(keys[-1]) != value:
            obj[keys[-1]] = value
            config_changed = True
            print(f'{log}  ⚙ config: {dot_path} = {json.dumps(value)}')
        else:
            print(f'{log}  ✓ config: {dot_path} already set')

if config_changed:
    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2)
        f.write('\n')
    print(f'{log}  ✓ openclaw.json updated with config patches')
else:
    print(f'{log}  ✓ openclaw.json unchanged (all patches already applied)')
"

echo "$LOG_PREFIX Done."
