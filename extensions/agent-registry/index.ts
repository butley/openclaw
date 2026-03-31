/**
 * Agent Registry channel plugin — P2P agent-to-agent communication via WebSocket.
 *
 * Enables OpenClaw agents to discover and communicate with other AI agents
 * through the Agent Registry and P2P WebSocket connections.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/signal";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/signal";
import type { ChannelPlugin } from "openclaw/plugin-sdk/signal";
import type { ResolvedAgentRegistryAccount } from "./src/types.js";
import { agentRegistryConfigAdapter } from "./src/config.js";
import { AgentRegistryClient } from "./src/discovery.js";
import { fetchNetworkMetadata, getConvexEnv } from "./src/convex-client.js";
import { createAgentNetworkTool } from "./src/agent-network-tool.js";
import { P2PServer } from "./src/p2p/server.js";
import { P2PClient } from "./src/p2p/client.js";
import { ConnectionPool } from "./src/p2p/connection-pool.js";

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

/** P2P Server per account, keyed by accountId. */
const p2pServers = new Map<string, P2PServer>();

/** P2P Client per account, keyed by accountId. */
const p2pClients = new Map<string, P2PClient>();

/** Registry client + agentId per account, for deregister on stop and client reuse. */
const registryClients = new Map<string, { client: AgentRegistryClient; agentId?: string }>();

/** Heartbeat intervals per account. */
const heartbeatIntervals = new Map<string, ReturnType<typeof setInterval>>();

/** Heartbeat failure counter per account, for re-registration logic. */
const heartbeatFailures = new Map<string, number>();

/** Whether currently registered in the registry (per account). */
const registeredState = new Map<string, boolean>();

/** Cached account context for refresh and message injection. */
const accountContexts = new Map<string, {
  config: import("./src/types.js").AgentRegistryConfig;
  log: any;
  setStatus: (next: any) => void;
  channelRuntime: any;
  cfg: any;
}>();

/** Connection pool for outbound P2P connections (shared across accounts). */
const connectionPool = new ConnectionPool(20, 50);

const MAX_HEARTBEAT_FAILURES = 3;

/* ------------------------------------------------------------------ */
/*  Register / deregister helpers                                      */
/* ------------------------------------------------------------------ */

async function registerAgent(
  accountId: string,
  config: import("./src/types.js").AgentRegistryConfig,
  client: AgentRegistryClient,
  networkMeta: any,
  p2pPort: number,
  log?: any,
): Promise<void> {
  if (registeredState.get(accountId)) {
    // Already registered — update metadata instead
    const entry = registryClients.get(accountId);
    if (entry?.agentId) {
      // Deregister and re-register with fresh metadata
      try { await client.deregister(entry.agentId); } catch { /* ok */ }
    }
  }

  // Get installation_id from env
  const convexEnv = getConvexEnv();
  const installationId = convexEnv?.installationId || "unknown";
  const p2pEndpoint = process.env.P2P_ENDPOINT || `wss://localhost:${p2pPort}`;

  const regConfig = {
    ...config,
    installationId,
    p2p_endpoint: p2pEndpoint,
    displayName: networkMeta.networkDisplayName ?? config.displayName,
    description: networkMeta.networkDescription ?? config.description,
    capabilities: networkMeta.networkCapabilities ?? config.capabilities,
  };

  const regResult = await client.register(regConfig);
  if (regResult.ok) {
    log?.info?.(`Registered in Agent Registry as ${config.hostname} (id: ${regResult.agentId})`);
    registryClients.set(accountId, { client, agentId: regResult.agentId });
    registeredState.set(accountId, true);

    // Start heartbeat
    startHeartbeat(accountId, regResult.agentId, config, client, log);
  } else {
    log?.warn?.(`Failed to register in Agent Registry: ${regResult.error}`);
  }
}

async function deregisterAgent(accountId: string, log?: any): Promise<void> {
  // Stop heartbeat
  const interval = heartbeatIntervals.get(accountId);
  if (interval) {
    clearInterval(interval);
    heartbeatIntervals.delete(accountId);
  }

  // Stop P2PServer
  const server = p2pServers.get(accountId);
  if (server) {
    await server.stop();
    p2pServers.delete(accountId);
    log?.info?.("P2PServer stopped");
  }

  // Stop P2PClient
  const client = p2pClients.get(accountId);
  if (client) {
    p2pClients.delete(accountId);
    log?.info?.("P2PClient stopped");
  }

  // Deregister from registry
  const entry = registryClients.get(accountId);
  if (entry?.agentId) {
    const result = await entry.client.deregister(entry.agentId);
    if (result.ok) {
      log?.info?.(`Deregistered agent ${entry.agentId} from registry`);
    } else {
      log?.warn?.(`Failed to deregister: ${result.error}`);
    }
    // Keep client but clear agentId
    registryClients.set(accountId, { client: entry.client });
  }

  registeredState.set(accountId, false);
  heartbeatFailures.set(accountId, 0);
}

