/**
 * Agent Registry — config adapter.
 *
 * Resolves account configuration from OpenClaw config.
 */

import type { AgentRegistryConfig, ResolvedAgentRegistryAccount } from "./types.js";

const DEFAULT_ACCOUNT_ID = "default";

export function resolveAgentRegistryAccount(params: {
  cfg: any;
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
    registryApiKey: accountData.registryApiKey,
  };

  return { accountId, config };
}

export const agentRegistryConfigAdapter = {
  listAccountIds: (cfg: any) => {
    const channelConfig = (cfg as any)?.channels?.["agent-registry"];
    const accounts = channelConfig?.accounts ?? [];
    if (accounts.length === 0) return [];
    return accounts.map((a: any) => a.id ?? DEFAULT_ACCOUNT_ID);
  },

  resolveAccount: (cfg: any, accountId: string) => {
    return resolveAgentRegistryAccount({ cfg, accountId });
  },

  defaultAccountId: (cfg: any) => {
    const ids = agentRegistryConfigAdapter.listAccountIds(cfg);
    return ids[0] ?? DEFAULT_ACCOUNT_ID;
  },

  isEnabled: (account: ResolvedAgentRegistryAccount) => account.config.enabled,

  isConfigured: (account: ResolvedAgentRegistryAccount) => {
    return account.config.enabled && !!account.config.hostname;
  },

  resolveAllowFrom: ({ cfg, accountId }: { cfg: any; accountId: string }) => {
    const account = resolveAgentRegistryAccount({ cfg, accountId });
    return undefined; // No allowFrom filtering for P2P
  },

  resolveDefaultTo: ({ cfg, accountId }: { cfg: any; accountId: string }) => {
    void cfg;
    void accountId;
    return undefined;
  },
};
