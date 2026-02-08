#!/bin/bash
# Apply Brazil JID Resolution patch to Clawdbot
# This patch fixes WhatsApp message delivery to Brazilian numbers with legacy 8-digit registration
#
# Changes applied:
# 1. outbound.js - Resolves Brazilian JIDs before sending (main fix)
# 2. monitor.js - Exposes onWhatsApp on the listener object
# 3. brazil-jid-resolver.mjs - The resolver module (queries variants, caches results)

set -e

CLAWDBOT_DIR="${CLAWDBOT_DIR:-$HOME/.npm-global/lib/node_modules/clawdbot}"
PATCH_DIR="$(dirname "$0")"

echo "Applying Brazil JID Resolution patch..."
echo "Target: $CLAWDBOT_DIR"

# Check if clawdbot is installed
if [ ! -d "$CLAWDBOT_DIR/dist/web" ]; then
  echo "ERROR: Clawdbot not found at $CLAWDBOT_DIR"
  exit 1
fi

# Backup originals
echo "Backing up original files..."
cp "$CLAWDBOT_DIR/dist/web/outbound.js" "$CLAWDBOT_DIR/dist/web/outbound.js.bak" 2>/dev/null || true
cp "$CLAWDBOT_DIR/dist/web/inbound/monitor.js" "$CLAWDBOT_DIR/dist/web/inbound/monitor.js.bak" 2>/dev/null || true
cp "$CLAWDBOT_DIR/dist/web/inbound/send-api.js" "$CLAWDBOT_DIR/dist/web/inbound/send-api.js.bak" 2>/dev/null || true

# Copy resolver module
echo "Installing brazil-jid-resolver.mjs..."
cp "$PATCH_DIR/brazil-jid-resolver.mjs" "$CLAWDBOT_DIR/dist/web/inbound/"

# Apply outbound.js patch (main fix - resolves JID before sending)
echo "Patching outbound.js..."
cp "$PATCH_DIR/outbound.patched.js" "$CLAWDBOT_DIR/dist/web/outbound.js"

# Apply monitor.js patch (exposes onWhatsApp on listener)
echo "Patching monitor.js..."
if grep -q "onWhatsApp: (jid) => sock.onWhatsApp(jid)," "$CLAWDBOT_DIR/dist/web/inbound/monitor.js" | grep -v "sock: {"; then
  echo "  monitor.js already has onWhatsApp exposed, skipping"
else
  # Add onWhatsApp to the returned listener object (after ...sendApi,)
  sed -i 's/\.\.\.sendApi,/...sendApi,\n        onWhatsApp: (jid) => sock.onWhatsApp(jid),/' "$CLAWDBOT_DIR/dist/web/inbound/monitor.js"
fi

echo ""
echo "✅ Patch applied!"

# Verify patch
echo ""
echo "Verifying patch..."
ERRORS=0

if grep -q "resolveBrazilianJid\|resolveJidWithBrazil" "$CLAWDBOT_DIR/dist/web/outbound.js"; then
  echo "  ✅ outbound.js patched"
else
  echo "  ❌ outbound.js NOT patched"
  ERRORS=$((ERRORS + 1))
fi

# Check for onWhatsApp in the listener return block (not just in sock: {})
if grep -A2 "\.\.\.sendApi," "$CLAWDBOT_DIR/dist/web/inbound/monitor.js" | grep -q "onWhatsApp"; then
  echo "  ✅ monitor.js patched (onWhatsApp exposed)"
else
  echo "  ❌ monitor.js NOT patched"
  ERRORS=$((ERRORS + 1))
fi

if [ -f "$CLAWDBOT_DIR/dist/web/inbound/brazil-jid-resolver.mjs" ]; then
  echo "  ✅ resolver installed"
else
  echo "  ❌ resolver NOT installed"
  ERRORS=$((ERRORS + 1))
fi

if [ $ERRORS -gt 0 ]; then
  echo ""
  echo "❌ Patch verification failed with $ERRORS errors"
  exit 1
fi

echo ""
echo "Restarting gateway..."
if command -v clawdbot &> /dev/null; then
  clawdbot gateway restart 2>/dev/null && echo "  ✅ Gateway restarted" || echo "  ⚠️ Gateway restart may have timed out (normal)"
else
  echo "  ⚠️ clawdbot command not found, please restart manually: clawdbot gateway restart"
fi

echo ""
echo "✅ Patch complete!"
echo ""
echo "Cache location: ~/.config/clawdbot/brazil-jid-cache.json"
echo ""
echo "To clear cache: rm ~/.config/clawdbot/brazil-jid-cache.json"