function startHeartbeat(
  accountId: string,
  agentId: string,
  config: import("./src/types.js").AgentRegistryConfig,
  client: AgentRegistryClient,
  log?: any,
): void {
  // Clear existing heartbeat if any
  const existing = heartbeatIntervals.get(accountId);
  if (existing) clearInterval(existing);

  let currentAgentId = agentId;
  const interval = setInterval(async () => {
    const hb = await client.heartbeat(currentAgentId);
    if (!hb.ok) {
      const failures = (heartbeatFailures.get(accountId) ?? 0) + 1;
      heartbeatFailures.set(accountId, failures);
      log?.warn?.(`Heartbeat failed (${failures}/${MAX_HEARTBEAT_FAILURES}): ${hb.error}`);

      if (failures >= MAX_HEARTBEAT_FAILURES) {
        log?.info?.("Max heartbeat failures — re-registering with full metadata");
        heartbeatFailures.set(accountId, 0);
        try { await client.deregister(currentAgentId); } catch { /* ok */ }
        
        const networkMeta = await fetchNetworkMetadata();
        const p2pPort = parseInt(process.env.P2P_PORT || "18790", 10);
        if (networkMeta) {
          await registerAgent(accountId, config, client, networkMeta, p2pPort, log);
          const entry = registryClients.get(accountId);
          if (entry?.agentId) {
            currentAgentId = entry.agentId;
            log?.info?.(`Re-registered as ${config.hostname} (new id: ${currentAgentId})`);
          }
        } else {
          // Fallback: register with base config if Convex is unavailable
          const reReg = await client.register(config);
          if (reReg.ok && reReg.agentId) {
            currentAgentId = reReg.agentId;
            registryClients.set(accountId, { client, agentId: currentAgentId });
            log?.info?.(`Re-registered as ${config.hostname} (new id: ${currentAgentId})`);
          }
        }
      }
    } else {
      heartbeatFailures.set(accountId, 0);
    }
  }, 60_000);
  if (interval.unref) interval.unref();
  heartbeatIntervals.set(accountId, interval);
}

/** Handle refresh signal — check Convex and register/deregister accordingly. */
async function handleRefresh(accountId: string): Promise<{ action: string; discoverable: boolean }> {
  const ctx = accountContexts.get(accountId);
  const entry = registryClients.get(accountId);
  if (!ctx || !entry) {
    return { action: "error", discoverable: false };
  }

  const networkMeta = await fetchNetworkMetadata();
  const isDiscoverable = networkMeta?.networkDiscoverable === true;
  const isRegistered = registeredState.get(accountId) === true;

  const p2pPort = parseInt(process.env.P2P_PORT || "18790", 10);

  if (isDiscoverable && !isRegistered) {
    // Go public
    await registerAgent(accountId, ctx.config, entry.client, networkMeta!, p2pPort, ctx.log);
    return { action: "registered", discoverable: true };
  } else if (!isDiscoverable && isRegistered) {
    // Go private
    await deregisterAgent(accountId, ctx.log);
    return { action: "deregistered", discoverable: false };
  } else if (isDiscoverable && isRegistered) {
    // Update metadata (display name, description, capabilities may have changed)
    await registerAgent(accountId, ctx.config, entry.client, networkMeta!, p2pPort, ctx.log);
    return { action: "updated", discoverable: true };
  }

  return { action: "no-change", discoverable: isDiscoverable };
}

/* ------------------------------------------------------------------ */
/*  Message injection via P2P Server                                   */
/* ------------------------------------------------------------------ */

/**
 * Inject a received P2P message into the OpenClaw session.
 * Uses the same pattern as the old Pilot Protocol message injection.
 */
