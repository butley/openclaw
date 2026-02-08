#!/bin/bash
# Patch: TUI Dark Theme
# Makes TUI backgrounds darker for better readability
# - userBg: #2B2F36 → #1a1a1a (user messages)
# - toolSuccessBg: uses bgAnsi(236) instead of hex (dark gray, consistent)
# - toolPendingBg: #1F2A2F → #12151a
# - toolErrorBg: #2F1F1F → #181212

THEME_FILE="$HOME/.npm-global/lib/node_modules/clawdbot/dist/tui/theme/theme.js"

if [ ! -f "$THEME_FILE" ]; then
    echo "❌ Theme file not found: $THEME_FILE"
    exit 1
fi

# Add bgAnsi helper if not present
if ! grep -q "bgAnsi" "$THEME_FILE"; then
    sed -i 's/const bg = (hex) => (text) => chalk.bgHex(hex)(text);/const bg = (hex) => (text) => chalk.bgHex(hex)(text);\nconst bgAnsi = (code) => (text) => chalk.bgAnsi256(code)(text);/' "$THEME_FILE"
fi

# Apply color patches
sed -i 's/userBg: "#2B2F36"/userBg: "#1a1a1a"/' "$THEME_FILE"
sed -i 's/toolPendingBg: "#1F2A2F"/toolPendingBg: "#12151a"/' "$THEME_FILE"
sed -i 's/toolErrorBg: "#2F1F1F"/toolErrorBg: "#181212"/' "$THEME_FILE"

# Change toolSuccessBg to use ansi256(236)
sed -i 's/toolSuccessBg: bg(palette.toolSuccessBg),/toolSuccessBg: bgAnsi(236),  \/\/ dark gray/' "$THEME_FILE"

echo "✅ TUI theme patched (darker backgrounds)"
