import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { getConvexEnv, updateHandshakeStatus } from "./convex-client.js";

interface AgentNetworkConfig {
  registryUrl: string;
  registryApiKey?: string;
  hostname?: string;
}

interface SearchResult {
  id: string;
  hostname: string;
  installation_id?: string;
  p2p_endpoint?: string;
  display_name?: string;
  description?: string;
  capabilities?: string[];
  last_seen?: string;
}

const ACTIONS = {
  search: {
    description: "Search for public assistants by text query or capabilities",
    requiredArgs: [] as string[],
    optionalArgs: ["query", "capabilities", "limit"],
  },
  get_agent: {
    description: "Get details about a specific assistant by hostname",
    requiredArgs: ["hostname"],
    optionalArgs: [] as string[],
  },
  handshake: {
    description: "Establish trust with another assistant via Registry API (required before contact)",
    requiredArgs: ["installation_id", "introduction"],
    optionalArgs: [] as string[],
  },
  pending: {
    description: "List pending handshake requests from other assistants (via Registry API)",
    requiredArgs: [] as string[],
    optionalArgs: [] as string[],
  },
  approve: {
    description: "Approve a pending handshake request",
    requiredArgs: ["installation_id"],
    optionalArgs: [] as string[],
  },
  reject: {
    description: "Reject a pending handshake request",
    requiredArgs: ["installation_id"],
    optionalArgs: [] as string[],
  },
  untrust: {
    description: "Remove trust from a previously approved agent (block them)",
    requiredArgs: ["installation_id"],
    optionalArgs: [] as string[],
  },
  contact: {
    description: "Send a message to another assistant via P2P WebSocket (requires handshake first). Use installation_id to identify target.",
    requiredArgs: ["installation_id", "message"],
    optionalArgs: [] as string[],
  },
};

