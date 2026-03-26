#!/bin/bash
# Syncs platform extensions from host mount to the user's writable volume.
# Also applies config patches from the manifest to openclaw.json.
# Controlled by a manifest + stamp file to avoid redundant work.
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

if [ "$MANIFEST_VERSION" = "$APPLIED_VERSION" ]; then
    echo "$LOG_PREFIX Already up to date, skipping sync."
    python3 -c "
import json
m = json.load(open('$MANIFEST'))
for name, info in m.get('extensions', {}).items():
    print(f'$LOG_PREFIX  ✓ {name} v{info[\"version\"]} (already synced)')
" 2>/dev/null
    exit 0
fi

echo "$LOG_PREFIX Syncing platform extensions..."
mkdir -p "$TARGET_DIR"

# Sync extensions and apply config patches
_MANIFEST="$MANIFEST" _TARGET_DIR="$TARGET_DIR" _CONFIG="$OPENCLAW_CONFIG" _LOG="$LOG_PREFIX" python3 -c "
import json, os, sys, shutil, copy

manifest_path = os.environ['_MANIFEST']
target_dir = os.environ['_TARGET_DIR']
config_path = os.environ['_CONFIG']
log = os.environ['_LOG']

manifest = json.load(open(manifest_path))
config_changed = False

# Load existing openclaw.json
if os.path.isfile(config_path):
    config = json.load(open(config_path))
else:
    config = {}

for name, info in manifest.get('extensions', {}).items():
    source = info['source']
    target = os.path.join(target_dir, name)

    # Copy extension files
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

    # Apply config patches (dot-path notation)
    patches = info.get('config', {})
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

# Write config if changed
if config_changed:
    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2)
        f.write('\n')
    print(f'{log}  ✓ openclaw.json updated with config patches')
else:
    print(f'{log}  ✓ openclaw.json unchanged (patches already applied or none)')
"

# Write stamp
echo "$MANIFEST_VERSION" > "$STAMP"
echo "$LOG_PREFIX Sync complete. Stamp updated to $MANIFEST_VERSION"
