#!/bin/bash
# Apply message.inbound WebSocket push patch to Clawdbot gateway
# Enables real-time inbound message broadcasting to connected clients (e.g., dashboard)
set -e

PATCH_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAWDBOT_DIR="$HOME/.npm-global/lib/node_modules/clawdbot/dist"

echo "╔════════════════════════════════════════════╗"
echo "║   MESSAGE INBOUND PUSH PATCH - APPLY       ║"
echo "╚════════════════════════════════════════════╝"
echo ""

# Check if clawdbot is installed
if [ ! -d "$CLAWDBOT_DIR" ]; then
    echo "❌ Clawdbot not found at $CLAWDBOT_DIR"
    exit 1
fi

# 1. Create inbound-events.js
echo "📦 Creating inbound-events.js..."
cp "$PATCH_DIR/inbound-events.js" "$CLAWDBOT_DIR/infra/inbound-events.js"
echo "   ✓ infra/inbound-events.js"

# 2. Patch dispatch-from-config.js using Node
echo ""
echo "🔧 Patching dispatch-from-config.js..."
node "$PATCH_DIR/patch-dispatch.mjs"
echo "   ✓ dispatch-from-config.js"

# 3. Patch server.impl.js using Node
echo ""
echo "🔧 Patching server.impl.js..."
node "$PATCH_DIR/patch-server.mjs"
echo "   ✓ server.impl.js"

echo ""
echo "╔════════════════════════════════════════════╗"
echo "║          PATCH APPLIED SUCCESSFULLY        ║"
echo "╚════════════════════════════════════════════╝"
echo ""
echo "Next: Restart gateway to activate"
echo "  clawdbot gateway restart"
echo ""
