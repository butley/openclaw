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
  printf "  %-25s" "$name"
  if eval "$cmd" > /dev/null 2>&1; then
    echo "✓ OK"
    pass=$((pass + 1))
  else
    echo "✗ MISSING"
    fail=$((fail + 1))
  fi
}

check "2. Brazil JID"         "grep -q 'resolveJidWithBrazil' src/web/outbound.ts"
check "3. Audio Transcript"   "grep -q '🎤' src/auto-reply/reply/get-reply.ts"
check "4. Chat Mirror"        "grep -rq 'mirror' src/gateway/server-chat.ts"
check "5. WS Inbound Push"   "test -f src/infra/inbound-events.ts"
check "6. TTS Caption"        "grep -q 'caption' src/web/outbound.ts"
check "7. TUI Dark Theme"    "grep -q '236' src/tui/theme/theme.ts"
check "8. Status Card"        "grep -q 'padLabel' src/auto-reply/status.ts"
check "9. QMD Output Limit"  "grep -q 'maxOutputChars' src/memory/qmd-manager.ts"
check "10. Logs Pretty"       "test -f src/cli/logs-pretty-formatter.ts && grep -q 'pretty' src/cli/logs-cli.ts"
check "11. WA Paragraph Streaming" "grep -q 'streamDelayMs' src/web/auto-reply/deliver-reply.ts && grep -q 'effectiveChunkMode' src/web/auto-reply/monitor/process-message.ts"
check "12. WA Login Tool Dedup" "grep -q 'natively by OpenClaw' extensions/whatsapp/index.ts" "grep -q 'streamDelayMs' src/web/auto-reply/deliver-reply.ts && grep -q 'effectiveChunkMode' src/web/auto-reply/monitor/process-message.ts"

check "13. Verbose Light"        "grep -q '"light"' src/auto-reply/thinking.ts && grep -q 'verbose:light' src/auto-reply/status.ts"
check "14. WA Outbound Mentions" "grep -q 'processOutboundMentions' src/web/inbound/send-api.ts"      "grep -q '\"light\"' src/auto-reply/thinking.ts && grep -q 'verbose:light' src/auto-reply/status.ts"

echo ""
echo "Results: $pass passed, $fail failed"
[[ $fail -eq 0 ]] && echo "All patches intact." || echo "⚠ Some patches may be missing. Review before pushing."
exit $fail
