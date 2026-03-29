/**
 * Agent Registry channel types — Pilot Protocol P2P communication.
 */

export type PilotPeer = {
  hostname: string;
  address: string; // "1:0001.A3F2:1001"
  name?: string;
  capabilities?: string[];
  lastSeen?: number;
};

export type AgentRegistryConfig = {
  enabled: boolean;
  hostname: string;
  displayName?: string;
  description?: string;
  capabilities?: string[];
  pilotPort?: number;
  registryUrl?: string;
  registryApiKey?: string;
  autoTrust?: boolean;
  allowFrom?: string[];
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
