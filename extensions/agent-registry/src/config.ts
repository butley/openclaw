/**
 * Agent Registry — config adapter.
 *
 * Resolves account configuration from OpenClaw config.
 */

import type { ChannelConfigAdapter } from "openclaw/plugin-sdk/signal";
import type { OpenClawConfig } from "openclaw/plugin-sdk/signal";
import type { AgentRegistryConfig, ResolvedAgentRegistryAccount } from "./types.js";

const DEFAULT_ACCOUNT_ID = "default";

export function resolveAgentRegistryAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedAgentRegistryAccount {
  const accountId = params.accountId ?? DEFAULT_ACCOUNT_ID;
  
  // Read from cfg.channels["agent-registry"].accounts (NOT cfg.channels.entries)
  const channelConfig = (params.cfg as any)?.channels?.["agent-registry"];
  const accounts = channelConfig?.accounts ?? [];
  
  // Find matching account or use first
  const accountData = accounts.find((a: any) => a.id === accountId) ?? accounts[0];
  
  if (!accountData) {
    return {
      accountId,
      config: {
        enabled: false,
        hostname: "",
      },
    };
  }

  const config: AgentRegistryConfig = {
    enabled: true,
    hostname: accountData.hostname ?? accountData.id ?? accountId,
    displayName: accountData.displayName,
    description: accountData.description,
    capabilities: accountData.capabilities,
    registryUrl: accountData.registryUrl,
    autoTrust: accountData.autoTrust ?? false,
    allowFrom: accountData.allowFrom,
  };

  return { accountId, config };
}

export const agentRegistryConfigAdapter: ChannelConfigAdapter<ResolvedAgentRegistryAccount> = {
  listAccountIds: (cfg) => {
    const channelConfig = (cfg as any)?.channels?.["agent-registry"];
    const accounts = channelConfig?.accounts ?? [];
    if (accounts.length === 0) return [];
    return accounts.map((a: any) => a.id ?? DEFAULT_ACCOUNT_ID);
  },

  resolveAccount: (cfg, accountId) => {
    return resolveAgentRegistryAccount({ cfg, accountId });
  },

  defaultAccountId: (cfg) => {
    const ids = agentRegistryConfigAdapter.listAccountIds(cfg);
    return ids[0] ?? DEFAULT_ACCOUNT_ID;
  },

  isEnabled: (account) => account.config.enabled,

  isConfigured: (account) => {
    return account.config.enabled && !!account.config.registryUrl;
  },

  resolveAllowFrom: ({ cfg, accountId }) => {
    const account = resolveAgentRegistryAccount({ cfg, accountId });
    return account.config.allowFrom;
  },

  resolveDefaultTo: ({ cfg, accountId }) => {
    void cfg;
    void accountId;
    return undefined;
  },
};
