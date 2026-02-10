#!/bin/bash
set -e

echo "=========================================="
echo "[ENTRYPOINT] Starting at $(date)"
echo "=========================================="

# Add bun to PATH (for QMD memory search)
export PATH="/root/.bun/bin:$PATH"

# Ensure .openclaw directories exist
mkdir -p /root/.openclaw/devices

# Check if credentials were pre-configured (injected by orchestrator)
echo "[ENTRYPOINT] Checking for pre-configured credentials..."
if [ -f "/root/.openclaw/gateway-credentials.json" ]; then
    echo "[ENTRYPOINT] Found pre-configured credentials from mounted volume"

    # Read gateway token from pre-configured file
    export OPENCLAW_GATEWAY_TOKEN=$(python3 -c "import json; print(json.load(open('/root/.openclaw/gateway-credentials.json'))['gatewayToken'])")
    FRONTEND_DEVICE_ID=$(python3 -c "import json; print(json.load(open('/root/.openclaw/gateway-credentials.json'))['frontendDeviceId'])")
    FRONTEND_DEVICE_TOKEN=$(python3 -c "import json; print(json.load(open('/root/.openclaw/gateway-credentials.json'))['frontendDeviceToken'])")
else
    echo "[ENTRYPOINT] No pre-configured credentials found, generating new ones..."

    # Generate gateway token if not provided via env var
    if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
        export OPENCLAW_GATEWAY_TOKEN=$(openssl rand -hex 16)
    fi

    # Frontend device ID - can be passed as env var or use default
    FRONTEND_DEVICE_ID="${FRONTEND_DEVICE_ID:-butley-frontend-device}"

    # Frontend device token - can be passed as env var or generate one
    if [ -z "$FRONTEND_DEVICE_TOKEN" ]; then
        FRONTEND_DEVICE_TOKEN=$(openssl rand -hex 16)
    fi

    TIMESTAMP_MS=$(date +%s)000

    # Save generated credentials
    cat > /root/.openclaw/gateway-credentials.json << EOF
{
  "gatewayToken": "${OPENCLAW_GATEWAY_TOKEN}",
  "frontendDeviceId": "${FRONTEND_DEVICE_ID}",
  "frontendDeviceToken": "${FRONTEND_DEVICE_TOKEN}",
  "createdAtMs": ${TIMESTAMP_MS}
}
EOF
fi

# Create paired.json if not pre-configured
echo "[ENTRYPOINT] Setting up device pairing..."
if [ ! -f "/root/.openclaw/devices/paired.json" ]; then
    echo "[ENTRYPOINT] Creating paired.json with pre-registered devices..."
    TIMESTAMP_MS=$(date +%s)000

    cat > /root/.openclaw/devices/paired.json << EOF
{
  "${FRONTEND_DEVICE_ID}": {
    "deviceId": "${FRONTEND_DEVICE_ID}",
    "platform": "web",
    "clientId": "butley-frontend",
    "clientMode": "webchat",
    "role": "operator",
    "roles": ["operator"],
    "scopes": [
      "operator.admin",
      "operator.approvals",
      "operator.pairing"
    ],
    "tokens": {
      "operator": {
        "token": "${FRONTEND_DEVICE_TOKEN}",
        "role": "operator",
        "scopes": [
          "operator.admin",
          "operator.approvals",
          "operator.pairing"
        ],
        "createdAtMs": ${TIMESTAMP_MS}
      }
    },
    "createdAtMs": ${TIMESTAMP_MS},
    "approvedAtMs": ${TIMESTAMP_MS}
  }
}
EOF
else
    echo "[ENTRYPOINT] Using pre-configured paired.json from mounted volume"
fi

# Create empty pending.json if not exists
if [ ! -f "/root/.openclaw/devices/pending.json" ]; then
    echo "[]" > /root/.openclaw/devices/pending.json
fi

# Gateway configuration (trustedProxies, controlUi, auth) is now defined in the
# reference folder's openclaw.json and copied during provisioning.
# The entrypoint no longer modifies openclaw.json - all config comes from reference.

echo "============================================"
echo "OpenClaw Gateway Starting"
echo "============================================"
echo "Gateway Token: $OPENCLAW_GATEWAY_TOKEN"
echo "Frontend Device ID: $FRONTEND_DEVICE_ID"
echo "Workspace: /root/clawd"
echo "============================================"

# Change to workspace directory
cd /root/clawd

# Start bootstrap script in background (will inject onboarding after gateway is ready)
if [ -f "/root/clawd/BOOTSTRAP.md" ]; then
    echo "[ENTRYPOINT] BOOTSTRAP.md found! Starting bootstrap-agent.sh in background..."
    /bootstrap-agent.sh &
else
    echo "[ENTRYPOINT] No BOOTSTRAP.md found, skipping bootstrap"
fi

# Start the gateway
echo "[ENTRYPOINT] Launching OpenClaw gateway..."
exec openclaw gateway \
    --port "${OPENCLAW_PORT:-18789}" \
    --bind "${OPENCLAW_BIND:-lan}" \
    --allow-unconfigured \
    --verbose
