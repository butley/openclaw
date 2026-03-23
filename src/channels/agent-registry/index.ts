/**
 * Agent Registry channel plugin.
 *
 * Provides agent-to-agent communication via Pilot Protocol,
 * with Agent Registry as the discovery/catalog layer.
 *
 * This is NOT a human-to-agent channel — it enables AI agents
 * to discover and communicate with each other.
 */

import type { ChannelPlugin } from "../plugins/types.plugin.js";
import type { ChannelAccountSnapshot } from "../plugins/types.core.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { OutboundDeliveryResult } from "../../infra/outbound/deliver.js";
import {
  resolveAgentRegistryAccount,
  listAgentRegistryAccountIds,
  type ResolvedAgentRegistryAccount,
} from "./config.js";
import { startDaemon, stopDaemon, isDaemonRunning } from "./daemon.js";
import { registerAgent } from "./registry-client.js";
import { listenForPeers, sendMessage, type PilotMessage } from "./transport.js";
import type net from "node:net";

const AGENT_REGISTRY_CHANNEL_ID = "agent-registry";

let peerServer: net.Server | null = null;

export const agentRegistryPlugin: ChannelPlugin<ResolvedAgentRegistryAccount> = {
  id: AGENT_REGISTRY_CHANNEL_ID,
  meta: {
    id: AGENT_REGISTRY_CHANNEL_ID,
    label: "Agent Registry",
    selectionLabel: "Agent Registry (Pilot Protocol)",
    docsPath: "/channels/agent-registry",
    docsLabel: "agent-registry",
    blurb: "Public agent catalog — discover and communicate with AI agents",
    order: 100,
  },
  capabilities: {
    chatTypes: ["direct"],
    media: false,
    reactions: false,
    polls: false,
    edit: false,
    unsend: false,
    reply: false,
    threads: false,
  },
  reload: { configPrefixes: ["channels.agent-registry"] },
  config: {
    listAccountIds: (cfg: OpenClawConfig) => listAgentRegistryAccountIds(cfg),

    resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) =>
      resolveAgentRegistryAccount(cfg, accountId),

    defaultAccountId: () => "default",

    isEnabled: (account: ResolvedAgentRegistryAccount) => account.enabled,

    isConfigured: (account: ResolvedAgentRegistryAccount) => account.configured,

    unconfiguredReason: () => "Missing hostname or displayName in agent-registry config",

    describeAccount: (account: ResolvedAgentRegistryAccount): ChannelAccountSnapshot => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
    }),

    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cfgAny = cfg as any;
      const useDefault = !accountId || accountId === "default";
      if (useDefault) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            "agent-registry": {
              ...cfgAny.channels?.["agent-registry"],
              enabled,
            },
          },
        } as OpenClawConfig;
      }
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          "agent-registry": {
            ...cfgAny.channels?.["agent-registry"],
            accounts: {
              ...cfgAny.channels?.["agent-registry"]?.accounts,
              [accountId]: {
                ...cfgAny.channels?.["agent-registry"]?.accounts?.[accountId],
                enabled,
              },
            },
          },
        },
      } as OpenClawConfig;
    },

    deleteAccount: ({ cfg, accountId }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cfgAny = cfg as any;
      const useDefault = !accountId || accountId === "default";
      const channelCfg = cfgAny.channels?.["agent-registry"] ?? {};
      if (useDefault) {
        const { hostname: _, displayName: __, description: ___, ...rest } = channelCfg;
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            "agent-registry": rest,
          },
        } as OpenClawConfig;
      }
      const accounts = channelCfg.accounts ?? {};
      const { [accountId]: _removed, ...remainingAccounts } = accounts;
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          "agent-registry": {
            ...channelCfg,
            accounts: remainingAccounts,
          },
        },
      } as OpenClawConfig;
    },

    resolveAllowFrom: ({ cfg, accountId }) => {
      const account = resolveAgentRegistryAccount(cfg, accountId);
      return account.allowFrom.length > 0 ? account.allowFrom : undefined;
    },
  },

  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 10_000,

    resolveTarget: ({ to }) => {
      const trimmed = to?.trim();
      if (!trimmed) {
        return { ok: false, error: new Error("Missing peer hostname") };
      }
      return { ok: true, to: trimmed };
    },

    sendText: async ({ cfg, to, text, accountId }): Promise<OutboundDeliveryResult> => {
      const account = resolveAgentRegistryAccount(cfg, accountId);
      if (!account.configured) {
        throw new Error("Agent Registry account not configured");
      }

      const result = await sendMessage(to, {
        from: account.hostname,
        type: "text",
        content: text,
        port: account.pilotPort,
      });

      return {
        channel: AGENT_REGISTRY_CHANNEL_ID,
        messageId: result?.id ?? `msg-${Date.now()}`,
      };
    },
  },

  status: {
    defaultRuntime: {
      accountId: "default",
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },

    buildChannelSummary: ({ snapshot }) => {
      const s = snapshot as ChannelAccountSnapshot & {
        hostname?: string;
        displayName?: string;
      };
      return {
        configured: s.configured ?? false,
        hostname: s.hostname ?? null,
        displayName: s.displayName ?? null,
        running: s.running ?? false,
        daemonRunning: isDaemonRunning(),
      };
    },

    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
    }),

    collectStatusIssues: (accounts) =>
      accounts.flatMap((account) => {
        if (!account.configured) {
          return [
            {
              channel: AGENT_REGISTRY_CHANNEL_ID,
              accountId: account.accountId,
              kind: "config" as const,
              message: "Account not configured (missing hostname or displayName)",
            },
          ];
        }
        return [];
      }),
  },

  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      ctx.log?.info?.(
        `[${account.accountId}] Starting agent-registry channel for ${account.hostname || "unconfigured"}`,
      );

      if (!account.configured) {
        ctx.log?.warn?.(`[${account.accountId}] Agent Registry not configured, skipping`);
        return;
      }

      // Start the Pilot Protocol daemon.
      try {
        startDaemon(account.hostname);
        ctx.log?.info?.(`[${account.accountId}] Pilot daemon started for ${account.hostname}`);
      } catch (err) {
        ctx.log?.warn?.(
          `[${account.accountId}] Failed to start pilot daemon: ${(err as Error).message}`,
        );
      }

      // Start listening for incoming peer messages.
      peerServer = listenForPeers(account.pilotPort, (message: PilotMessage) => {
        ctx.log?.info?.(
          `[${account.accountId}] Received message from ${message.from}: ${message.type}`,
        );
        // TODO: Route incoming messages to the agent's reply pipeline.
      });

      ctx.log?.info?.(
        `[${account.accountId}] Listening for peers on port ${account.pilotPort}`,
      );

      // Register with the Agent Registry if public.
      if (account.public && account.registryUrl) {
        const result = await registerAgent(account.registryUrl, {
          hostname: account.hostname,
          displayName: account.displayName,
          description: account.description,
          capabilities: account.capabilities,
          pilotAddress: account.hostname,
          pilotPort: account.pilotPort,
          public: account.public,
        });

        if (result.ok) {
          ctx.log?.info?.(`[${account.accountId}] Registered with Agent Registry`);
        } else {
          ctx.log?.warn?.(
            `[${account.accountId}] Registry registration failed: ${result.error}`,
          );
        }
      }

      ctx.setStatus({
        accountId: account.accountId,
        running: true,
        lastStartAt: Date.now(),
      });
    },

    stopAccount: async (ctx) => {
      ctx.log?.info?.(`[${ctx.account.accountId}] Stopping agent-registry channel`);

      // Stop peer listener.
      if (peerServer) {
        peerServer.close();
        peerServer = null;
      }

      // Stop the daemon.
      stopDaemon();

      ctx.setStatus({
        accountId: ctx.account.accountId,
        running: false,
        lastStopAt: Date.now(),
      });
    },
  },

  gatewayMethods: ["startAccount", "stopAccount"],

  messaging: {
    normalizeTarget: (target: string) => target.trim().toLowerCase(),
    targetResolver: {
      looksLikeId: (raw: string) => {
        // Agent hostnames look like: agent-name.pilot.example.com
        return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(raw.trim().toLowerCase());
      },
      hint: "Pilot Protocol hostname (e.g., my-agent.pilot.butley.ai)",
    },
  },
};

export default agentRegistryPlugin;
