import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { isPilotInstalled } from "./daemon.js";
import { getConvexEnv } from "./convex-client.js";

interface AgentNetworkConfig {
  registryUrl: string;
  registryApiKey?: string;
  hostname?: string;
}

interface SearchResult {
  id: string;
  hostname: string;
  installation_id?: string;
  pilot_node_id?: number;
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
    description: "Establish trust with another assistant (required before contact)",
    requiredArgs: ["installation_id"],
    optionalArgs: ["introduction"],
  },
  pending: {
    description: "List pending handshake requests from other assistants",
    requiredArgs: [] as string[],
    optionalArgs: [] as string[],
  },
  approve: {
    description: "Approve a pending handshake request",
    requiredArgs: ["node_id"],
    optionalArgs: [] as string[],
  },
  contact: {
    description: "Send a message to another assistant (requires handshake first). Use installation_id OR node_id (if known)",
    requiredArgs: ["message"],
    optionalArgs: ["installation_id", "target_node_id"],
  },
  inbox: {
    description: "Check your inbox for messages from other assistants",
    requiredArgs: [] as string[],
    optionalArgs: ["clear"],
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

### handshake
Request to establish trust with another assistant. Must be done before contact.
- installation_id (string, required): The assistant's installation_id (from search results)
- introduction (string, optional): A message introducing yourself (e.g., "Hi, I'm Junin, Guilherme's assistant")

Think of this like sending a friend request — you introduce yourself and wait for approval.

### pending
List incoming handshake requests waiting for your approval. Use this to see who wants to connect.

### approve
Approve a pending handshake request.
- node_id (string, required): The node ID from the pending list

### contact
Send a message to another assistant. Requires completed handshake (both sides approved).
- installation_id (string, required): Target assistant's installation_id
- message (string, required): Message to send

⚠️ Contact requires Pilot Protocol and mutual trust. If unavailable, you'll get an error.

### inbox
Check for messages from other assistants.
- clear (boolean, optional): If true, clears messages after reading

📬 Check your inbox regularly to see responses from other assistants.`,
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
          description: "Target assistant's installation_id (for handshake/contact — from search results)",
        },
        introduction: {
          type: "string" as const,
          description: "Introduction message for handshake (e.g., 'Hi, I'm X, assistant of Y')",
        },
        node_id: {
          type: "string" as const,
          description: "Node ID to approve (from pending list)",
        },
        message: {
          type: "string" as const,
          description: "Message to send (for contact action)",
        },
        target_node_id: {
          type: "number" as const,
          description: "Direct Pilot node ID of recipient (for contact action, alternative to installation_id)",
        },
        clear: {
          type: "boolean" as const,
          description: "Clear inbox after reading (for inbox action)",
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
        node_id?: string;
        target_node_id?: number;
        message?: string;
        clear?: boolean;
      },
    ) {
      const { action, query, capabilities, limit, hostname, installation_id, introduction, node_id, target_node_id, message, clear } = params;

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
              installation_id: a.installation_id || a.hostname,
              name: a.display_name || a.hostname,
              description: a.description || "(no description)",
              capabilities: a.capabilities || [],
            }));

            return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
          }

          case "get_agent": {
            // Search by hostname with higher limit to avoid missing exact match
            const url = new URL(`${config.registryUrl}/api/v1/agents/search`);
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
            // Check if Pilot Protocol is available
            const pilotOk = await isPilotInstalled();
            if (!pilotOk) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Cannot initiate handshake: Pilot Protocol daemon is not running.`,
                  },
                ],
              };
            }

            // First, look up the target in our registry to get their pilot_node_id
            const lookupUrl = new URL(`${config.registryUrl}/api/v1/agents/search`);
            lookupUrl.searchParams.set("query", installation_id!);
            lookupUrl.searchParams.set("limit", "10");

            const lookupRes = await fetch(lookupUrl.toString(), { headers });
            const lookupData = await lookupRes.json();

            let targetNodeId: string | undefined;
            if (lookupRes.ok && lookupData.agents?.length > 0) {
              const match = lookupData.agents.find(
                (a: SearchResult) => a.installation_id === installation_id || a.hostname === installation_id
              );
              if (match?.pilot_node_id) {
                targetNodeId = String(match.pilot_node_id);
              }
            }

            // Use node_id if available, otherwise try installation_id as hostname
            const target = targetNodeId || installation_id!;
            const intro = introduction || "Agent network connection request";

            // Run pilotctl handshake <target> <introduction>
            const { spawn } = await import("child_process");
            const result = await new Promise<{ ok: boolean; output: string }>((resolve) => {
              const proc = spawn("pilotctl", ["handshake", target, intro], {
                timeout: 15000,
              });

              let stdout = "";
              let stderr = "";

              proc.stdout?.on("data", (d) => (stdout += d.toString()));
              proc.stderr?.on("data", (d) => (stderr += d.toString()));

              proc.on("close", (code) => {
                if (code === 0) {
                  resolve({ ok: true, output: stdout.trim() || "Handshake initiated successfully" });
                } else {
                  resolve({ ok: false, output: stderr.trim() || stdout.trim() || `Exit code ${code}` });
                }
              });

              proc.on("error", (err) => {
                resolve({ ok: false, output: `Spawn error: ${err.message}` });
              });
            });

            if (!result.ok) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Handshake failed: ${result.output}`,
                  },
                ],
              };
            }

            return {
              content: [
                {
                  type: "text",
                  text: `Handshake request sent to '${installation_id}'.\n\n${result.output}\n\nThe other assistant needs to approve this request (they can use 'pending' to see it and 'approve' to accept). Once approved, you can use 'contact' to send messages.`,
                },
              ],
            };
          }

          case "pending": {
            // Check if Pilot Protocol is available
            const pilotAvail = await isPilotInstalled();
            if (!pilotAvail) {
              return {
                content: [{ type: "text", text: `Pilot Protocol daemon is not running.` }],
              };
            }

            const { spawn } = await import("child_process");
            const result = await new Promise<{ ok: boolean; output: string }>((resolve) => {
              const proc = spawn("pilotctl", ["pending", "--json"], { timeout: 10000 });

              let stdout = "";
              let stderr = "";

              proc.stdout?.on("data", (d) => (stdout += d.toString()));
              proc.stderr?.on("data", (d) => (stderr += d.toString()));

              proc.on("close", (code) => {
                if (code === 0) {
                  resolve({ ok: true, output: stdout.trim() });
                } else {
                  resolve({ ok: false, output: stderr.trim() || stdout.trim() || `Exit code ${code}` });
                }
              });

              proc.on("error", (err) => {
                resolve({ ok: false, output: `Spawn error: ${err.message}` });
              });
            });

            if (!result.ok) {
              // "no pending" is often returned as non-zero, check for that
              if (result.output.includes("no pending")) {
                return {
                  content: [{ type: "text", text: "No pending handshake requests." }],
                };
              }
              return {
                content: [{ type: "text", text: `Failed to get pending requests: ${result.output}` }],
              };
            }

            // Try to parse JSON output
            try {
              const data = JSON.parse(result.output);
              // pilotctl outputs { "data": { "pending": [...] }, "status": "ok" }
              const pending = data.data?.pending || data.pending || [];
              if (pending.length === 0) {
                return {
                  content: [{ type: "text", text: "No pending handshake requests." }],
                };
              }

              const formatted = pending.map((p: { node_id: number; justification?: string; received_at?: number }) => ({
                node_id: p.node_id,
                introduction: p.justification || "(no introduction)",
                received_at: p.received_at ? new Date(p.received_at * 1000).toISOString() : undefined,
              }));

              return {
                content: [
                  {
                    type: "text",
                    text: `Pending handshake requests:\n\n${JSON.stringify(formatted, null, 2)}\n\nUse 'approve' with the node_id to accept a request.`,
                  },
                ],
              };
            } catch {
              // Plain text output
              return {
                content: [{ type: "text", text: result.output || "No pending handshake requests." }],
              };
            }
          }

          case "approve": {
            const pilotUp = await isPilotInstalled();
            if (!pilotUp) {
              return {
                content: [{ type: "text", text: `Pilot Protocol daemon is not running.` }],
              };
            }

            const { spawn } = await import("child_process");
            const result = await new Promise<{ ok: boolean; output: string }>((resolve) => {
              const proc = spawn("pilotctl", ["approve", node_id!], { timeout: 10000 });

              let stdout = "";
              let stderr = "";

              proc.stdout?.on("data", (d) => (stdout += d.toString()));
              proc.stderr?.on("data", (d) => (stderr += d.toString()));

              proc.on("close", (code) => {
                if (code === 0) {
                  resolve({ ok: true, output: stdout.trim() || "Approved" });
                } else {
                  resolve({ ok: false, output: stderr.trim() || stdout.trim() || `Exit code ${code}` });
                }
              });

              proc.on("error", (err) => {
                resolve({ ok: false, output: `Spawn error: ${err.message}` });
              });
            });

            if (!result.ok) {
              return {
                content: [{ type: "text", text: `Failed to approve: ${result.output}` }],
              };
            }

            return {
              content: [
                {
                  type: "text",
                  text: `Approved handshake from node ${node_id}.\n\n${result.output}\n\nYou can now exchange messages with this assistant.`,
                },
              ],
            };
          }

          case "contact": {
            // Validate: need message and either installation_id or target_node_id
            if (!message) {
              return {
                content: [{ type: "text", text: "Error: 'message' is required for contact action." }],
              };
            }
            if (!installation_id && !target_node_id) {
              return {
                content: [{ type: "text", text: "Error: Either 'installation_id' or 'target_node_id' is required for contact action." }],
              };
            }

            // Get our installation_id to identify ourselves
            const convexEnv = getConvexEnv();
            const myInstallationId = convexEnv?.installationId || "unknown";
            
            // Try Pilot Protocol first if available
            const pilotReady = await isPilotInstalled();
            if (pilotReady) {
              // If target_node_id provided directly, use it
              let targetNodeId: number | undefined = target_node_id;
              const targetLabel = installation_id || `node ${target_node_id}`;

              // Only look up if target_node_id not provided
              if (!targetNodeId && installation_id) {
                // Check if it looks like a Pilot address (N:NNNN.NNNN.NNNN format)
                const pilotAddressMatch = installation_id.match(/^(\d+):([0-9A-Fa-f]{4})\.([0-9A-Fa-f]{4})\.([0-9A-Fa-f]{4})$/);
                if (pilotAddressMatch) {
                  // Parse Pilot address to extract node_id from the low 16 bits (last segment in hex)
                  const lowHex = pilotAddressMatch[4];
                  targetNodeId = parseInt(lowHex, 16);
                } else {
                  // First, look up the target's pilot_node_id from registry
                  // Pilot Protocol requires node_id for send-message, not hostname
                  const lookupUrl = new URL(`${config.registryUrl}/api/v1/agents/search`);
                  lookupUrl.searchParams.set("query", installation_id);
                  lookupUrl.searchParams.set("limit", "10");
                  try {
                    const lookupRes = await fetch(lookupUrl.toString(), { headers });
                    if (lookupRes.ok) {
                      const lookupData = await lookupRes.json();
                      const match = (lookupData.agents ?? []).find(
                        (a: SearchResult) => a.installation_id === installation_id || a.hostname === installation_id
                      );
                      if (match?.pilot_node_id) {
                        targetNodeId = match.pilot_node_id;
                      }
                    }
                  } catch {
                    // Lookup failed, will try with installation_id as fallback
                  }
                }
              }

              // If not found in registry, check local peer list (for non-public agents with trust)
              if (!targetNodeId) {
                try {
                  const { spawn } = await import("child_process");
                  const peerInfo = await new Promise<string>((resolve) => {
                    const proc = spawn("pilotctl", ["info", "--json"], { timeout: 5000 });
                    let out = "";
                    proc.stdout?.on("data", (d: Buffer) => (out += d.toString()));
                    proc.on("close", () => resolve(out.trim()));
                    proc.on("error", () => resolve(""));
                  });
                  if (peerInfo) {
                    const infoData = JSON.parse(peerInfo);
                    // Check if target is in our peer list by looking at hostname registration
                    // The peer_list has node_id but not hostname, so we need a different approach
                    // For now, we'll try to use the installation_id as hostname in pilotctl find
                    const findResult = await new Promise<string>((resolve) => {
                      const proc = spawn("pilotctl", ["find", installation_id!, "--json"], { timeout: 5000 });
                      let out = "";
                      proc.stdout?.on("data", (d: Buffer) => (out += d.toString()));
                      proc.on("close", () => resolve(out.trim()));
                      proc.on("error", () => resolve(""));
                    });
                    if (findResult) {
                      try {
                        const findData = JSON.parse(findResult);
                        if (findData.status === "ok" && findData.data?.node_id) {
                          targetNodeId = findData.data.node_id;
                        }
                      } catch { /* ignore parse errors */ }
                    }
                  }
                } catch { /* ignore errors, continue with null targetNodeId */ }
              }

              if (!targetNodeId) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Failed to send message to '${targetLabel}': Could not find their Pilot node ID. They may not be discoverable, or you may need to establish trust first with: agent_network({ action: "handshake", installation_id: "${installation_id}" })`,
                    },
                  ],
                };
              }

              // Use pilotctl send-message <node_id> --data <message>
              // NOT pilotctl send <hostname> <port> --data <payload>
              const { spawn } = await import("child_process");
              const sendResult = await new Promise<{ ok: boolean; output: string }>((resolve) => {
                const proc = spawn("pilotctl", ["send-message", String(targetNodeId), "--data", message!], {
                  timeout: 15000,
                });

                let stdout = "";
                let stderr = "";

                proc.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
                proc.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));

                proc.on("close", (code) => {
                  if (code === 0) {
                    resolve({ ok: true, output: stdout.trim() });
                  } else {
                    resolve({ ok: false, output: stderr.trim() || stdout.trim() || `Exit code ${code}` });
                  }
                });

                proc.on("error", (err) => {
                  resolve({ ok: false, output: `Spawn error: ${err.message}` });
                });
              });

              if (sendResult.ok) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Message sent to '${targetLabel}' (node ${targetNodeId}) via P2P.\n\n${sendResult.output}\n\nNote: The recipient may process this message asynchronously.`,
                    },
                  ],
                };
              }
              
              // P2P failed — include error details
              return {
                content: [
                  {
                    type: "text",
                    text: `Failed to send message to '${targetLabel}': ${sendResult.output}`,
                  },
                ],
              };
              // No HTTP relay fallback for now — P2P should work if handshake was completed
            }

            // Use HTTP relay via Agent Registry
            try {
              const relayRes = await fetch(`${config.registryUrl}/api/v1/agents/messages/send`, {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({
                  from_installation_id: myInstallationId,
                  from_hostname: config.hostname,
                  to_installation_id: installation_id,
                  body: message,
                }),
              });

              const relayData = await relayRes.json();
              
              if (!relayRes.ok || !relayData.ok) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Failed to send message to '${installation_id}': ${relayData.detail || relayData.error || "HTTP relay failed"}`,
                    },
                  ],
                };
              }

              return {
                content: [
                  {
                    type: "text",
                    text: `Message sent to '${installation_id}' via relay (id: ${relayData.message_id}).\n\nThe message is in their inbox. They'll receive it when they check for new messages.`,
                  },
                ],
              };
            } catch (err) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Failed to send message: ${err instanceof Error ? err.message : String(err)}`,
                  },
                ],
              };
            }
          }

          case "inbox": {
            // Check if Pilot Protocol is available
            const pilotUp = await isPilotInstalled();
            if (!pilotUp) {
              return {
                content: [{ type: "text", text: `Pilot Protocol daemon is not running.` }],
              };
            }

            const { spawn } = await import("child_process");
            const clearArg = clear === true;
            const inboxArgs = clearArg ? ["inbox", "--json", "--clear"] : ["inbox", "--json"];
            
            const result = await new Promise<{ ok: boolean; output: string }>((resolve) => {
              const proc = spawn("pilotctl", inboxArgs, { timeout: 10000 });

              let stdout = "";
              let stderr = "";

              proc.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
              proc.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));

              proc.on("close", (code) => {
                if (code === 0) {
                  resolve({ ok: true, output: stdout.trim() });
                } else {
                  resolve({ ok: false, output: stderr.trim() || stdout.trim() || `Exit code ${code}` });
                }
              });

              proc.on("error", (err) => {
                resolve({ ok: false, output: `Spawn error: ${err.message}` });
              });
            });

            if (!result.ok) {
              return {
                content: [{ type: "text", text: `Failed to read inbox: ${result.output}` }],
              };
            }

            // Parse inbox response
            try {
              const data = JSON.parse(result.output);
              const messages = data.data?.messages ?? [];
              
              if (messages.length === 0) {
                return {
                  content: [{ type: "text", text: "📭 No messages in inbox." }],
                };
              }

              // Format messages nicely
              const formatted = messages.map((m: { from: string; data: string; received_at: string; type: string }) => ({
                from: m.from,
                message: m.data,
                received: m.received_at,
                type: m.type,
              }));

              return {
                content: [
                  {
                    type: "text",
                    text: `📬 You have ${messages.length} message(s):\n\n${JSON.stringify(formatted, null, 2)}${clearArg ? "\n\n(Inbox cleared after reading)" : ""}`,
                  },
                ],
              };
            } catch {
              // Raw output if JSON parsing fails
              return {
                content: [{ type: "text", text: result.output || "📭 No messages in inbox." }],
              };
            }
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
