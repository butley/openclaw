#!/bin/bash
# Verify all custom patches survived an upstream merge.
# Usage: verify-patches.sh [repo-path]
# Run from or pass path to ~/Projects/openclaw

set -euo pipefail

cd "${1:-$(pwd)}"

echo "=== Butley Fork — Patch Verification ==="

pass=0
fail=0

check() {
  local name="$1"
  local cmd="$2"
  printf "  %-32s" "$name"
  if eval "$cmd" > /dev/null 2>&1; then
    echo "✓ OK"
    pass=$((pass + 1))
  else
    echo "✗ MISSING"
    fail=$((fail + 1))
  fi
}

check "2. Brazil JID"              "grep -q 'resolveJidWithBrazil' src/web/outbound.ts"
check "3. Audio Transcript"        "grep -q '🎤' src/auto-reply/reply/get-reply.ts"
check "4. Chat Mirror"             "grep -rq 'mirror' src/gateway/server-chat.ts"
check "5. WS Inbound Push"        "test -f src/infra/inbound-events.ts"
check "7. TUI Dark Theme"         "grep -q '236' src/tui/theme/theme.ts"
check "8. Status Card"             "grep -q 'padLabel' src/auto-reply/status.ts"
check "9. QMD Output Limit"       "grep -q 'maxOutputChars' src/memory/qmd-manager.ts"
check "10. Logs Pretty"            "test -f src/cli/logs-pretty-formatter.ts && grep -q 'pretty' src/cli/logs-cli.ts"
check "11. WA Paragraph Streaming" "grep -q 'streamDelayMs' src/web/auto-reply/deliver-reply.ts"
check "12. WA Login Tool Dedup"    "grep -q 'provided by core' extensions/whatsapp/index.ts"
check "13. Verbose Light"          "grep -q '\"light\"' src/auto-reply/thinking.ts"
check "14. WA Outbound Mentions"   "grep -q 'processOutboundMentions' src/web/inbound/send-api.ts"
check "15. Webchat Thinking"       "grep -q 'streamReasoning: true' src/agents/pi-embedded-subscribe.ts"
check "16. Tool Events Broadcast"  "grep -q '_broadcastToConnIds' src/gateway/server-chat.ts"
check "17. Streaming Throttle"     "grep -q '50ms throttle' src/gateway/server-chat.ts"
check "18. SSE Streaming"          "test -f src/gateway/server-sse.ts"
check "19. Gateway Media"          "grep -q '\"media\"' src/gateway/server-http.ts"
check "20. Image Generate Tool"    "test -f src/agents/tools/image-generate-tool.ts"
check "21. Chat Audio Inbound"     "test -f src/gateway/chat-attachments.ts"
check "22. Chat Media Pipeline"    "grep -q 'audioUrlByIndex' src/gateway/server-methods/chat.ts"
check "23. Chat Internal Route"    "grep -q 'INTERNAL_MESSAGE_CHANNEL' src/gateway/server-methods/chat.ts"
check "24. Silent Filter Remove"   "! grep -q 'extractAssistantTextForSilentCheck' src/gateway/server-methods/chat.ts"
check "25. HTTP Tools Channel"     "grep -q 'listChannelAgentTools' src/gateway/tools-invoke-http.ts"
check "26. ThinkingDefault"        "grep -q 'thinkingDefault' src/gateway/server-methods/chat.ts"
check "27. Media Inbound Path"     "grep -q 'inbound' src/gateway/server-http.ts"
check "28. SSE Cron Filter"        "grep -q ':cron:' src/gateway/server-sse.ts"
check "29. Chat Sender Meta"      "grep -q 'senderMeta' src/gateway/server-methods/chat.ts"
check "30. Chat Group Context"    "grep -q 'chatHistory' src/gateway/server-methods/chat.ts"
check "31. SSE EventBus Singleton" "grep -q '__openclaw_gatewayEventBus__' src/gateway/server-broadcast.ts"
check "38. Hide OpenClaw Branding" "! grep -n 'OpenClaw' src/agents/system-prompt.ts | grep -qv 'import\|//'"

echo ""
echo "Results: $pass passed, $fail failed"
[[ $fail -eq 0 ]] && echo "All patches intact." || echo "⚠ Some patches may be missing. Review before pushing."
exit $fail
