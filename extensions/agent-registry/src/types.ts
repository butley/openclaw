/**
 * Agent Registry channel types — P2P WebSocket communication.
 */

export type AgentRegistryConfig = {
  enabled: boolean;
  hostname: string;
  displayName?: string;
  description?: string;
  capabilities?: string[];
  registryUrl?: string;
  registryApiKey?: string;
};

export type AgentRegistryInboundMessage = {
  from: string; // pilot hostname
  fromAddress: string; // pilot address
  body: string;
  timestamp: number;
  messageId: string;
  metadata?: Record<string, unknown>;
};

export type AgentRegistryOutboundMessage = {
  to: string; // pilot hostname or address
  body: string;
  metadata?: Record<string, unknown>;
};

/** Resolved account state for a single agent-registry account. */
export type ResolvedAgentRegistryAccount = {
  accountId: string;
  config: AgentRegistryConfig;
};
