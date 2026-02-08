#!/bin/bash
# Apply chat mirror patch to Clawdbot gateway
# Allows web dashboard to relay AI responses to original channel (e.g., WhatsApp)
set -e

PATCH_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAWDBOT_DIR="$HOME/.npm-global/lib/node_modules/clawdbot/dist"

echo "╔════════════════════════════════════════════╗"
echo "║       CHAT MIRROR PATCH - APPLY            ║"
echo "╚════════════════════════════════════════════╝"
echo ""

# Check if clawdbot is installed
if [ ! -d "$CLAWDBOT_DIR" ]; then
    echo "❌ Clawdbot not found at $CLAWDBOT_DIR"
    exit 1
fi

# Files to patch
FILES=(
    "gateway/server-methods/chat.js"
    "gateway/server-chat.js"
    "gateway/server-bridge-methods-chat.js"
    "gateway/protocol/schema/logs-chat.js"
)

# Backup originals if not already backed up
echo "📦 Backing up original files..."
for file in "${FILES[@]}"; do
    src="$CLAWDBOT_DIR/$file"
    backup="$PATCH_DIR/$(basename "$file").original"
    if [ ! -f "$backup" ] && [ -f "$src" ]; then
        cp "$src" "$backup"
        echo "   ✓ Backed up $(basename "$file")"
    fi
done
echo ""

# Apply patched files
echo "🔧 Applying patches..."

# 1. server-methods/chat.js - main chat handler with mirror logic
if [ -f "$PATCH_DIR/chat.js.patched" ]; then
    cp "$PATCH_DIR/chat.js.patched" "$CLAWDBOT_DIR/gateway/server-methods/chat.js"
    echo "   ✓ gateway/server-methods/chat.js"
else
    echo "   ⚠ chat.js.patched not found, skipping"
fi

# 2. server-chat.js - emitChatFinal with mirror logic
if [ -f "$PATCH_DIR/server-chat.js.patched" ]; then
    cp "$PATCH_DIR/server-chat.js.patched" "$CLAWDBOT_DIR/gateway/server-chat.js"
    echo "   ✓ gateway/server-chat.js"
else
    echo "   ⚠ server-chat.js.patched not found, skipping"
fi

# 3. server-bridge-methods-chat.js - register mirror in run context
if [ -f "$PATCH_DIR/server-bridge-methods-chat.js.patched" ]; then
    cp "$PATCH_DIR/server-bridge-methods-chat.js.patched" "$CLAWDBOT_DIR/gateway/server-bridge-methods-chat.js"
    echo "   ✓ gateway/server-bridge-methods-chat.js"
else
    echo "   ⚠ server-bridge-methods-chat.js.patched not found, skipping"
fi

# 4. logs-chat.js - schema with mirror param
if [ -f "$PATCH_DIR/logs-chat.js.patched" ]; then
    cp "$PATCH_DIR/logs-chat.js.patched" "$CLAWDBOT_DIR/gateway/protocol/schema/logs-chat.js"
    echo "   ✓ gateway/protocol/schema/logs-chat.js"
else
    echo "   ⚠ logs-chat.js.patched not found, skipping"
fi

echo ""
echo "╔════════════════════════════════════════════╗"
echo "║          PATCH APPLIED SUCCESSFULLY        ║"
echo "╚════════════════════════════════════════════╝"
echo ""
echo "Next: Restart gateway to activate"
echo "  clawdbot gateway restart"
echo ""
