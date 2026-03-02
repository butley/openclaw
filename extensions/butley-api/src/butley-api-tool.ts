import type { OpenClawPluginApi } from "../../../src/plugins/types.js";

interface ButleyApiConfig {
  convexUrl: string;
  installationId: string;
  gatewayToken: string;
}

const ACTIONS: Record<
  string,
  { method: "query" | "mutation"; path: string; requiredArgs?: string[] }
> = {
  listTasks: { method: "query", path: "agentApi:listTasks" },
  createTask: { method: "mutation", path: "agentApi:createTask", requiredArgs: ["title"] },
  updateTask: { method: "mutation", path: "agentApi:updateTask", requiredArgs: ["taskId"] },
  deleteTask: { method: "mutation", path: "agentApi:deleteTask", requiredArgs: ["taskId"] },
  listContacts: { method: "query", path: "agentApi:listContacts" },
  findOrCreateContact: {
    method: "mutation",
    path: "agentApi:findOrCreateContact",
    requiredArgs: ["phone"],
  },
  getContactByPhone: {
    method: "query",
    path: "agentApi:getContactByPhone",
    requiredArgs: ["phone"],
  },
};

export function createButleyApiTool(api: OpenClawPluginApi) {
  const config = (api.pluginConfig ?? {}) as ButleyApiConfig;

  if (!config.convexUrl || !config.installationId || !config.gatewayToken) {
    api.logger?.warn?.(
      "butley-api: missing config (convexUrl, installationId, or gatewayToken). Tool disabled.",
    );
    return null;
  }

  const actionNames = Object.keys(ACTIONS).join(", ");

  return {
    name: "butley_api",
    description: `Access workspace data in Convex Cloud. Actions: ${actionNames}.

Task args: title (required for create), description, status (backlog|todo|doing|done|blocked), priority (low|medium|high|urgent), owner, dueDate (timestamp), tags (string[]), notes, taskId (for update/delete).
Contact args: phone (required), name, nickname, email, notes, tags.
Filter args: status (for listTasks), limit (number).`,
    parameters: {
      type: "object" as const,
      properties: {
        action: {
          type: "string" as const,
          enum: Object.keys(ACTIONS),
          description: "The API action to perform",
        },
        args: {
          type: "object" as const,
          description: "Action-specific arguments (do NOT include installationId or gatewayToken)",
          additionalProperties: true,
        },
      },
      required: ["action"] as const,
    },
    async execute(_toolUseId: string, params: { action: string; args?: Record<string, unknown> }) {
      const { action, args: userArgs = {} } = params;

      const actionDef = ACTIONS[action];
      if (!actionDef) {
        return {
          content: [
            { type: "text", text: `Error: Unknown action '${action}'. Available: ${actionNames}` },
          ],
        };
      }

      if (actionDef.requiredArgs) {
        for (const req of actionDef.requiredArgs) {
          if (!(req in userArgs)) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: Missing required arg '${req}' for action '${action}'`,
                },
              ],
            };
          }
        }
      }

      const endpoint = `${config.convexUrl}/api/${actionDef.method}`;
      const body = {
        path: actionDef.path,
        args: {
          installationId: config.installationId,
          gatewayToken: config.gatewayToken,
          ...userArgs,
        },
        format: "json",
      };

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = await res.json();

        if (data.status === "error") {
          return {
            content: [{ type: "text", text: `Convex error: ${data.errorMessage || "unknown"}` }],
          };
        }

        return { content: [{ type: "text", text: JSON.stringify(data.value, null, 2) }] };
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
