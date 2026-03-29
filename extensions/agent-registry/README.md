# Agent Registry Channel Plugin

P2P agent-to-agent communication via Pilot Protocol, with Agent Registry as the discovery layer.

## Architecture

```
                    ┌─────────────────────┐
                    │   Agent Registry    │
                    │   (FastAPI :8001)   │
                    │  search/register/   │
                    │     heartbeat       │
                    └────────┬────────────┘
                             │ HTTP
                    ┌────────┴────────────┐
                    │   OpenClaw Agent    │
                    │                     │
                    │  discovery.ts ←→ API│
                    │  daemon.ts → pilot  │
                    │  monitor.ts ← in    │
                    │  send.ts    → out   │
                    └────────┬────────────┘
                             │ Pilot Protocol (P2P)
                    ┌────────┴────────────┐
                    │   Remote Agent(s)   │
                    └─────────────────────┘
```

## Modules

| Module | Purpose |
|--------|---------|
| `index.ts` | ChannelPlugin — outbound adapter, gateway lifecycle, HTTP methods |
| `src/types.ts` | PilotPeer, AgentRegistryConfig, message types |
| `src/config.ts` | Config adapter (account resolution, allowFrom) |
| `src/daemon.ts` | Pilot daemon lifecycle (start/stop/status via child_process) |
| `src/monitor.ts` | Inbound listener (pilotctl subscribe, reconnect w/ backoff) |
| `src/send.ts` | Outbound sender (send, sendToAddress, broadcast) |
| `src/discovery.ts` | Agent Registry HTTP API client (register, search, heartbeat) |

## Gateway HTTP Methods

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `agent-registry/status` | Daemon status + active monitors |
| GET | `agent-registry/peers` | List known peers from registry |
| POST | `agent-registry/send` | Send message to a peer |

## Deploy as Platform Extension

This plugin is delivered to agent containers via the platform extensions system.

### 1. Copy to host

```bash
# Staging
EXT_DIR="/var/data/butley-staging/storage/platform/extensions"
mkdir -p "$EXT_DIR/agent-registry"
cp -r extensions/agent-registry/* "$EXT_DIR/agent-registry/"

# Production
EXT_DIR="/var/data/butley/storage/platform/extensions"
mkdir -p "$EXT_DIR/agent-registry"
cp -r extensions/agent-registry/* "$EXT_DIR/agent-registry/"
```

### 2. Regenerate manifest

```bash
cd /shared/code/butley/openclaw
./docker/agent/scripts/generate-manifest.sh "$EXT_DIR/"
```

### 3. Restart containers

Containers pick up the extension on next startup via `sync-platform.sh`.

```bash
# Or use upgrade-agents.sh
/shared/code/butley/backend/scripts/upgrade-agents.sh
```

### Agent Configuration

Each agent needs these in their config (applied via `platform-config.json`):

```json
{
  "plugins.entries.agent-registry.enabled": true,
  "plugins.entries.agent-registry.config.channel": "agent-registry"
}
```

Agent-specific config (hostname, registry URL, etc.) should be set per-agent via provisioning or manual config.

## Prerequisites

- **Pilot Protocol** daemon (`pilot-daemon`) installed in the container
- **Agent Registry API** running and accessible (default: http://localhost:8001)

## Status

- [x] Plugin scaffold
- [x] Daemon management (start/stop/status)
- [x] Inbound monitor (subscribe + reconnect)
- [x] Outbound sender (send + broadcast)
- [x] Discovery API client
- [x] Plugin wiring (outbound, gateway, status, heartbeat)
- [x] Platform extension config
- [ ] Routing engine integration
- [ ] Config schema (openclaw config)
- [ ] Unit tests
- [ ] Pilot Protocol installation in Docker image
