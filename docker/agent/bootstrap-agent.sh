#!/bin/bash
# bootstrap-agent.sh
# Automatically triggers onboarding if BOOTSTRAP.md exists
# Runs in background after gateway starts

echo "=========================================="
echo "[BOOTSTRAP-AGENT] Starting at $(date)"
echo "=========================================="
echo "[bootstrap] Timestamp: $(date '+%Y-%m-%d %H:%M:%S')"

WORKSPACE="/root/clawd"
BOOTSTRAP_FILE="$WORKSPACE/BOOTSTRAP.md"
GATEWAY_URL="http://127.0.0.1:${OPENCLAW_PORT:-18789}"
GATEWAY_CREDS="/root/.openclaw/gateway-credentials.json"

echo "[bootstrap] Configuration:"
echo "[bootstrap]   WORKSPACE=$WORKSPACE"
echo "[bootstrap]   BOOTSTRAP_FILE=$BOOTSTRAP_FILE"
echo "[bootstrap]   GATEWAY_URL=$GATEWAY_URL"

# Wait for gateway to be ready
wait_for_gateway() {
    echo "[bootstrap] === WAITING FOR GATEWAY ==="
    echo "[bootstrap] Waiting for gateway at $GATEWAY_URL/health..."
    for i in {1..30}; do
        if curl -s "$GATEWAY_URL/health" >/dev/null 2>&1; then
            echo "[bootstrap] ✓ Gateway is ready (attempt $i/30)"
            return 0
        fi
        echo "[bootstrap]   Attempt $i/30 - not ready yet..."
        sleep 1
    done
    echo "[bootstrap] ✗ Gateway not ready after 30s, giving up"
    return 1
}

# Load gateway token from credentials file
load_gateway_token() {
    if [ -f "$GATEWAY_CREDS" ]; then
        # Extract gatewayToken using python (more reliable than jq which may not be installed)
        TOKEN=$(python3 -c "import json; print(json.load(open('$GATEWAY_CREDS')).get('gatewayToken', ''))" 2>/dev/null)
        if [ -n "$TOKEN" ]; then
            export OPENCLAW_GATEWAY_TOKEN="$TOKEN"
            echo "[bootstrap] Gateway token loaded"
            return 0
        fi
    fi
    echo "[bootstrap] Warning: Could not load gateway token, falling back to embedded mode"
    return 1
}

# Trigger bootstrap via openclaw agent CLI (official way to "hatch" the agent)
inject_bootstrap() {
    echo "[bootstrap] === INJECTING BOOTSTRAP MESSAGE ==="
    echo "[bootstrap] BOOTSTRAP.md found at: $BOOTSTRAP_FILE"
    
    # Load gateway token for authentication
    load_gateway_token
    
    echo "[bootstrap] Preparing to inject initial message to wake up the agent..."
    echo "[bootstrap] Session ID: main"
    echo "[bootstrap] Message: [System] This is your first session. BOOTSTRAP.md exists..."
    
    # Use openclaw agent CLI to send message and trigger agent
    # With OPENCLAW_GATEWAY_TOKEN set, it will connect to the gateway properly
    echo "[bootstrap] Executing: openclaw agent --session-id main --message ..."
    RESPONSE=$(openclaw agent \
        --session-id "main" \
        --message "[System] This is your first session. BOOTSTRAP.md exists in your workspace. Please follow its instructions and introduce yourself to the user." \
        --json 2>&1)
    
    echo "[bootstrap] Response received from openclaw agent CLI:"
    echo "$RESPONSE" | head -20
    
    if echo "$RESPONSE" | grep -q '"status"'; then
        echo "[bootstrap] ✓ Onboarding triggered successfully"
        echo "[bootstrap] ✓ Agent response received"
        # Register the session in sessions.json so it appears in the frontend
        register_session
    else
        echo "[bootstrap] Bootstrap command sent (response above)"
    fi
}

# Register the main session in sessions.json
# This is needed because embedded mode doesn't automatically register sessions
register_session() {
    SESSIONS_DIR="/root/.openclaw/agents/main/sessions"
    SESSIONS_FILE="$SESSIONS_DIR/sessions.json"
    TRANSCRIPT_FILE="$SESSIONS_DIR/main.jsonl"
    
    # Only create if transcript exists but sessions.json doesn't
    if [ -f "$TRANSCRIPT_FILE" ] && [ ! -f "$SESSIONS_FILE" ]; then
        echo "[bootstrap] Registering session in sessions.json..."
        TIMESTAMP_MS=$(python3 -c "import time; print(int(time.time() * 1000))")
        SESSION_ID=$(python3 -c "import uuid; print(str(uuid.uuid4()))")
        
        cat > "$SESSIONS_FILE" << EOF
{
  "agent:main:main": {
    "sessionId": "$SESSION_ID",
    "updatedAt": $TIMESTAMP_MS,
    "chatType": "direct",
    "sessionFile": "$TRANSCRIPT_FILE"
  }
}
EOF
        echo "[bootstrap] Session registered successfully"
    fi
}

# Main
main() {
    echo "[bootstrap] === CHECKING FOR BOOTSTRAP.MD ==="
    
    # Only run if BOOTSTRAP.md exists
    # (Agent deletes BOOTSTRAP.md after completing onboarding, so this is idempotent)
    if [ ! -f "$BOOTSTRAP_FILE" ]; then
        echo "[bootstrap] No BOOTSTRAP.md found at $BOOTSTRAP_FILE"
        echo "[bootstrap] Skipping onboarding (agent already initialized or manual setup)"
        echo "=== BOOTSTRAP-AGENT.SH COMPLETED (NO BOOTSTRAP NEEDED) ==="
        exit 0
    fi
    
    echo "[bootstrap] ✓ BOOTSTRAP.md found! Starting onboarding process..."
    
    wait_for_gateway || {
        echo "=== BOOTSTRAP-AGENT.SH FAILED (GATEWAY TIMEOUT) ==="
        exit 1
    }
    
    inject_bootstrap
    
    echo "[bootstrap] === BOOTSTRAP PROCESS FINISHED ==="
    echo "=== BOOTSTRAP-AGENT.SH COMPLETED ==="
}

main
