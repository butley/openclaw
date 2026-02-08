#!/bin/bash
# Revert chat mirror patch
set -e

PATCH_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAWDBOT_DIR="$HOME/.npm-global/lib/node_modules/clawdbot/dist"

echo "╔════════════════════════════════════════════╗"
echo "║       CHAT MIRROR PATCH - REVERT           ║"
echo "╚════════════════════════════════════════════╝"
echo ""

FILES=(
    "gateway/server-methods/chat.js:chat.js.original"
    "gateway/server-chat.js:server-chat.js.original"
    "gateway/server-bridge-methods-chat.js:server-bridge-methods-chat.js.original"
    "gateway/protocol/schema/logs-chat.js:logs-chat.js.original"
)

echo "🔄 Reverting to original files..."
for entry in "${FILES[@]}"; do
    target="${entry%%:*}"
    backup="${entry##*:}"
    
    if [ -f "$PATCH_DIR/$backup" ]; then
        cp "$PATCH_DIR/$backup" "$CLAWDBOT_DIR/$target"
        echo "   ✓ Reverted $(basename "$target")"
    else
        echo "   ⚠ No backup found for $(basename "$target")"
    fi
done

echo ""
echo "╔════════════════════════════════════════════╗"
echo "║          PATCH REVERTED                    ║"
echo "╚════════════════════════════════════════════╝"
echo ""
echo "Next: Restart gateway to activate"
echo "  clawdbot gateway restart"
echo ""
