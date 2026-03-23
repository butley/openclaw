#!/bin/bash
set -e

# Add bun to PATH (for QMD memory search)
export PATH="/root/.bun/bin:$PATH"

# Export gateway token — must happen before exec so the gateway process inherits it.
if [ -f /root/.openclaw/gateway-credentials.json ]; then
    export OPENCLAW_GATEWAY_TOKEN=$(python3 -c \
        "import json; print(json.load(open('/root/.openclaw/gateway-credentials.json'))['gatewayToken'])")
fi

# Bootstrap runs in parallel — credentials, QMD indexing, gateway readiness, onboarding.
python3 /bootstrap.py &

# Gateway starts as PID 1 (receives signals properly).
exec openclaw gateway \
    --port "${OPENCLAW_PORT:-18789}" \
    --bind "${OPENCLAW_BIND:-lan}" \
    --allow-unconfigured \
    --verbose
