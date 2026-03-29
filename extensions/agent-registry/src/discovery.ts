/**
 * Agent Registry — discovery API client.
 *
 * Communicates with the Agent Registry HTTP API (FastAPI service)
 * for agent registration, discovery, heartbeat, and search.
 */

import type { PilotPeer, AgentRegistryConfig } from "./types.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type SearchParams = {
  query?: string;
  capabilities?: string[];
  limit?: number;
};

export type SearchResult = {
  peers: PilotPeer[];
  total: number;
};

export type RegisterPayload = {
  hostname: string;
  display_name?: string;
  description?: string;
  capabilities?: string[];
  pilot_address?: string;
};

export type AgentRecord = {
  id: string;
  hostname: string;
  display_name?: string;
  description?: string;
  capabilities?: string[];
  pilot_address?: string;
  last_seen?: string;
  created_at?: string;
  updated_at?: string;
};

export type HeartbeatResult = {
  ok: boolean;
  last_seen?: string;
};

/* ------------------------------------------------------------------ */
/*  Client                                                             */
/* ------------------------------------------------------------------ */

/**
 * HTTP client for the Agent Registry API.
 *
 * Uses native fetch() (Node 18+). All methods throw on network errors
 * but return structured error objects for API-level failures.
 */
export class AgentRegistryClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    // Strip trailing slash for consistent URL building
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /**
   * Register this agent in the registry.
   * POST /api/v1/agents/
   */
  async register(config: AgentRegistryConfig): Promise<{ ok: boolean; agentId?: string; error?: string }> {
    const payload: RegisterPayload = {
      hostname: config.hostname,
      display_name: config.displayName,
      description: config.description,
      capabilities: config.capabilities,
      pilot_address: undefined, // filled by daemon after address is known
    };

    try {
      const res = await fetch(`${this.baseUrl}/api/v1/agents/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await safeReadBody(res);
        return { ok: false, error: `Registry register failed (${res.status}): ${body}` };
      }

      const data = await res.json() as AgentRecord;
      return { ok: true, agentId: data.id };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  }

  /**
   * Deregister an agent from the registry.
   * DELETE /api/v1/agents/{agentId}
   */
  async deregister(agentId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/agents/${encodeURIComponent(agentId)}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const body = await safeReadBody(res);
        return { ok: false, error: `Registry deregister failed (${res.status}): ${body}` };
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  }

  /**
   * Search for agents matching criteria.
   * GET /api/v1/agents/search/?q=query&capabilities=cap1,cap2&limit=N
   */
  async search(params: SearchParams): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/api/v1/agents/search/`);
    if (params.query) url.searchParams.set("q", params.query);
    if (params.capabilities?.length) url.searchParams.set("capabilities", params.capabilities.join(","));
    if (params.limit != null) url.searchParams.set("limit", String(params.limit));

    try {
      const res = await fetch(url.toString());

      if (!res.ok) {
        return { peers: [], total: 0 };
      }

      const data = await res.json() as { agents?: AgentRecord[]; total?: number } | AgentRecord[];
      const agents = Array.isArray(data) ? data : (data.agents ?? []);
      const total = Array.isArray(data) ? agents.length : (data.total ?? agents.length);

      return {
        peers: agents.map(agentToPeer),
        total,
      };
    } catch {
      return { peers: [], total: 0 };
    }
  }

  /**
   * Send a heartbeat for the given agent.
   * POST /api/v1/agents/{agentId}/heartbeat
   */
  async heartbeat(agentId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/v1/agents/${encodeURIComponent(agentId)}/heartbeat`,
        { method: "POST" },
      );

      if (!res.ok) {
        const body = await safeReadBody(res);
        return { ok: false, error: `Heartbeat failed (${res.status}): ${body}` };
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  }

  /**
   * Get a single agent by ID.
   * GET /api/v1/agents/{agentId}
   */
  async getAgent(agentId: string): Promise<{ ok: boolean; agent?: PilotPeer; error?: string }> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/v1/agents/${encodeURIComponent(agentId)}`,
      );

      if (!res.ok) {
        const body = await safeReadBody(res);
        return { ok: false, error: `Get agent failed (${res.status}): ${body}` };
      }

      const data = await res.json() as AgentRecord;
      return { ok: true, agent: agentToPeer(data) };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  }

  /**
   * List all registered agents.
   * GET /api/v1/agents/
   */
  async listAgents(): Promise<{ ok: boolean; peers: PilotPeer[]; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/agents/`);

      if (!res.ok) {
        const body = await safeReadBody(res);
        return { ok: false, peers: [], error: `List agents failed (${res.status}): ${body}` };
      }

      const data = await res.json() as AgentRecord[] | { agents?: AgentRecord[] };
      const agents = Array.isArray(data) ? data : (data.agents ?? []);

      return { ok: true, peers: agents.map(agentToPeer) };
    } catch (err) {
      return { ok: false, peers: [], error: errorMessage(err) };
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Legacy function exports (backward-compatible wrappers)             */
/* ------------------------------------------------------------------ */

/**
 * Search the Agent Registry for peers matching the given criteria.
 * @deprecated Use AgentRegistryClient.search() instead.
 */
export async function searchAgents(params: SearchParams, registryUrl?: string): Promise<SearchResult> {
  const client = new AgentRegistryClient(registryUrl ?? "http://localhost:8001");
  return client.search(params);
}

/**
 * Register this agent in the Agent Registry.
 * @deprecated Use AgentRegistryClient.register() instead.
 */
export async function registerAgent(config: AgentRegistryConfig): Promise<{ ok: boolean; error?: string }> {
  const client = new AgentRegistryClient(config.registryUrl ?? "http://localhost:8001");
  return client.register(config);
}

/**
 * Send a heartbeat to maintain presence in the registry.
 * @deprecated Use AgentRegistryClient.heartbeat() instead.
 */
export async function sendHeartbeat(config: AgentRegistryConfig & { agentId: string }): Promise<{ ok: boolean }> {
  const client = new AgentRegistryClient(config.registryUrl ?? "http://localhost:8001");
  return client.heartbeat(config.agentId);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function agentToPeer(agent: AgentRecord): PilotPeer {
  return {
    hostname: agent.hostname,
    address: agent.pilot_address ?? "",
    name: agent.display_name,
    capabilities: agent.capabilities,
    lastSeen: agent.last_seen ? new Date(agent.last_seen).getTime() : undefined,
  };
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 500);
  } catch {
    return "(unreadable body)";
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
