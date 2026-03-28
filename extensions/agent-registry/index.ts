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
    chatTypes: ["dm"],
    media: false,
    reactions: false,
    threads: false,
    polls: false,
  }

  config: agentRegistryConfigAdapter,

  outbound: {
    deliveryMode: "direct",
    sendText: async (_ctx) => {
      // Placeholder: will use Pilot Protocol to send
      return { ok: false, error: "Agent Registry send not yet implemented" } as any;
    },
  },

  status: {
    buildAccountSnapshot: async ({ account, runtime }) => {
      return {
        accountId: account.accountId,
        enabled: account.config.enabled,
        configured: !!account.config.hostname,
        connected: false,
        running: false,
        ...runtime,
      };
    },
  },

  heartbeat: {
    checkReady: async ({ cfg, accountId }) => {
      // Placeholder: check if Pilot daemon is running and registered
      void cfg;
      void accountId;
      return { ok: false, reason: "Agent Registry not yet configured" };
    },
  },
};

const plugin = {
  id: "agent-registry",
  name: "Agent Registry",
  description: "P2P agent-to-agent communication via Pilot Protocol",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerChannel({ plugin: agentRegistryPlugin });
  },
};

export default plugin;
