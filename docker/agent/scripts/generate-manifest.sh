#!/bin/bash
# Generates platform-manifest.json for host-mounted platform extensions.
#
# Usage:
#   ./generate-manifest.sh <extensions-dir>
#
# The manifest version is read from the OpenClaw fork's package.json.
# Run this from the openclaw fork root, or set OPENCLAW_ROOT.
#
# Each extension can have a platform-config.json with config patches
# to apply to the agent's openclaw.json on startup. These are
# platform-level decisions (e.g. which plugin acts as contextEngine).
#
# Example:
#   cd /shared/code/butley/openclaw
#   ./docker/agent/scripts/generate-manifest.sh /var/data/butley-staging/platform/extensions/
set -e

EXTENSIONS_DIR="${1:?Usage: generate-manifest.sh <extensions-dir>}"
OPENCLAW_ROOT="${OPENCLAW_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}"
MANIFEST="$EXTENSIONS_DIR/platform-manifest.json"

# Read version from package.json
if [ -f "$OPENCLAW_ROOT/package.json" ]; then
    VERSION=$(python3 -c "import json; print(json.load(open('$OPENCLAW_ROOT/package.json'))['version'])" 2>/dev/null || echo "unknown")
else
    VERSION="unknown"
fi

echo "Generating platform manifest (version: $VERSION)..."
echo "  Extensions dir: $EXTENSIONS_DIR"
echo "  OpenClaw root:  $OPENCLAW_ROOT"

# Build manifest with Python for proper JSON handling
_EXT_DIR="$EXTENSIONS_DIR" _VERSION="$VERSION" _MANIFEST="$MANIFEST" python3 -c "
import json, os, sys, datetime

extensions_dir = os.environ['_EXT_DIR']
version = os.environ['_VERSION']
manifest_path = os.environ['_MANIFEST']

manifest = {
    'version': version,
    'generated_at': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
    'extensions': {}
}

for ext_name in sorted(os.listdir(extensions_dir)):
    ext_dir = os.path.join(extensions_dir, ext_name)
    if not os.path.isdir(ext_dir):
        continue

    ext_info = {
        'version': 'unknown',
        'source': f'/opt/openclaw/platform-extensions/{ext_name}'
    }

    # Read version from package.json
    pkg_path = os.path.join(ext_dir, 'package.json')
    if os.path.isfile(pkg_path):
        try:
            ext_info['version'] = json.load(open(pkg_path)).get('version', 'unknown')
        except Exception:
            pass

    # Read platform config patches (platform-level decisions for this extension)
    config_path = os.path.join(ext_dir, 'platform-config.json')
    if os.path.isfile(config_path):
        try:
            ext_info['config'] = json.load(open(config_path))
            print(f'  + {ext_name} v{ext_info[\"version\"]} (with config patches)')
        except Exception as e:
            print(f'  ! {ext_name}: invalid platform-config.json: {e}', file=sys.stderr)
    else:
        print(f'  + {ext_name} v{ext_info[\"version\"]} (no config patches)')

    manifest['extensions'][ext_name] = ext_info

with open(manifest_path, 'w') as f:
    json.dump(manifest, f, indent=2)
    f.write('\n')

print(f'\nPlatform manifest generated at {manifest_path}:')
print(json.dumps(manifest, indent=2))
"
