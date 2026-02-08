#!/bin/bash
set -e

TARGET="$HOME/.npm-global/lib/node_modules/clawdbot/dist/agents/tools/tts-tool.js"

# Backup
cp "$TARGET" "$TARGET.bak" 2>/dev/null || true

# Check if already patched
if grep -q "PATCH: Include TTS text" "$TARGET"; then
    echo "Already patched."
    exit 0
fi

# Patch: Include original text as caption before MEDIA line
node << 'NODEJS'
const fs = require('fs');
const path = process.env.HOME + '/.npm-global/lib/node_modules/clawdbot/dist/agents/tools/tts-tool.js';
let code = fs.readFileSync(path, 'utf8');

// Find the return statement with MEDIA and modify it to include text
const oldPattern = /lines\.push\(`MEDIA:\$\{result\.audioPath\}`\);/;
const newCode = `// PATCH: Include TTS text as caption for logging
                lines.push("🔊 " + text);
                lines.push("");
                lines.push(\`MEDIA:\${result.audioPath}\`);`;

if (code.match(oldPattern)) {
    code = code.replace(oldPattern, newCode);
    fs.writeFileSync(path, code);
    console.log('✅ Patched successfully');
} else {
    console.log('❌ Could not find target pattern');
    process.exit(1);
}
NODEJS

echo "Patch applied. Restart gateway."