async function injectP2PMessage(params: {
  accountId: string;
  fromId: string;
  fromHostname: string;
  body: string;
  log?: any;
}): Promise<void> {
  const { accountId, fromId, fromHostname, body, log } = params;
  const ctx = accountContexts.get(accountId);
  
  if (!ctx) {
    log?.warn?.(`No account context for ${accountId} to inject P2P message`);
    return;
  }

  const { config, channelRuntime, cfg } = ctx;

  try {
    // Resolve route with per-channel-peer scope for DM sessions
    const route = channelRuntime.routing.resolveAgentRoute({
      cfg,
      channel: "agent-registry",
      accountId,
      peer: {
        kind: "direct",
        id: fromHostname,
      },
    });

    // Inject the message
    const msgCtx = channelRuntime.reply.finalizeInboundContext({
      Body: body,
      BodyForAgent: body,
      RawBody: body,
      CommandBody: body,
      From: `agent-registry:${fromHostname}`,
      To: config.hostname,
      SessionKey: route.sessionKey,
      AccountId: accountId,
      OriginatingChannel: "agent-registry",
      OriginatingTo: config.hostname,
      ChatType: "direct",
      SenderName: fromHostname,
      SenderId: fromId,
      Provider: "agent-registry",
      Surface: "agent-registry",
      ConversationLabel: fromHostname,
      Timestamp: Date.now(),
      CommandAuthorized: true,
    });

    await channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: msgCtx,
      cfg,
      dispatcherOptions: {
        deliver: async (payload: { text?: string; body?: string }) => {
          // Messages arrive via P2P — no reply delivery needed
          log?.debug?.(`P2P message injected and processed from ${fromHostname}`);
        },
      },
    });

    log?.info?.(`Injected P2P message from ${fromHostname} (id: ${fromId})`);
  } catch (err) {
    log?.error?.(`Failed to inject P2P message: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Channel plugin definition                                          */
/* ------------------------------------------------------------------ */

export const agentRegistryPlugin: ChannelPlugin<ResolvedAgentRegistryAccount> = {
  id: "agent-registry",

  meta: {
    id: "agent-registry",
    label: "Agent Registry",
    selectionLabel: "Agent Registry (P2P WebSocket)",
    docsPath: "/channels/agent-registry",
    blurb: "Discover and communicate with AI agents via P2P WebSocket",
  },

  capabilities: {
    chatTypes: ["direct"],
    media: false,
    reactions: false,
    threads: false,
    polls: false,
  },

  config: agentRegistryConfigAdapter,

  outbound: {
    deliveryMode: "direct",

    sendText: async (ctx) => {
      // Get P2PClient for this account
      const p2pClient = p2pClients.get(ctx.accountId);
      if (!p2pClient) {
        return { ok: false, error: new Error("P2P client not available") } as any;
      }

      // Send via P2P WebSocket
      const success = await p2pClient.sendMessage(ctx.to, ctx.text);
      if (!success) {
        return { ok: false, error: new Error("P2P send failed") } as any;
      }

      return { ok: true, messageId: undefined } as any;
    },
  },

  gateway: {
    startAccount: async (ctx) => {
      const { account, accountId, log, setStatus, getStatus, channelRuntime, abortSignal, cfg } = ctx;
      const config = account.config;

      if (!config.enabled || !config.hostname) {
        log?.info?.("Agent Registry not configured — skipping start");
        return;
      }

      const registryUrl = config.registryUrl ?? "http://localhost:8001";
      const registryClient = new AgentRegistryClient(registryUrl, config.registryApiKey);

      // Store context for refresh calls and message injection
      registryClients.set(accountId, { client: registryClient });
      accountContexts.set(accountId, { config, log, setStatus, channelRuntime, cfg });
      heartbeatFailures.set(accountId, 0);
      registeredState.set(accountId, false);

      // Get P2P port from env
      const p2pPort = parseInt(process.env.P2P_PORT || "18790", 10);

      // Create and start P2PServer
      const p2pServer = new P2PServer({
        port: p2pPort,
        installationId: process.env.BUTLEY_INSTALLATION_ID || "unknown",
        hostname: config.hostname,
        registryUrl,
        registryApiKey: config.registryApiKey,
        onMessage: async (fromId: string, fromHostname: string, body: string) => {
          // Inject message into session
          await injectP2PMessage({
            accountId,
            fromId,
            fromHostname,
            body,
            log,
          });
        },
      });

      try {
        await p2pServer.start();
        p2pServers.set(accountId, p2pServer);
        log?.info?.(`P2PServer started on port ${p2pPort}`);
      } catch (err) {
        log?.error?.(`Failed to start P2PServer: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Create P2PClient for outbound connections
      const p2pClient = new P2PClient({
        installationId: process.env.BUTLEY_INSTALLATION_ID || "unknown",
        hostname: config.hostname,
        registryUrl,
        connectionPool,
      });

      p2pClients.set(accountId, p2pClient);
      log?.info?.("P2PClient created");

      // Check Convex for networkDiscoverable — only register if public
      const networkMeta = await fetchNetworkMetadata();
      if (networkMeta?.networkDiscoverable) {
        await registerAgent(accountId, config, registryClient, networkMeta, p2pPort, log);
      } else {
        log?.info?.("Workspace is not public — standing by (waiting for refresh signal)");
      }

      // Mark channel as started (even if not registered — channel is alive and ready for refresh)
      setStatus({ accountId, connected: true, running: true });

      // Keep the channel alive — gateway restarts if startAccount resolves.
      await new Promise<void>((resolve) => {
        if (abortSignal?.aborted) return resolve();
        if (abortSignal) {
          abortSignal.addEventListener("abort", () => resolve(), { once: true });
        }
      });
      log?.info?.("Agent Registry channel stopped (abort signal received)");
    },

    stopAccount: async (ctx) => {
      const { accountId, log } = ctx;

      await deregisterAgent(accountId, log);
      registryClients.delete(accountId);
      accountContexts.delete(accountId);
    },
  },

  gatewayMethods: [
    "agent-registry/status",
    "agent-registry/search",
    "agent-registry/refresh",
  ],

  status: {
    buildAccountSnapshot: async ({ account, runtime }) => {
      const server = p2pServers.get(account.accountId);
      return {
        accountId: account.accountId,
        enabled: account.config.enabled,
        configured: !!account.config.hostname,
        connected: !!server,
        running: registeredState.get(account.accountId) === true,
        p2p_port: parseInt(process.env.P2P_PORT || "18790", 10),
        ...runtime,
      };
    },
  },

  heartbeat: {
    checkReady: async ({ cfg, accountId }) => {
      const account = agentRegistryConfigAdapter.resolveAccount(cfg, accountId);
      if (!account.config.enabled) {
        return { ok: false, reason: "Agent Registry is disabled" };
      }
      if (!account.config.hostname) {
        return { ok: false, reason: "Agent Registry hostname not configured" };
      }
      return { ok: true, reason: "Agent Registry is ready" };
    },
  },
};

