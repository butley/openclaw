/**
 * Agent Registry channel configuration types and defaults.
 *
 * Defines the configuration shape for the agent-registry channel,
 * which enables agent-to-agent communication via Pilot Protocol
 * with Agent Registry as the discovery/catalog layer.
 */

export type AgentRegistryConfig = {
  /** Pilot protocol hostname for this agent. */
  hostname: string;
  /** Public display name of this agent. */
  displayName: string;
  /** Human-readable description of what this agent does. */
  description: string;
  /** List of capabilities this agent advertises. */
  capabilities: string[];
  /** Whether this agent is listed in the public registry. */
  public: boolean;
  /** Pilot protocol daemon port. */
  pilotPort: number;
  /** Agent Registry API base URL. */
  registryUrl: string;
  /** Auto-trust incoming peer connections. */
  autoTrust: boolean;
  /** List of peer hostnames allowed to connect. Empty = use autoTrust. */
  allowFrom: string[];
  /** Whether the channel is enabled. */
  enabled?: boolean;
};

export const DEFAULT_AGENT_REGISTRY_CONFIG: AgentRegistryConfig = {
  hostname: "",
  displayName: "",
  description: "",
  capabilities: [],
  public: false,
  pilotPort: 1001,
  registryUrl: "https://registry.butley.ai/api",
  autoTrust: false,
  allowFrom: [],
  enabled: false,
};

export type ResolvedAgentRegistryAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  hostname: string;
  displayName: string;
  description: string;
  capabilities: string[];
  public: boolean;
  pilotPort: number;
  registryUrl: string;
  autoTrust: boolean;
  allowFrom: string[];
};

/**
 * Resolve an agent-registry account from OpenClaw config.
 */
export function resolveAgentRegistryAccount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cfg: any,
  accountId?: string | null,
): ResolvedAgentRegistryAccount {
  const channelCfg = cfg?.channels?.["agent-registry"] ?? {};
  const id = accountId || "default";

  const accountCfg = id === "default" ? channelCfg : channelCfg?.accounts?.[id] ?? {};

  const hostname = accountCfg.hostname ?? channelCfg.hostname ?? "";
  const displayName = accountCfg.displayName ?? channelCfg.displayName ?? "";
  const description = accountCfg.description ?? channelCfg.description ?? "";
  const capabilities = accountCfg.capabilities ?? channelCfg.capabilities ?? [];
  const isPublic = accountCfg.public ?? channelCfg.public ?? false;
  const pilotPort =
    accountCfg.pilotPort ?? channelCfg.pilotPort ?? DEFAULT_AGENT_REGISTRY_CONFIG.pilotPort;
  const registryUrl =
    accountCfg.registryUrl ?? channelCfg.registryUrl ?? DEFAULT_AGENT_REGISTRY_CONFIG.registryUrl;
  const autoTrust = accountCfg.autoTrust ?? channelCfg.autoTrust ?? false;
  const allowFrom = accountCfg.allowFrom ?? channelCfg.allowFrom ?? [];
  const enabled = accountCfg.enabled ?? channelCfg.enabled ?? false;

  const configured = Boolean(hostname && displayName);

  return {
    accountId: id,
    enabled,
    configured,
    hostname,
    displayName,
    description,
    capabilities,
    public: isPublic,
    pilotPort,
    registryUrl,
    autoTrust,
    allowFrom,
  };
}

/**
 * List all configured agent-registry account IDs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function listAgentRegistryAccountIds(cfg: any): string[] {
  const channelCfg = cfg?.channels?.["agent-registry"] ?? {};
  const ids: string[] = [];

  // Default account exists if any top-level config is present.
  if (channelCfg.hostname || channelCfg.displayName || channelCfg.enabled !== undefined) {
    ids.push("default");
  }

  // Additional named accounts.
  const accounts = channelCfg.accounts ?? {};
  for (const key of Object.keys(accounts)) {
    if (!ids.includes(key)) {
      ids.push(key);
    }
  }

  return ids;
}
