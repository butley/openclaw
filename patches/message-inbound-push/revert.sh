#!/bin/bash
# Revert message.inbound WebSocket push patch
set -e

PATCH_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAWDBOT_DIR="$HOME/.npm-global/lib/node_modules/clawdbot/dist"

echo "╔════════════════════════════════════════════╗"
echo "║   MESSAGE INBOUND PUSH PATCH - REVERT      ║"
echo "╚════════════════════════════════════════════╝"
echo ""

# Restore dispatch-from-config.js
if [ -f "$PATCH_DIR/dispatch-from-config.js.original" ]; then
    cp "$PATCH_DIR/dispatch-from-config.js.original" "$CLAWDBOT_DIR/auto-reply/reply/dispatch-from-config.js"
    echo "✓ Restored dispatch-from-config.js"
else
    echo "⚠ No backup found for dispatch-from-config.js"
fi

# Restore server.impl.js
if [ -f "$PATCH_DIR/server.impl.js.original" ]; then
    cp "$PATCH_DIR/server.impl.js.original" "$CLAWDBOT_DIR/gateway/server.impl.js"
    echo "✓ Restored server.impl.js"
else
    echo "⚠ No backup found for server.impl.js"
fi

# Remove inbound-events.js
if [ -f "$CLAWDBOT_DIR/infra/inbound-events.js" ]; then
    rm "$CLAWDBOT_DIR/infra/inbound-events.js"
    echo "✓ Removed inbound-events.js"
fi

echo ""
echo "Patch reverted. Restart gateway:"
echo "  clawdbot gateway restart"
