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
import { fetchNetworkMetadata, getConvexEnv, upsertHandshake, getHandshakeByNodeId, markFirstMessageSent, markNotificationSent } from "./src/convex-client.js";
import type { NetworkMetadata } from "./src/convex-client.js";
import { createAgentNetworkTool } from "./src/agent-network-tool.js";
import { spawn } from "node:child_process";

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

/** Poll intervals per account (for inbox/pending polling). */
const pollIntervals = new Map<string, ReturnType<typeof setInterval>>();

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
/*  Poll loop — pending handshakes + inbox messages                    */
/* ------------------------------------------------------------------ */

/** Run a pilotctl command and return parsed JSON output. */
function runPilotctl(args: string[], timeoutMs = 10000): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const proc = spawn("pilotctl", args, { timeout: timeoutMs });
    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, output: stdout.trim() });
      } else {
        resolve({ ok: false, output: stderr.trim() || stdout.trim() || `Exit code ${code}` });
      }
    });

    proc.on("error", (err) => {
      resolve({ ok: false, output: `Spawn error: ${err.message}` });
    });
  });
}

/** Parsed pending handshake entry from pilotctl. */
interface PendingEntry {
  node_id: number;
  hostname?: string;
  public_key?: string;
  justification?: string;
  received_at?: number;
}

/** Parsed inbox message from pilotctl. */
interface InboxMessage {
  from: number; // node_id
  from_hostname?: string;
  data: string;
  received_at?: string;
  type?: string;
}

/**
 * Execute one poll cycle: check for pending handshakes and inbox messages.
 * Injects them as inbound messages via channelRuntime.
 */
