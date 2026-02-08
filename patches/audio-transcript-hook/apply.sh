#!/bin/bash
set -e

TARGET="$HOME/.npm-global/lib/node_modules/clawdbot/dist/auto-reply/reply/get-reply.js"

# Backup original
cp "$TARGET" "$TARGET.bak" 2>/dev/null || true

# Check if already patched
if grep -q "// PATCH: Audio transcript hook" "$TARGET"; then
    echo "Already patched."
    exit 0
fi

# Create the patched version
# We need to add a hook emission after applyMediaUnderstanding

node << 'NODEJS'
const fs = require('fs');
const path = process.env.HOME + '/.npm-global/lib/node_modules/clawdbot/dist/auto-reply/reply/get-reply.js';
let code = fs.readFileSync(path, 'utf8');

// Add import for hook runner at the top (after other imports)
const importLine = 'import { getGlobalHookRunner } from "../../plugins/hook-runner-global.js";';
if (!code.includes('hook-runner-global')) {
    // Find the last import line and add after it
    const importMatch = code.match(/^import .+;$/m);
    if (importMatch) {
        const lastImportIndex = code.lastIndexOf('import ');
        const lineEnd = code.indexOf('\n', lastImportIndex);
        code = code.slice(0, lineEnd + 1) + importLine + '\n' + code.slice(lineEnd + 1);
    }
}

// Find the applyMediaUnderstanding call and add hook after it
const mediaUnderstandingPattern = /await applyMediaUnderstanding\(\{[\s\S]*?\}\);/;
const match = code.match(mediaUnderstandingPattern);

if (match) {
    const hookCode = `
        // PATCH: Audio transcript hook - emit message_received with transcript
        if (finalized.Transcript) {
            const hookRunner = getGlobalHookRunner();
            if (hookRunner?.hasHooks?.("message_received")) {
                void hookRunner.runMessageReceived({
                    from: finalized.From ?? "",
                    content: "🎤 " + finalized.Transcript,
                    timestamp: finalized.Timestamp,
                    metadata: {
                        to: finalized.To,
                        provider: finalized.Provider,
                        surface: finalized.Surface,
                        senderE164: finalized.SenderE164,
                        isTranscript: true,
                        originalBody: "<media:audio>",
                    },
                }, {
                    channelId: (finalized.OriginatingChannel ?? finalized.Surface ?? finalized.Provider ?? "").toLowerCase(),
                    accountId: finalized.AccountId,
                    conversationId: finalized.OriginatingTo ?? finalized.To ?? finalized.From,
                }).catch(() => {});
            }
        }`;
    
    code = code.replace(match[0], match[0] + hookCode);
    fs.writeFileSync(path, code);
    console.log('✅ Patched successfully');
} else {
    console.log('❌ Could not find applyMediaUnderstanding call');
    process.exit(1);
}
NODEJS

echo "Patch applied. Restart gateway to take effect."
