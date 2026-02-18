#!/usr/bin/env bash
set -euo pipefail

# Standalone patch for vanilla OpenClaw installs where WhatsApp TTS may not
# be mapped to Opus output like Telegram.
#
# What it patches in dist/tts/tts.js:
# 1) resolveOutputFormat(): telegram -> telegram || whatsapp
# 2) resolveChannelId(): fast-path for whatsapp/telegram lower-case channel ids

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '%s\n' "$*"; }
warn() { printf '⚠️ %s\n' "$*"; }
err() { printf '❌ %s\n' "$*" >&2; }

find_tts_file() {
  # 1) Explicit override
  if [[ -n "${TTS_FILE:-}" && -f "${TTS_FILE}" ]]; then
    printf '%s\n' "$TTS_FILE"
    return 0
  fi

  # 2) Resolve from current Node environment (best effort)
  local resolved=""
  resolved="$(node -e "try { console.log(require.resolve('openclaw/dist/tts/tts.js')); } catch (_) {}" 2>/dev/null || true)"
  if [[ -n "$resolved" && -f "$resolved" ]]; then
    printf '%s\n' "$resolved"
    return 0
  fi

  # 3) Common global npm install locations
  local candidates=(
    "$HOME/.npm-global/lib/node_modules/openclaw/dist/tts/tts.js"
    "/usr/local/lib/node_modules/openclaw/dist/tts/tts.js"
    "/usr/lib/node_modules/openclaw/dist/tts/tts.js"
    "/opt/homebrew/lib/node_modules/openclaw/dist/tts/tts.js"
    "$SCRIPT_DIR/../dist/tts/tts.js"
  )

  local f
  for f in "${candidates[@]}"; do
    if [[ -f "$f" ]]; then
      printf '%s\n' "$f"
      return 0
    fi
  done

  return 1
}

restart_gateway_if_possible() {
  local restarted=0

  if command -v systemctl >/dev/null 2>&1; then
    if systemctl --user list-unit-files | grep -q '^openclaw-gateway\.service'; then
      log "↻ Restarting openclaw-gateway.service"
      systemctl --user restart openclaw-gateway.service
      restarted=1
    elif systemctl --user list-unit-files | grep -q '^clawdbot-gateway\.service'; then
      log "↻ Restarting clawdbot-gateway.service"
      systemctl --user restart clawdbot-gateway.service
      restarted=1
    fi
  fi

  if [[ "$restarted" -eq 0 ]]; then
    warn "Could not auto-restart gateway service. Restart manually (e.g. 'openclaw gateway restart')."
  fi
}

main() {
  log "=== WhatsApp Opus TTS Standalone Patch ==="

  local tts_file
  if ! tts_file="$(find_tts_file)"; then
    err "Could not locate dist/tts/tts.js."
    err "Set TTS_FILE explicitly, e.g.:"
    err "  TTS_FILE=/path/to/openclaw/dist/tts/tts.js bash patches/apply-whatsapp-opus.sh"
    exit 1
  fi

  log "Target: $tts_file"

  # Idempotency check
  if grep -q 'channelId === "telegram" || channelId === "whatsapp"' "$tts_file" \
     && grep -q 'lower === "whatsapp" || lower === "telegram"' "$tts_file"; then
    log "✓ Already patched"
    exit 0
  fi

  TTS_FILE="$tts_file" node <<'NODE'
const fs = require('fs');
const path = process.env.TTS_FILE;
let content = fs.readFileSync(path, 'utf8');

let changed = false;

// Patch #1: resolveOutputFormat telegram -> telegram || whatsapp
if (!content.includes('channelId === "telegram" || channelId === "whatsapp"')) {
  const next = content.replace(
    'if (channelId === "telegram") {',
    'if (channelId === "telegram" || channelId === "whatsapp") {'
  );
  if (next !== content) {
    content = next;
    changed = true;
  }
}

// Patch #2: resolveChannelId() fast-path includes whatsapp
if (!content.includes('lower === "whatsapp" || lower === "telegram"')) {
  const next = content.replace(
    /function resolveChannelId\(channel\) \{\s*if \(!channel\) \{\s*return null;\s*\}\s*const lower = String\(channel\)\.toLowerCase\(\)\.trim\(\);\s*if \(lower === "telegram"\) \{\s*return lower;\s*\}\s*return normalizeChannelId\(channel\);\s*\}/m,
    `function resolveChannelId(channel) {
  if (!channel) {
    return null;
  }
  const lower = String(channel).toLowerCase().trim();
  if (lower === "whatsapp" || lower === "telegram") {
    return lower;
  }
  return normalizeChannelId(channel);
}`
  );
  if (next !== content) {
    content = next;
    changed = true;
  }
}

if (!changed) {
  console.log('ℹ️ No replacements applied (possibly different upstream layout).');
  process.exit(2);
}

fs.writeFileSync(path, content);
console.log('✓ Patched tts.js');
NODE

  local rc=$?
  if [[ "$rc" -eq 2 ]]; then
    warn "Pattern not found exactly. Your OpenClaw build may already include equivalent logic or has different minified output."
    warn "Validate manually in dist/tts/tts.js before proceeding."
    exit 1
  elif [[ "$rc" -ne 0 ]]; then
    err "Patch application failed."
    exit "$rc"
  fi

  restart_gateway_if_possible
  log "✓ Done"
}

main "$@"
