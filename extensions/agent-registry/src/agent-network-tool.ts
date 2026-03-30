import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { sendMessage } from "./send.js";
import { isPilotInstalled } from "./daemon.js";

interface AgentNetworkConfig {
  registryUrl: string;
  registryApiKey?: string;
}

interface SearchResult {
  id: string;
  hostname: string;
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
  contact: {
    description: "Send a message to another assistant (requires Pilot Protocol — may not be available)",
    requiredArgs: ["hostname", "message"],
    optionalArgs: [] as string[],
  },
};

export function createAgentNetworkTool(api: OpenClawPluginApi) {
  const config = (api.pluginConfig ?? {}) as AgentNetworkConfig;

  if (!config.registryUrl) {
    api.logger?.warn?.("agent-network: missing registryUrl. Tool disabled.");
    return null;
  }

  const actionNames = Object.keys(ACTIONS).join(", ");

  return {
    name: "agent_network",
    description: `Discover and contact other AI assistants on the network. Actions: ${actionNames}.

Use this tool to find assistants with specific knowledge or capabilities, and optionally send them messages.

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

### contact
Send a message to another assistant. The response may be async.
- hostname (string, required): Target assistant's hostname
- message (string, required): Message to send

⚠️ Contact requires Pilot Protocol. If unavailable, you'll get an error.`,
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
          description: "Target assistant hostname (for get_agent/contact)",
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
        message?: string;
      },
    ) {
      const { action, query, capabilities, limit, hostname, message } = params;

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
            const url = new URL(`${config.registryUrl}/api/v1/agents/search/`);
            if (query) url.searchParams.set("query", query);
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
              name: a.display_name || a.hostname,
              description: a.description || "(no description)",
              capabilities: a.capabilities || [],
            }));

            return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
          }

          case "get_agent": {
            // Search by hostname with higher limit to avoid missing exact match
            const url = new URL(`${config.registryUrl}/api/v1/agents/search/`);
            url.searchParams.set("query", hostname!);
            url.searchParams.set("limit", "25");

            const res = await fetch(url.toString(), { headers });
            const data = await res.json();

            if (!res.ok) {
              return { content: [{ type: "text", text: `Registry error: ${data.detail || res.statusText}` }] };
            }

            const agents = (data.agents ?? []) as SearchResult[];
            const match = agents.find((a) => a.hostname === hostname);

            if (!match) {
              return { content: [{ type: "text", text: `Assistant '${hostname}' not found or not online.` }] };
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      hostname: match.hostname,
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

          case "contact": {
            // Check if Pilot Protocol is available
            const pilotReady = await isPilotInstalled();
            if (!pilotReady) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Cannot send message: Pilot Protocol daemon is not running.\n\nTarget: ${hostname}\nMessage: "${message}"`,
                  },
                ],
              };
            }

            // Send the message via Pilot Protocol
            const result = await sendMessage(
              { to: hostname!, body: message! },
              { pilotPort: 1000, timeoutMs: 15000 },
            );

            if (!result.ok) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Failed to send message to '${hostname}': ${result.error}`,
                  },
                ],
              };
            }

            return {
              content: [
                {
                  type: "text",
                  text: `Message sent to '${hostname}'${result.messageId ? ` (id: ${result.messageId})` : ""}.\n\nNote: The recipient may process this message asynchronously. They need to have Pilot Protocol running and trust established with this agent.`,
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
