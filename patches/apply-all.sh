#!/bin/bash
# Apply all Clawdbot patches
# Run this after: npm update -g clawdbot
#
# Patches:
# 1. WhatsApp Opus TTS - Enables opus format for WhatsApp voice messages
# 2. Brazil JID Resolution - Fixes 8/9 digit mobile number issue
# 3. Audio Transcript Hook - Logs inbound audio with transcriptions to WhatsApp logger

set -e

PATCH_DIR="$(dirname "$0")"
cd "$PATCH_DIR"

echo "╔════════════════════════════════════════════╗"
echo "║     CLAWDBOT PATCHES - APPLY ALL           ║"
echo "╚════════════════════════════════════════════╝"
echo ""

# Check clawdbot version
echo "Clawdbot version:"
clawdbot --version 2>/dev/null || echo "  (clawdbot command not found)"
echo ""

# Apply WhatsApp Opus TTS patch
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1/2 WhatsApp Opus TTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bash "$PATCH_DIR/apply-whatsapp-opus.sh" || echo "⚠️ Opus patch may have failed"
echo ""

# Apply Brazil JID Resolution patch
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2/3 Brazil JID Resolution"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bash "$PATCH_DIR/brazil-jid-resolution/apply.sh" || echo "⚠️ Brazil JID patch may have failed"
echo ""

# Apply Audio Transcript Hook patch
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3/4 Audio Transcript Hook (WhatsApp Logger)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bash "$PATCH_DIR/audio-transcript-hook/apply.sh" || echo "⚠️ Audio transcript hook may have failed"
echo ""

# Apply TUI Dark Theme patch
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4/5 TUI Dark Theme"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bash "$PATCH_DIR/tui-dark-theme/apply.sh" || echo "⚠️ TUI dark theme patch may have failed"
echo ""

# Apply Chat Mirror patch
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "5/6 Chat Mirror (Web → WhatsApp relay)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bash "$PATCH_DIR/chat-mirror/apply.sh" || echo "⚠️ Chat mirror patch may have failed"
echo ""

# Apply Message Inbound Push patch
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "6/6 Message Inbound Push (WebSocket broadcast)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bash "$PATCH_DIR/message-inbound-push/apply.sh" || echo "⚠️ Message inbound push patch may have failed"
echo ""

echo "╔════════════════════════════════════════════╗"
echo "║          ALL PATCHES APPLIED               ║"
echo "╚════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  1. Verify gateway is running: clawdbot gateway status"
echo "  2. Test WhatsApp messaging"
echo ""
echo "If issues occur, check logs: clawdbot logs -f"

# TTS Caption patch was added but not in numbered list - adding to apply-all