async function executePollCycle(params: {
  accountId: string;
  config: import("./src/types.js").AgentRegistryConfig;
  channelRuntime: any; // PluginRuntime["channel"]
  cfg: any; // OpenClawConfig
  log?: any;
}): Promise<void> {
  const { accountId, config, channelRuntime, cfg, log } = params;

  const pilotAvailable = await isPilotInstalled();
  if (!pilotAvailable) return;

  log?.debug?.(`Poll cycle started for account ${accountId}`);

  // A) Check pending handshakes
  try {
    const pendingResult = await runPilotctl(["pending", "--json"]);
    if (pendingResult.ok && pendingResult.output) {
      const data = JSON.parse(pendingResult.output);
      const pending: PendingEntry[] = data.data?.pending ?? data.pending ?? [];

      for (const entry of pending) {
        const introduction = entry.justification || "(no introduction)";

        // Save to Convex — upsert returns existing record or creates new
        await upsertHandshake({
          fromNodeId: entry.node_id,
          fromHostname: entry.hostname,
          fromPublicKey: entry.public_key ?? "",
          introduction,
          status: "pending",
        }).catch((err) => {
          log?.warn?.(`Failed to save handshake to Convex: ${err}`);
        });

        // Check if we already notified about this handshake
        let alreadyNotified = false;
        try {
          const hsResult = await getHandshakeByNodeId({ fromNodeId: entry.node_id });
          if (hsResult.ok && hsResult.handshake?.notificationSent) {
            alreadyNotified = true;
          }
        } catch {
          // If lookup fails, skip notification to be safe (avoid duplicates)
          alreadyNotified = true;
        }

        if (alreadyNotified) continue;

        // Build session key for handshake notifications (use main session)
        const route = channelRuntime.routing.resolveAgentRoute({
          cfg,
          channel: "agent-registry",
          accountId,
          peer: {
            kind: "direct",
            id: entry.hostname || `node-${entry.node_id}`,
          },
        });

        const handshakeBody = `🤝 Pedido de conexão de ${entry.hostname || `node ${entry.node_id}`}\n\nIntrodução: "${introduction}"\n\nPara aprovar: agent_network({ action: "approve", node_id: "${entry.node_id}" })\nPara rejeitar: agent_network({ action: "reject", node_id: "${entry.node_id}" })`;

        const msgCtx = channelRuntime.reply.finalizeInboundContext({
          Body: handshakeBody,
          BodyForAgent: handshakeBody,
          RawBody: handshakeBody,
          CommandBody: handshakeBody,
          From: `agent-registry:${entry.hostname || entry.node_id}`,
          To: config.hostname,
          SessionKey: route.sessionKey,
          AccountId: accountId,
          OriginatingChannel: "agent-registry",
          OriginatingTo: config.hostname,
          ChatType: "direct",
          SenderName: entry.hostname || `Agent ${entry.node_id}`,
          SenderId: String(entry.node_id),
          Provider: "agent-registry",
          Surface: "agent-registry",
          ConversationLabel: entry.hostname || `Agent ${entry.node_id}`,
          Timestamp: Date.now(),
          CommandAuthorized: true,
        });

        await channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher({
          ctx: msgCtx,
          cfg,
          dispatcherOptions: {
            deliver: async (_payload: { text?: string; body?: string }) => {
              // No-op: handshake notifications are informational only.
              // Cannot send messages to unapproved peers via Pilot Protocol.
              log?.debug?.(`Handshake notification reply suppressed for unapproved node ${entry.node_id}`);
            },
          },
        });

        // Mark notification as sent to prevent re-notification on next poll cycle
        await markNotificationSent({ fromNodeId: entry.node_id }).catch((err) => {
          log?.warn?.(`Failed to mark notification sent: ${err}`);
        });

        log?.info?.(`Injected pending handshake from ${entry.hostname || entry.node_id} (node ${entry.node_id})`);
      }
    }
  } catch (err) {
    // Tolerate parse/network errors — will retry next cycle
    if (err instanceof SyntaxError) {
      // No pending or non-JSON output — OK
    } else {
      log?.warn?.(`Poll pending error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // B) Check inbox messages
  try {
    // Fetch without --clear first; only clear after successful processing
    const inboxResult = await runPilotctl(["inbox", "--json"]);
    if (inboxResult.ok && inboxResult.output) {
      const data = JSON.parse(inboxResult.output);
      const messages: InboxMessage[] = data.data?.messages ?? data.messages ?? [];

      for (const msg of messages) {
        const senderNodeId = msg.from;
        const senderLabel = msg.from_hostname || `node-${senderNodeId}`;
        const messageBody = msg.data || "";

        // Single Convex lookup for handshake data (reused for first-message check and intro text)
        let isFirstMessage = false;
        let introText = "(no introduction)";
        try {
          const hsResult = await getHandshakeByNodeId({ fromNodeId: senderNodeId });
          if (hsResult.ok && hsResult.handshake) {
            isFirstMessage = !hsResult.handshake.firstMessageSent;
            if (hsResult.handshake.introduction) {
              introText = hsResult.handshake.introduction;
            }
          }
        } catch {
          // If Convex lookup fails, skip intro logic
        }

        // Resolve route with per-channel-peer scope for DM sessions
        const route = channelRuntime.routing.resolveAgentRoute({
          cfg,
          channel: "agent-registry",
          accountId,
          peer: {
            kind: "direct",
            id: senderLabel,
          },
        });

        // If first message, inject system event with introduction
        if (isFirstMessage) {

          const systemBody = `[Sessão com agente via Agent Network]\nHostname: ${senderLabel}\nIntrodução: "${introText}"`;

          const systemCtx = channelRuntime.reply.finalizeInboundContext({
            Body: systemBody,
            BodyForAgent: systemBody,
            RawBody: systemBody,
            CommandBody: systemBody,
            From: `agent-registry:${senderLabel}`,
            To: config.hostname,
            SessionKey: route.sessionKey,
            AccountId: accountId,
            OriginatingChannel: "agent-registry",
            OriginatingTo: config.hostname,
            ChatType: "direct",
            SenderName: senderLabel,
            SenderId: String(senderNodeId),
            Provider: "agent-registry",
            Surface: "agent-registry",
            ConversationLabel: senderLabel,
            Timestamp: Date.now(),
            CommandAuthorized: true,
            SystemEvent: true,
          });

          await channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher({
            ctx: systemCtx,
            cfg,
            dispatcherOptions: {
              deliver: async () => {
                // System event — no reply needed
              },
            },
          });

          // Mark first message as sent
          await markFirstMessageSent({ fromNodeId: senderNodeId }).catch((err) => {
            log?.warn?.(`Failed to mark first message sent: ${err}`);
          });

          log?.info?.(`Injected introduction system event for ${senderLabel}`);
        }

        // Inject the actual message
        const msgCtx = channelRuntime.reply.finalizeInboundContext({
          Body: messageBody,
          BodyForAgent: messageBody,
          RawBody: messageBody,
          CommandBody: messageBody,
          From: `agent-registry:${senderLabel}`,
          To: config.hostname,
          SessionKey: route.sessionKey,
          AccountId: accountId,
          OriginatingChannel: "agent-registry",
          OriginatingTo: config.hostname,
          ChatType: "direct",
          SenderName: senderLabel,
          SenderId: String(senderNodeId),
          Provider: "agent-registry",
          Surface: "agent-registry",
          ConversationLabel: senderLabel,
          Timestamp: Date.now(),
          CommandAuthorized: true,
        });

        await channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher({
          ctx: msgCtx,
          cfg,
          dispatcherOptions: {
            deliver: async (payload: { text?: string; body?: string }) => {
              const text = payload?.text ?? payload?.body;
              if (text) {
                // Send reply back via Pilot Protocol
                await runPilotctl(["send-message", String(senderNodeId), "--data", text], 15000);
              }
            },
          },
        });

        log?.info?.(`Injected inbox message from ${senderLabel} (node ${senderNodeId})`);
      }

      // All messages processed successfully — now clear the inbox
      if (messages.length > 0) {
        await runPilotctl(["inbox", "--clear"]).catch((err) => {
          log?.warn?.(`Failed to clear inbox after processing: ${err}`);
        });
      }
    }
  } catch (err) {
    if (err instanceof SyntaxError) {
      // Empty inbox or non-JSON — OK
    } else {
      log?.warn?.(`Poll inbox error: ${err instanceof Error ? err.message : String(err)}`);
    }
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

      // Start poll loop for pending handshakes and inbox messages
      const pollIntervalMs = (config.pollIntervalSeconds ?? 300) * 1000;
      const pilotAvailable = await isPilotInstalled();
      if (pilotAvailable && channelRuntime) {
        // Use initial config — poll interval is static and doesn't need dynamic reload
        const getCfg = () => ctx.cfg;

        // Run first poll immediately
        executePollCycle({
          accountId,
          config,
          channelRuntime,
          cfg: getCfg(),
          log,
        }).catch((err) => {
          log?.warn?.(`Initial poll cycle error: ${err instanceof Error ? err.message : String(err)}`);
        });

        // Schedule recurring polls
        const interval = setInterval(async () => {
          try {
            await executePollCycle({
              accountId,
              config,
              channelRuntime,
              cfg: getCfg(),
              log,
            });
          } catch (err) {
            log?.warn?.(`Poll cycle error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }, pollIntervalMs);
        if (interval.unref) interval.unref();
        pollIntervals.set(accountId, interval);

        log?.info?.(`Poll loop started (interval: ${config.pollIntervalSeconds ?? 300}s)`);
      } else {
        if (!pilotAvailable) log?.info?.("Pilot Protocol not available — poll loop disabled");
        if (!channelRuntime) log?.info?.("channelRuntime not available — poll loop disabled");
      }

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

      // Stop poll loop
      const pollInterval = pollIntervals.get(accountId);
      if (pollInterval) {
        clearInterval(pollInterval);
        pollIntervals.delete(accountId);
        log?.info?.("Poll loop stopped");
      }

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
