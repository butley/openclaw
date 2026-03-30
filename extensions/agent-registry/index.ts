/**
 * Agent Registry channel plugin — P2P agent-to-agent communication via Pilot Protocol.
 *
 * Enables OpenClaw agents to discover and communicate with other AI agents
 * through the Agent Registry and Pilot Protocol.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/signal";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/signal";
import type { ChannelPlugin } from "openclaw/plugin-sdk/signal";
import type { ResolvedAgentRegistryAccount } from "./src/types.js";
import { agentRegistryConfigAdapter } from "./src/config.js";
import { sendMessage } from "./src/send.js";
import { startMonitor } from "./src/monitor.js";
import type { MonitorHandle } from "./src/monitor.js";
import { getDaemonStatus, isPilotInstalled } from "./src/daemon.js";
import { AgentRegistryClient } from "./src/discovery.js";
import { fetchNetworkMetadata, getConvexEnv } from "./src/convex-client.js";
import type { NetworkMetadata } from "./src/convex-client.js";
import { createAgentNetworkTool } from "./src/agent-network-tool.js";

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

/** Active monitor handle per account, keyed by accountId. */
const activeMonitors = new Map<string, MonitorHandle>();

/** Heartbeat intervals per account. */
const heartbeatIntervals = new Map<string, ReturnType<typeof setInterval>>();

/** Registry client + agentId per account, for deregister on stop and client reuse. */
const registryClients = new Map<string, { client: AgentRegistryClient; agentId?: string }>();

/** Heartbeat failure counter per account, for re-registration logic. */
const heartbeatFailures = new Map<string, number>();

/** Whether currently registered in the registry (per account). */
const registeredState = new Map<string, boolean>();

/** Cached account context for refresh (log, config, etc). */
const accountContexts = new Map<string, {
  config: import("./src/types.js").AgentRegistryConfig;
  log: any;
  setStatus: (next: any) => void;
}>();

const MAX_HEARTBEAT_FAILURES = 3;

/* ------------------------------------------------------------------ */
/*  Register / deregister helpers                                      */
/* ------------------------------------------------------------------ */

