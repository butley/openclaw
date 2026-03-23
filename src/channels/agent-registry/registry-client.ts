/**
 * Agent Registry API client.
 *
 * Communicates with the Agent Registry service for agent discovery,
 * registration, and heartbeat/health reporting.
 */

export type AgentRegistrationData = {
  hostname: string;
  displayName: string;
  description: string;
  capabilities: string[];
  pilotAddress: string;
  pilotPort: number;
  public: boolean;
  installationId?: string;
  workspaceSlug?: string;
  installationSlug?: string;
};

export type AgentSearchResult = {
  hostname: string;
  displayName: string;
  description: string;
  capabilities: string[];
  pilotAddress: string;
  pilotPort: number;
  workspaceSlug: string;
  installationSlug: string;
  lastSeen: string;
};

export type AgentDetails = AgentSearchResult & {
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

/**
 * Register an agent with the Agent Registry.
 */
export async function registerAgent(
  registryUrl: string,
  agentData: AgentRegistrationData,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`${registryUrl}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(agentData),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, error: `Registration failed: ${response.status} ${body}`.trim() };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Registration request failed: ${(error as Error).message}` };
  }
}

/**
 * Search for agents in the registry.
 */
export async function searchAgents(
  registryUrl: string,
  query: string,
): Promise<{ ok: boolean; agents?: AgentSearchResult[]; error?: string }> {
  try {
    const params = new URLSearchParams({ q: query });
    const response = await fetch(`${registryUrl}/agents/search?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, error: `Search failed: ${response.status} ${body}`.trim() };
    }

    const data = (await response.json()) as { agents?: AgentSearchResult[] };
    return { ok: true, agents: data.agents ?? [] };
  } catch (error) {
    return { ok: false, error: `Search request failed: ${(error as Error).message}` };
  }
}

/**
 * Send a heartbeat to the registry to indicate this agent is alive.
 */
export async function heartbeat(
  registryUrl: string,
  installationId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`${registryUrl}/agents/${installationId}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, error: `Heartbeat failed: ${response.status} ${body}`.trim() };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Heartbeat request failed: ${(error as Error).message}` };
  }
}

/**
 * Get details of a specific agent from the registry.
 */
export async function getAgent(
  registryUrl: string,
  workspaceSlug: string,
  installationSlug: string,
): Promise<{ ok: boolean; agent?: AgentDetails; error?: string }> {
  try {
    const response = await fetch(
      `${registryUrl}/agents/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(installationSlug)}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, error: `Get agent failed: ${response.status} ${body}`.trim() };
    }

    const agent = (await response.json()) as AgentDetails;
    return { ok: true, agent };
  } catch (error) {
    return { ok: false, error: `Get agent request failed: ${(error as Error).message}` };
  }
}
