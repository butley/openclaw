#!/bin/bash
set -e

TTS_FILE="/home/ubuntu/.npm-global/lib/node_modules/clawdbot/dist/tts/tts.js"

echo "=== WhatsApp Opus TTS Patch ==="

if [ ! -f "$TTS_FILE" ]; then
    echo "ERROR: File not found: $TTS_FILE"
    exit 1
fi

if grep -q 'channelId === "whatsapp"' "$TTS_FILE"; then
    echo "✓ Already patched"
    exit 0
fi

echo "Applying patch..."

node -e "
const fs = require('fs');
let content = fs.readFileSync('$TTS_FILE', 'utf8');

// Fix 1: Add whatsapp to opus format check
content = content.replace(
    'if (channelId === \"telegram\")',
    'if (channelId === \"telegram\" || channelId === \"whatsapp\")'
);

// Fix 2: Add fast path for channel resolution
content = content.replace(
    /function resolveChannelId\(channel\) \{\s*return channel \? normalizeChannelId\(channel\) : null;\s*\}/,
    \`function resolveChannelId(channel) {
    if (!channel) return null;
    const lower = String(channel).toLowerCase().trim();
    if (lower === \"whatsapp\" || lower === \"telegram\") return lower;
    return normalizeChannelId(channel);
}\`
);

fs.writeFileSync('$TTS_FILE', content);
console.log('✓ Patched tts.js');
"

echo "Restarting gateway..."
systemctl --user restart clawdbot-gateway
sleep 3

echo "✓ Done"
