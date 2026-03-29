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
import { getDaemonStatus } from "./src/daemon.js";
import { AgentRegistryClient } from "./src/discovery.js";

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

/** Active monitor handle per account, keyed by accountId. */
const activeMonitors = new Map<string, MonitorHandle>();

/** Heartbeat intervals per account. */
const heartbeatIntervals = new Map<string, ReturnType<typeof setInterval>>();

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
      const { account, accountId, log, setStatus, getStatus, channelRuntime } = ctx;
      const config = account.config;

      if (!config.enabled || !config.hostname) {
        log?.info?.("Agent Registry not configured — skipping start");
        return;
      }

      const registryUrl = config.registryUrl ?? "http://localhost:8001";
      const registryClient = new AgentRegistryClient(registryUrl);

      // Register in the Agent Registry
      const regResult = await registryClient.register(config);
      if (regResult.ok) {
        log?.info?.(`Registered in Agent Registry as ${config.hostname} (id: ${regResult.agentId})`);
      } else {
        log?.warn?.(`Failed to register in Agent Registry: ${regResult.error}`);
      }

      // Start inbound message monitor (optional - requires pilotctl)
      let monitor: MonitorHandle | undefined;
      try {
        monitor = await startMonitor({
          pilotPort: config.pilotPort,
          onMessage: async (msg) => {
            log?.info?.(`Inbound message from ${msg.from}: ${msg.body.slice(0, 100)}`);

            // Dispatch via channelRuntime if available
            if (channelRuntime) {
              try {
                const msgCtx = {
                  Body: msg.body,
                  From: msg.fromAddress,
                  To: config.hostname,
                  SessionKey: `agent-registry:${accountId}:${msg.from}`,
                  AccountId: accountId,
                  MessageSid: msg.messageId,
                };

                await channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher({
                  ctx: msgCtx,
                  cfg: ctx.cfg,
                  dispatcherOptions: {
                    deliver: async (payload: any) => {
                      const text = typeof payload === "string" ? payload : payload.text ?? "";
                      await sendMessage(
                        { to: msg.fromAddress, body: text },
                        { pilotPort: config.pilotPort },
                      );
                    },
                  },
                });
              } catch (err) {
                log?.warn?.(`Failed to dispatch inbound message: ${err}`);
              }
            }
          },
          onError: (err) => {
            log?.warn?.(`Monitor error: ${err.message}`);
          },
          onConnected: () => {
            log?.info?.("Pilot monitor connected");
            const snap = getStatus();
            setStatus({ ...snap, connected: true, running: true });
          },
          onDisconnected: () => {
            log?.info?.("Pilot monitor disconnected");
            const snap = getStatus();
            setStatus({ ...snap, connected: false, running: false });
          },
        });
        activeMonitors.set(accountId, monitor);
      } catch (err: any) {
        // pilotctl not available - P2P messaging disabled but registry still works
        log?.info?.(`Pilot Protocol unavailable (${err.code ?? err.message}) — P2P messaging disabled, discovery-only mode`);
        setStatus({ connected: false, running: true }); // Running but not connected to Pilot
      }

      // Start heartbeat interval (every 60s)
      if (regResult.ok && regResult.agentId) {
        const agentId = regResult.agentId;
        const interval = setInterval(async () => {
          const hb = await registryClient.heartbeat(agentId);
          if (!hb.ok) {
            log?.warn?.(`Heartbeat failed: ${hb.error}`);
          }
        }, 60_000);
        if (interval.unref) interval.unref();
        heartbeatIntervals.set(accountId, interval);
      }

      return { monitor, registryClient, agentId: regResult.agentId };
    },

    stopAccount: async (ctx) => {
      const { accountId, log } = ctx;

      // Stop monitor
      const monitor = activeMonitors.get(accountId);
      if (monitor) {
        monitor.stop();
        activeMonitors.delete(accountId);
        log?.info?.("Pilot monitor stopped");
      }

      // Clear heartbeat interval
      const interval = heartbeatIntervals.get(accountId);
      if (interval) {
        clearInterval(interval);
        heartbeatIntervals.delete(accountId);
      }
    },
  },

  gatewayMethods: [
    "agent-registry/status",
    "agent-registry/peers",
    "agent-registry/send",
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
      const daemonStatus = await getDaemonStatus();
      if (!daemonStatus.running) {
        return { ok: false, reason: "Pilot daemon is not running" };
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
        const client = new AgentRegistryClient(registryUrl);
        const result = await client.listAgents();
        respond(result.ok, {
          peers: result.peers,
          error: result.error,
        });
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
