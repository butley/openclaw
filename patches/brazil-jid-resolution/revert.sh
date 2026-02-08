#!/bin/bash
# Revert Brazil JID Resolution patch from Clawdbot

set -e

CLAWDBOT_DIR="${CLAWDBOT_DIR:-$HOME/.npm-global/lib/node_modules/clawdbot}"

echo "Reverting Brazil JID Resolution patch..."
echo "Target: $CLAWDBOT_DIR"

# Restore backups
if [ -f "$CLAWDBOT_DIR/dist/web/outbound.js.bak" ]; then
  cp "$CLAWDBOT_DIR/dist/web/outbound.js.bak" "$CLAWDBOT_DIR/dist/web/outbound.js"
  echo "  ✅ outbound.js restored"
else
  echo "  ⚠️ outbound.js.bak not found"
fi

if [ -f "$CLAWDBOT_DIR/dist/web/inbound/monitor.js.bak" ]; then
  cp "$CLAWDBOT_DIR/dist/web/inbound/monitor.js.bak" "$CLAWDBOT_DIR/dist/web/inbound/monitor.js"
  echo "  ✅ monitor.js restored"
else
  echo "  ⚠️ monitor.js.bak not found"
fi

if [ -f "$CLAWDBOT_DIR/dist/web/inbound/send-api.js.bak" ]; then
  cp "$CLAWDBOT_DIR/dist/web/inbound/send-api.js.bak" "$CLAWDBOT_DIR/dist/web/inbound/send-api.js"
  echo "  ✅ send-api.js restored"
else
  echo "  ⚠️ send-api.js.bak not found"
fi

# Remove resolver
if [ -f "$CLAWDBOT_DIR/dist/web/inbound/brazil-jid-resolver.mjs" ]; then
  rm "$CLAWDBOT_DIR/dist/web/inbound/brazil-jid-resolver.mjs"
  echo "  ✅ brazil-jid-resolver.mjs removed"
fi

echo ""
echo "✅ Patch reverted!"
echo ""
echo "Don't forget to restart the gateway: clawdbot gateway restart"