/* ------------------------------------------------------------------ */
/*  Plugin registration                                                */
/* ------------------------------------------------------------------ */

const plugin = {
  id: "agent-registry",
  name: "Agent Registry",
  description: "P2P agent-to-agent communication via WebSocket",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerChannel({ plugin: agentRegistryPlugin });

    // Register agent_network tool for LLM to search/contact other agents
    const tool = createAgentNetworkTool(api);
    if (tool && api.registerTool) {
      api.registerTool(tool);
    }

    // Register gateway HTTP method handlers
    if (api.registerGatewayMethod) {
      // GET /api/agent-registry/status — P2P status + registry info
      api.registerGatewayMethod("agent-registry/status", async ({ respond }) => {
        const statuses: Record<string, any> = {};
        for (const [accountId, server] of p2pServers) {
          const connections = server.getConnections?.();
          statuses[accountId] = {
            p2p_running: true,
            connections: connections?.length ?? 0,
            p2p_port: parseInt(process.env.P2P_PORT || "18790", 10),
            registered: registeredState.get(accountId) ?? false,
          };
        }
        respond(true, { accounts: statuses });
      });

      // GET /api/agent-registry/search — search for agents by query or capabilities
      api.registerGatewayMethod("agent-registry/search", async ({ params, respond }) => {
        const registryUrl = (params?.registryUrl as string) ?? "http://localhost:8001";
        const query = params?.query as string | undefined;
        const capabilities = params?.capabilities as string[] | undefined;
        const limit = params?.limit as number | undefined;

        const storedEntry = Array.from(registryClients.values()).find(
          (e) => e.client["baseUrl"] === registryUrl.replace(/\/+$/, ""),
        );
        const client = storedEntry?.client ?? new AgentRegistryClient(registryUrl);
        const result = await client.search({ query, capabilities, limit });
        respond(result.ok, {
          peers: result.peers,
          total: result.total,
          query,
          error: result.error,
        });
      });

      // POST /api/agent-registry/refresh — re-check Convex and register/deregister
      api.registerGatewayMethod("agent-registry/refresh", async ({ params, respond }) => {
        const targetAccountId = params?.accountId as string | undefined;

        if (targetAccountId) {
          // Refresh specific account
          if (!accountContexts.has(targetAccountId)) {
            respond(false, undefined, { code: "NO_ACCOUNT", message: `No active account: ${targetAccountId}` });
            return;
          }
          const result = await handleRefresh(targetAccountId);
          respond(true, result);
        } else {
          // Refresh all accounts
          const allIds = Array.from(accountContexts.keys());
          if (allIds.length === 0) {
            respond(false, undefined, { code: "NO_ACCOUNT", message: "No active agent-registry accounts" });
            return;
          }
          const results: Record<string, { action: string; discoverable: boolean }> = {};
          for (const id of allIds) {
            results[id] = await handleRefresh(id);
          }
          respond(true, { accounts: results });
        }
      });
    }
  },
};

export default plugin;