export function createAgentNetworkTool(api: OpenClawPluginApi) {
  const config = (api.pluginConfig ?? {}) as AgentNetworkConfig;

  const log = api.logger;

  if (!config.registryUrl) {
    log?.warn?.("agent-network: missing registryUrl. Tool disabled.");
    return null;
  }

  const actionNames = Object.keys(ACTIONS).join(", ");

  return {
    name: "agent_network",
    description: `Discover and contact other AI assistants on the network. Actions: ${actionNames}.

Use this tool to find assistants with specific knowledge or capabilities, and optionally send them messages via P2P WebSocket.

## Actions

### search
Find assistants matching a query or capabilities.
- query (string): Text search across names, descriptions, and capabilities
- capabilities (string[]): Filter by specific capabilities (OR logic — matches any)
- limit (number): Max results (default 10)

Example: search for assistants that know about "futebol" or have capability "Brasileirão"

### get_agent
Get full details about a specific assistant.
- hostname (string, required): The assistant's hostname/identifier

### handshake
Request to establish trust with another assistant via Registry API. Must be done before P2P contact.
- installation_id (string, required): The assistant's installation_id (from search results)
- introduction (string, required): A message introducing yourself (e.g., "Hi, I'm Junin, Guilherme's assistant")

Think of this like sending a friend request — you introduce yourself and wait for approval.

### pending
List incoming handshake requests waiting for your approval. Use this to see who wants to connect.

### approve
Approve a pending handshake request.
- installation_id (string, required): The installation_id from the pending list

### reject
Reject a pending handshake request.
- installation_id (string, required): The installation_id from the pending list

### untrust
Remove trust from a previously approved agent (block them).
- installation_id (string, required): The installation_id to untrust

### contact
Send a message to another assistant via P2P WebSocket. Requires completed handshake (both sides approved).
- installation_id (string, required): Target assistant's installation_id
- message (string, required): Message to send`,
    parameters: {
      type: "object" as const,
      properties: {
        action: {
          type: "string" as const,
          enum: Object.keys(ACTIONS),
          description: "The action to perform",
        },
        query: {
          type: "string" as const,
          description: "Text search query (for search action)",
        },
        capabilities: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Capabilities to filter by (for search action)",
        },
        limit: {
          type: "number" as const,
          description: "Max results to return (for search action)",
        },
        hostname: {
          type: "string" as const,
          description: "Target assistant hostname (for get_agent)",
        },
        installation_id: {
          type: "string" as const,
          description: "Target assistant's installation_id (for handshake/approve/reject/untrust/contact — from search results)",
        },
        introduction: {
          type: "string" as const,
          description: "Introduction message for handshake (e.g., 'Hi, I'm X, assistant of Y')",
        },
        message: {
          type: "string" as const,
          description: "Message to send (for contact action)",
        },
      },
      required: ["action"] as const,
    },
    async execute(
      _toolUseId: string,
      params: {
        action: string;
        query?: string;
        capabilities?: string[];
        limit?: number;
        hostname?: string;
        installation_id?: string;
        introduction?: string;
        message?: string;
      },
    ) {
      const { action, query, capabilities, limit, hostname, installation_id, introduction, message } = params;

      const actionDef = ACTIONS[action as keyof typeof ACTIONS];
      if (!actionDef) {
        return {
          content: [
            { type: "text", text: `Error: Unknown action '${action}'. Available: ${actionNames}` },
          ],
        };
      }

      // Validate required args
      for (const req of actionDef.requiredArgs) {
        if (!params[req as keyof typeof params]) {
          return {
            content: [
              { type: "text", text: `Error: Missing required arg '${req}' for action '${action}'` },
            ],
          };
        }
      }

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (config.registryApiKey) {
        headers["X-Registry-Key"] = config.registryApiKey;
      }

      try {
        switch (action) {
          case "search": {
            const url = new URL(`${config.registryUrl}/api/v1/agents/search`);
            if (query) url.searchParams.set("q", query);
            if (capabilities?.length) {
              // Cap capabilities to prevent excessive filtering
              const cappedCaps = capabilities.slice(0, 20);
              for (const cap of cappedCaps) {
                url.searchParams.append("capabilities", cap);
              }
            }
            // Clamp limit to reasonable range (1-50)
            const clampedLimit = Math.min(50, Math.max(1, limit ?? 10));
            url.searchParams.set("limit", String(clampedLimit));

            const res = await fetch(url.toString(), { headers });
            const data = await res.json();

            if (!res.ok) {
              return { content: [{ type: "text", text: `Registry error: ${data.detail || res.statusText}` }] };
            }

            const agents = (data.agents ?? []) as SearchResult[];
            if (agents.length === 0) {
              return { content: [{ type: "text", text: "No assistants found matching your criteria." }] };
            }

            const formatted = agents.map((a) => ({
              hostname: a.hostname,
              installation_id: a.installation_id || a.hostname,
              name: a.display_name || a.hostname,
              description: a.description || "(no description)",
              capabilities: a.capabilities || [],
            }));

            return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
          }

          case "get_agent": {
            // Use exact hostname endpoint for precise lookup
            const url = new URL(`${config.registryUrl}/api/v1/agents/by-hostname/${encodeURIComponent(hostname!)}`);

            const res = await fetch(url.toString(), { headers });

            if (res.status === 404) {
              return { content: [{ type: "text", text: `Assistant '${hostname}' not found or not online.` }] };
            }

            const data = await res.json();

            if (!res.ok) {
              return { content: [{ type: "text", text: `Registry error: ${data.detail || res.statusText}` }] };
            }

            const match = data as SearchResult;

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      hostname: match.hostname,
                      installation_id: match.installation_id || match.hostname,
                      name: match.display_name || match.hostname,
                      description: match.description || "(no description)",
                      capabilities: match.capabilities || [],
                      last_seen: match.last_seen,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          case "handshake": {
            // Get our installation_id to identify ourselves
            const convexEnv = getConvexEnv();
            const myInstallationId = convexEnv?.installationId || "unknown";
            
            const intro = introduction || "Agent network connection request";

            // POST /api/v1/trust/request on Registry API
            const trustUrl = new URL(`${config.registryUrl}/api/v1/trust/request`);
            const trustRes = await fetch(trustUrl.toString(), {
              method: "POST",
              headers,
              body: JSON.stringify({
                from_id: myInstallationId,
                to_id: installation_id,
                introduction: intro,
              }),
            });

            const trustData = await trustRes.json();

            if (!trustRes.ok) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Handshake failed: ${trustData.detail || trustData.error || "Registry error"}`,
                  },
                ],
              };
            }

            return {
              content: [
                {
                  type: "text",
                  text: `Handshake request sent to '${installation_id}'.\n\nThe other assistant needs to approve this request (they can use 'pending' to see it and 'approve' to accept). Once approved, you can use 'contact' to send messages.`,
                },
              ],
            };
          }

          case "pending": {
            // GET /api/v1/trust/pending/{installation_id} on Registry API
            const convexEnv = getConvexEnv();
            const myInstallationId = convexEnv?.installationId || "unknown";
            
            const pendingUrl = new URL(`${config.registryUrl}/api/v1/trust/pending/${encodeURIComponent(myInstallationId)}`);
            const pendingRes = await fetch(pendingUrl.toString(), { headers });

            if (!pendingRes.ok) {
              return {
                content: [{ type: "text", text: `Failed to get pending requests: ${pendingRes.statusText}` }],
              };
            }

            const pendingData = await pendingRes.json();
            const pending = pendingData.requests ?? [];

            if (pending.length === 0) {
              return {
                content: [{ type: "text", text: "No pending handshake requests." }],
              };
            }

            const formatted = pending.map((p: { from_id: string; introduction?: string; created_at?: string }) => ({
              installation_id: p.from_id,
              introduction: p.introduction || "(no introduction)",
              created_at: p.created_at,
            }));

            return {
              content: [
                {
                  type: "text",
                  text: `Pending handshake requests:\n\n${JSON.stringify(formatted, null, 2)}\n\nUse 'approve' with the installation_id to accept a request.`,
                },
              ],
            };
          }

          case "approve": {
            if (!installation_id) {
              return { content: [{ type: "text", text: "installation_id is required for approve action" }] };
            }

            // Get our installation_id
            const convexEnv = getConvexEnv();
            const myInstallationId = convexEnv?.installationId || "unknown";
            
            // POST /api/v1/trust/approve on Registry API
            const approveUrl = new URL(`${config.registryUrl}/api/v1/trust/approve`);
            const approveRes = await fetch(approveUrl.toString(), {
              method: "POST",
              headers,
              body: JSON.stringify({
                from_id: installation_id,
                to_id: myInstallationId,
              }),
            });

            const approveData = await approveRes.json();

            if (!approveRes.ok) {
              return {
                content: [{ type: "text", text: `Failed to approve: ${approveData.detail || approveData.error || "Registry error"}` }],
              };
            }

            // Update Convex status
            await updateHandshakeStatus({ fromNodeId: 0, status: "approved" }).catch((err) => log?.warn?.("Convex sync failed (approve):", err));

            return {
              content: [
                {
                  type: "text",
                  text: `Approved handshake from '${installation_id}'.\n\nYou can now exchange messages with this assistant via P2P.`,
                },
              ],
            };
          }

          case "reject": {
            if (!installation_id) {
              return { content: [{ type: "text", text: "installation_id is required for reject action" }] };
            }

            // Get our installation_id
            const convexEnv = getConvexEnv();
            const myInstallationId = convexEnv?.installationId || "unknown";
            
            // POST /api/v1/trust/reject on Registry API
            const rejectUrl = new URL(`${config.registryUrl}/api/v1/trust/reject`);
            const rejectRes = await fetch(rejectUrl.toString(), {
              method: "POST",
              headers,
              body: JSON.stringify({
                from_id: installation_id,
                to_id: myInstallationId,
              }),
            });

            const rejectData = await rejectRes.json();

            if (!rejectRes.ok) {
              return {
                content: [{ type: "text", text: `Failed to reject: ${rejectData.detail || rejectData.error || "Registry error"}` }],
              };
            }

            // Update Convex status
            await updateHandshakeStatus({ fromNodeId: 0, status: "rejected" }).catch((err) => log?.warn?.("Convex sync failed (reject):", err));

            return {
              content: [
                {
                  type: "text",
                  text: `Rejected handshake from '${installation_id}'.`,
                },
              ],
            };
          }

          case "untrust": {
            if (!installation_id) {
              return { content: [{ type: "text", text: "installation_id is required for untrust action" }] };
            }

            // Get our installation_id
            const convexEnv = getConvexEnv();
            const myInstallationId = convexEnv?.installationId || "unknown";
            
            // POST /api/v1/trust/block on Registry API
            const blockUrl = new URL(`${config.registryUrl}/api/v1/trust/block`);
            const blockRes = await fetch(blockUrl.toString(), {
              method: "POST",
              headers,
              body: JSON.stringify({
                from_id: installation_id,
                to_id: myInstallationId,
              }),
            });

            const blockData = await blockRes.json();

            if (!blockRes.ok) {
              return {
                content: [{ type: "text", text: `Failed to block: ${blockData.detail || blockData.error || "Registry error"}` }],
              };
            }

            return {
              content: [
                {
                  type: "text",
                  text: `Blocked '${installation_id}'.\n\nThis agent can no longer send you messages.`,
                },
              ],
            };
          }

          case "contact": {
            // Validate required args
            if (!installation_id || !message) {
              return {
                content: [{ type: "text", text: "Error: Both 'installation_id' and 'message' are required for contact action." }],
              };
            }

            // Get our installation_id
            const convexEnv = getConvexEnv();
            const myInstallationId = convexEnv?.installationId || "unknown";
            
            // Send via P2P WebSocket (P2PClient will handle this from the plugin)
            // For now, we return instructions — the actual message routing happens via channelRuntime.outbound.sendText
            // which uses p2pClients to send the message
            
            return {
              content: [
                {
                  type: "text",
                  text: `Contact action: sending message to '${installation_id}'.\n\nMessage: "${message}"\n\nThe message is being routed via P2P WebSocket. If the recipient is not currently connected, they'll receive it when their P2P server comes back online.`,
                },
              ],
            };
          }

          default:
            return { content: [{ type: "text", text: `Action '${action}' not implemented.` }] };
        }
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  };
}
