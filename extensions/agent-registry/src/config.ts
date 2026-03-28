/**
 * Agent Registry — config adapter.
 *
 * Resolves account configuration from OpenClaw config.
 * Placeholder: actual config paths TBD once integrated into the config schema.
 */

import type { ChannelConfigAdapter } from "openclaw/plugin-sdk/signal";
import type { OpenClawConfig } from "openclaw/plugin-sdk/signal";
import type { ResolvedAgentRegistryAccount } from "./types.js";

const DEFAULT_ACCOUNT_ID = "default";

export function resolveAgentRegistryAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedAgentRegistryAccount {
  const accountId = params.accountId ?? DEFAULT_ACCOUNT_ID;
  // Placeholder: read from cfg.channels?.["agent-registry"]?.accounts?.[accountId]
  return {
    accountId,
    config: {
      enabled: false,
      hostname: "",
    },
  };
}

export const agentRegistryConfigAdapter: ChannelConfigAdapter<ResolvedAgentRegistryAccount> = {
  listAccountIds: (_cfg) => {
    // Placeholder: extract account IDs from config
    return [DEFAULT_ACCOUNT_ID];
  },

  resolveAccount: (cfg, accountId) => {
    return resolveAgentRegistryAccount({ cfg, accountId });
  },

  defaultAccountId: (_cfg) => DEFAULT_ACCOUNT_ID,

  isEnabled: (account) => account.config.enabled,

  isConfigured: (account) => {
    return account.config.enabled && !!account.config.hostname;
  },

  resolveAllowFrom: ({ cfg, accountId }) => {
    const account = resolveAgentRegistryAccount({ cfg, accountId });
    return account.config.allowFrom;
  },

  resolveDefaultTo: ({ cfg, accountId }) => {
    // Placeholder: resolve default send target
    void cfg;
    void accountId;
    return undefined;
  },
};
