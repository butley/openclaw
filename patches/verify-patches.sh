#!/bin/bash
# Verify all custom patches survived an upstream merge.
# Usage: verify-patches.sh [repo-path]
# Run from or pass path to ~/Projects/openclaw
#
# Updated 2026-03-24 for feat/rebase-3.22 branch.
# Absorbed patches (P1, P3, P6, P12, P20) removed.
# Dropped patches (P28) removed.
# Verify patterns updated for extracted files and renamed constants.

set -euo pipefail

cd "${1:-$(pwd)}"

echo "=== Butley Fork — Patch Verification ==="
echo "    Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"
echo ""

pass=0
fail=0

check() {
  local name="$1"
  local cmd="$2"
  printf "  %-36s" "$name"
  if eval "$cmd" > /dev/null 2>&1; then
    echo "✓ OK"
    pass=$((pass + 1))
  else
    echo "✗ MISSING"
    fail=$((fail + 1))
  fi
}

echo "── Core Patches ──"
check "P2.  Brazil JID"                "grep -q 'resolveJidWithBrazil' extensions/whatsapp/src/send.ts || grep -q 'resolveJidWithBrazil' src/web/outbound.ts"
check "P4.  Chat Mirror"               "test -f src/gateway/chat-mirror.ts && grep -q 'consumeMirror' src/gateway/server-chat.ts && grep -q 'registerMirror' src/gateway/server-methods/chat.ts && grep -q 'extractMirrorParam' src/gateway/server-methods/chat.ts"
check "P5.  WS Inbound Push"           "test -f src/infra/inbound-events.ts"
check "P7.  TUI Dark Theme"            "grep -q '236' src/tui/theme/theme.ts"
check "P8.  Status Card"               "test -f src/auto-reply/status-card-format.ts && grep -q 'formatStatusCard' src/auto-reply/status.ts"
check "P9.  QMD Output Limit"          "grep -q 'maxOutputChars' src/memory/qmd-manager.ts"
check "P10. Logs Pretty"               "test -f src/cli/logs-pretty-formatter.ts && grep -q 'pretty' src/cli/logs-cli.ts"

echo ""
echo "── WhatsApp Patches ──"
check "P11. WA Paragraph Streaming"    "grep -q 'streamDelayMs' extensions/whatsapp/src/auto-reply/deliver-reply.ts || grep -q 'streamDelayMs' src/web/auto-reply/deliver-reply.ts"
check "P14. WA Outbound Mentions"      "grep -q 'processOutboundMentions' extensions/whatsapp/src/inbound/send-api.ts || grep -q 'processOutboundMentions' src/web/inbound/send-api.ts"

echo ""
echo "── Streaming Pipeline ──"
check "P15. Webchat Thinking"          "grep -q 'streamReasoning: true' src/agents/pi-embedded-subscribe.ts"
check "P16. Tool Events Broadcast"     "grep -q 'gatewayEventBus.emit.*toolPayload' src/gateway/server-chat.ts && grep -q 'sessionMessageSubscribers' src/gateway/server-chat.ts"
check "P17. Streaming Throttle"        "grep -q 'STREAM_DELTA_THROTTLE_MS' src/gateway/server-chat.ts"
check "P18. SSE Streaming"             "test -f src/gateway/server-sse.ts"
check "P31. SSE EventBus Singleton"    "grep -q '__openclaw_gatewayEventBus__' src/gateway/server-broadcast.ts"
check "P32. SSE Retryable Error"       "grep -q 'RETRYABLE_LIFECYCLE_ERROR' src/gateway/server-chat.ts"

echo ""
echo "── Gateway Core ──"
check "P13. Verbose Light"             "grep -q '\"light\"' src/auto-reply/thinking.shared.ts || grep -q '\"light\"' src/auto-reply/thinking.ts"
check "P19. Gateway Media"             "grep -q 'media' src/gateway/server-http.ts"
check "P22. Chat Media Pipeline"       "grep -q 'audioUrlByIndex' src/gateway/server-methods/chat.ts"
check "P23. Chat Internal Route"       "grep -q 'INTERNAL_MESSAGE_CHANNEL' src/gateway/server-methods/chat.ts"
check "P25. HTTP Tools Channel"        "grep -q 'listChannelAgentTools' src/gateway/tools-invoke-http.ts"
check "P26. ThinkingDefault"           "grep -q 'thinkingDefault' src/gateway/server-methods/chat.ts"
check "P27. Media Inbound Path"        "grep -q 'inbound' src/gateway/server-http.ts"
check "P29. Chat Sender Meta"          "grep -q 'senderMeta' src/gateway/server-methods/chat.ts"
check "P30. Chat Group Context"        "grep -q 'chatHistory' src/gateway/server-methods/chat.ts"

echo ""
echo "── Auth / Scope ──"
check "P23b. Control UI Scope Bypass"  "grep -q 'dangerouslyDisableDeviceAuth' src/gateway/server/ws-connection/message-handler.ts"

echo ""
echo "── Optional / Pending ──"
check "P21. Chat Audio Inbound"        "test -f src/gateway/chat-attachments.ts"
# P24 (Silent Reply Filter) — intentionally skipped, not a bug
# P28 (SSE Cron Filter) — dropped, replaced by P16 session scoping

echo ""
echo "Results: $pass passed, $fail failed (of $((pass + fail)) checks)"
if [[ $fail -eq 0 ]]; then
  echo "✅ All patches intact."
else
  echo "⚠️  Some patches may be missing. Review before pushing."
fi
exit $fail
