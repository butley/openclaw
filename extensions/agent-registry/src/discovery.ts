/**
 * Agent Registry — discovery API client.
 *
 * Placeholder for interacting with the Agent Registry API:
 * - Search for agents by capability, name, etc.
 * - Register this agent in the registry
 * - Send heartbeats to maintain presence
 */

import type { PilotPeer, AgentRegistryConfig } from "./types.js";

export type SearchParams = {
  query?: string;
  capabilities?: string[];
  limit?: number;
};

export type SearchResult = {
  peers: PilotPeer[];
  total: number;
};

/**
 * Search the Agent Registry for peers matching the given criteria.
 * Placeholder — will call the registry HTTP API.
 */
export async function searchAgents(_params: SearchParams): Promise<SearchResult> {
  // TODO: Call Agent Registry API
  return { peers: [], total: 0 };
}

/**
 * Register this agent in the Agent Registry.
 * Placeholder — will POST to the registry HTTP API.
 */
export async function registerAgent(_config: AgentRegistryConfig): Promise<{ ok: boolean; error?: string }> {
  // TODO: Call Agent Registry API
  return { ok: false, error: "Agent Registry registration not yet implemented" };
}

/**
 * Send a heartbeat to maintain presence in the registry.
 * Placeholder — will PUT to the registry HTTP API.
 */
export async function sendHeartbeat(_config: AgentRegistryConfig): Promise<{ ok: boolean }> {
  // TODO: Call Agent Registry API
  return { ok: false };
}