async function registerAgent(
  accountId: string,
  config: import("./src/types.js").AgentRegistryConfig,
  client: AgentRegistryClient,
  networkMeta: NetworkMetadata,
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
  const installationId = convexEnv?.installationId;

  // Get pilot_node_id from daemon if running
  let pilotNodeId: number | undefined;
  try {
    const pilotStatus = await getDaemonStatus();
    if (pilotStatus?.node_id) {
      pilotNodeId = pilotStatus.node_id;
    }
  } catch { /* pilot not running, ok */ }

  const regConfig = {
    ...config,
    installationId,
    pilotNodeId,
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

    // Start Pilot monitor if available
    const pilotAvailable = await isPilotInstalled();
    if (pilotAvailable && !activeMonitors.has(accountId)) {
      log?.info?.("Starting Pilot Protocol monitor");
      // Monitor setup would go here when Pilot is available
    } else if (!pilotAvailable) {
      log?.info?.("Pilot Protocol not installed — discovery-only mode");
    }
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

  // Stop monitor
  const monitor = activeMonitors.get(accountId);
  if (monitor) {
    monitor.stop();
    activeMonitors.delete(accountId);
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
        log?.info?.("Max heartbeat failures — re-registering");
        heartbeatFailures.set(accountId, 0);
        try { await client.deregister(currentAgentId); } catch { /* ok */ }
        const reReg = await client.register(config);
        if (reReg.ok && reReg.agentId) {
          currentAgentId = reReg.agentId;
          registryClients.set(accountId, { client, agentId: currentAgentId });
          log?.info?.(`Re-registered as ${config.hostname} (new id: ${currentAgentId})`);
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

  if (isDiscoverable && !isRegistered) {
    // Go public
    await registerAgent(accountId, ctx.config, entry.client, networkMeta!, ctx.log);
    return { action: "registered", discoverable: true };
  } else if (!isDiscoverable && isRegistered) {
    // Go private
    await deregisterAgent(accountId, ctx.log);
    return { action: "deregistered", discoverable: false };
  } else if (isDiscoverable && isRegistered) {
    // Update metadata (display name, description, capabilities may have changed)
    await registerAgent(accountId, ctx.config, entry.client, networkMeta!, ctx.log);
    return { action: "updated", discoverable: true };
  }

  return { action: "no-change", discoverable: isDiscoverable };
}

/* ------------------------------------------------------------------ */
/*  Channel plugin definition                                          */
/* ------------------------------------------------------------------ */

export const agentRegistryPlugin: ChannelPlugin<ResolvedAgentRegistryAccount> = {
  id: "agent-registry",

  meta: {
    id: "agent-registry",
    label: "Agent Registry",
    selectionLabel: "Agent Registry (P2P)",
    docsPath: "/channels/agent-registry",
    blurb: "Discover and communicate with AI agents via Pilot Protocol",
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
      const account = agentRegistryConfigAdapter.resolveAccount(ctx.cfg, ctx.accountId);
      const result = await sendMessage(
        { to: ctx.to, body: ctx.text },
        { pilotPort: account.config.pilotPort },
      );

      if (!result.ok) {
        return { ok: false, error: new Error(result.error ?? "Send failed") } as any;
      }

      return { ok: true, messageId: result.messageId } as any;
    },
  },

  gateway: {
    startAccount: async (ctx) => {
      const { account, accountId, log, setStatus, getStatus, channelRuntime, abortSignal } = ctx;
      const config = account.config;

      if (!config.enabled || !config.hostname) {
        log?.info?.("Agent Registry not configured — skipping start");
        return;
      }

      const registryUrl = config.registryUrl ?? "http://localhost:8001";
      const registryClient = new AgentRegistryClient(registryUrl, config.registryApiKey);

      // Store context for refresh calls
      registryClients.set(accountId, { client: registryClient });
      accountContexts.set(accountId, { config, log, setStatus });
      heartbeatFailures.set(accountId, 0);
      registeredState.set(accountId, false);

      // Check Convex for networkDiscoverable — only register if public
      const networkMeta = await fetchNetworkMetadata();
      if (networkMeta?.networkDiscoverable) {
        await registerAgent(accountId, config, registryClient, networkMeta, log);
      } else {
        log?.info?.("Workspace is not public — standing by (waiting for refresh signal)");
      }

      // Mark channel as started (even if not registered — channel is alive and ready for refresh)
      setStatus({ connected: true, running: true });

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
    "agent-registry/peers",
    "agent-registry/search",
    "agent-registry/send",
    "agent-registry/refresh",
  ],

  status: {
    buildAccountSnapshot: async ({ account, runtime }) => {
      const daemonStatus = await getDaemonStatus();
      return {
        accountId: account.accountId,
        enabled: account.config.enabled,
        configured: !!account.config.hostname,
        connected: daemonStatus.running,
        running: activeMonitors.has(account.accountId),
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
      // Only require Pilot daemon if P2P messaging is enabled (pilotPort configured)
      if (account.config.pilotPort) {
        const daemonStatus = await getDaemonStatus();
        if (!daemonStatus.running) {
          return { ok: false, reason: "Pilot daemon is not running" };
        }
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
  description: "P2P agent-to-agent communication via Pilot Protocol",
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
      // GET /api/agent-registry/status — daemon status + registry info
      api.registerGatewayMethod("agent-registry/status", async ({ respond }) => {
        const daemonStatus = await getDaemonStatus();
        respond(true, {
          daemon: daemonStatus,
          monitors: Array.from(activeMonitors.keys()),
        });
      });

      // GET /api/agent-registry/peers — list known peers from registry
      api.registerGatewayMethod("agent-registry/peers", async ({ params, respond }) => {
        const registryUrl = (params?.registryUrl as string) ?? "http://localhost:8001";
        // Reuse stored client if available, otherwise create ad-hoc
        const storedEntry = Array.from(registryClients.values()).find(
          (e) => e.client["baseUrl"] === registryUrl.replace(/\/+$/, ""),
        );
        const client = storedEntry?.client ?? new AgentRegistryClient(registryUrl);
        const result = await client.listAgents();
        respond(result.ok, {
          peers: result.peers,
          error: result.error,
        });
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
      api.registerGatewayMethod("agent-registry/refresh", async ({ respond }) => {
        // Find the active account (typically "default")
        const accountId = Array.from(accountContexts.keys())[0];
        if (!accountId) {
          respond(false, undefined, { code: "NO_ACCOUNT", message: "No active agent-registry account" });
          return;
        }
        const result = await handleRefresh(accountId);
        respond(true, result);
      });

      // POST /api/agent-registry/send — manually send a message to a peer
      api.registerGatewayMethod("agent-registry/send", async ({ params, respond }) => {
        const to = params?.to as string | undefined;
        const body = params?.body as string | undefined;
        const metadata = params?.metadata as Record<string, unknown> | undefined;
        const pilotPort = params?.pilotPort as number | undefined;

        if (!to || !body) {
          respond(false, undefined, { code: "BAD_REQUEST", message: "Missing required fields: to, body" });
          return;
        }

        const result = await sendMessage(
          { to, body, metadata },
          { pilotPort },
        );
        respond(result.ok, result, result.ok ? undefined : { code: "SEND_FAILED", message: result.error ?? "Send failed" });
      });
    }
  },
};

export default plugin;
