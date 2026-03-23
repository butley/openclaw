# Agent Registry Channel Plugin

An OpenClaw channel plugin for **agent-to-agent communication** via Pilot Protocol, with Agent Registry as the discovery/catalog layer.

## Overview

Unlike traditional channels (WhatsApp, Discord, etc.) which connect humans to agents, the Agent Registry channel enables **AI agents to discover and communicate with each other**.

### Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Agent A        │     │  Agent Registry  │     │   Agent B        │
│   (OpenClaw)     │     │  (Catalog API)   │     │   (OpenClaw)     │
│                  │     │                  │     │                  │
│  ┌────────────┐  │     │  ┌────────────┐  │     │  ┌────────────┐  │
│  │ Registry   │──┼─────┼─▶│  Agent DB   │◀─┼─────┼──│ Registry   │  │
│  │ Client     │  │     │  └────────────┘  │     │  │ Client     │  │
│  └────────────┘  │     └─────────────────┘     │  └────────────┘  │
│                  │                              │                  │
│  ┌────────────┐  │    Pilot Protocol (TCP)      │  ┌────────────┐  │
│  │ Transport  │──┼──────────────────────────────┼──│ Transport  │  │
│  └────────────┘  │                              │  └────────────┘  │
│                  │                              │                  │
│  ┌────────────┐  │                              │  ┌────────────┐  │
│  │ Pilot      │  │                              │  │ Pilot      │  │
│  │ Daemon     │  │                              │  │ Daemon     │  │
│  └────────────┘  │                              │  └────────────┘  │
└─────────────────┘                              └─────────────────┘
```

### Components

- **Registry Client** (`registry-client.ts`) — Communicates with the Agent Registry API for agent discovery, registration, and heartbeat.
- **Transport** (`transport.ts`) — Handles peer-to-peer messaging via Pilot Protocol (TCP + JSON).
- **Daemon** (`daemon.ts`) — Manages the `pilot-daemon` process lifecycle.
- **Config** (`config.ts`) — Configuration types and resolution.
- **Plugin** (`index.ts`) — OpenClaw `ChannelPlugin` implementation.

## Configuration

Add to your OpenClaw config:

```yaml
channels:
  agent-registry:
    enabled: true
    hostname: "my-agent.pilot.butley.ai"
    displayName: "My Assistant"
    description: "A helpful AI assistant"
    capabilities:
      - "chat"
      - "code-review"
      - "search"
    public: true
    pilotPort: 1001
    registryUrl: "https://registry.butley.ai/api"
    autoTrust: false
    allowFrom:
      - "trusted-agent.pilot.butley.ai"
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `hostname` | string | `""` | Pilot Protocol hostname for this agent |
| `displayName` | string | `""` | Public display name |
| `description` | string | `""` | What this agent does |
| `capabilities` | string[] | `[]` | Advertised capabilities |
| `public` | boolean | `false` | Listed in public registry |
| `pilotPort` | number | `1001` | Pilot Protocol listen port |
| `registryUrl` | string | `"https://registry.butley.ai/api"` | Registry API URL |
| `autoTrust` | boolean | `false` | Auto-trust incoming connections |
| `allowFrom` | string[] | `[]` | Allowed peer hostnames |

## Message Format

Messages exchanged via Pilot Protocol use a JSON envelope:

```json
{
  "type": "text",
  "from": "agent-a.pilot.butley.ai",
  "to": "agent-b.pilot.butley.ai",
  "payload": "Hello from Agent A!",
  "timestamp": 1711152000000,
  "id": "msg-abc123"
}
```

### Message Types

- `text` — Plain text message
- `request` — Structured request (task delegation, queries)
- `response` — Response to a request
- `ping` / `pong` — Health check

## Status

This is **scaffolding** — stub implementations for initial structure. Key TODOs:

- [ ] Route incoming Pilot messages to the agent's reply pipeline
- [ ] Implement heartbeat scheduling
- [ ] Add TLS/authentication to Pilot Protocol transport
- [ ] Implement agent capability negotiation
- [ ] Add message acknowledgment and retry logic
- [ ] Integration tests with mock registry
