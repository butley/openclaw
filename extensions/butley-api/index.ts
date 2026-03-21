import type {
  AnyAgentTool,
  OpenClawPluginApi,
  PluginHookLlmOutputEvent,
  PluginHookAgentContext,
} from "openclaw/plugin-sdk";
import { createButleyApiTool } from "./src/butley-api-tool.js";

interface ButleyApiConfig {
  convexUrl: string;
  installationId: string;
  gatewayToken: string;
}

/** Per-session message counter for idempotency key (sessionId + messageIndex). */
const sessionCounters = new Map<string, number>();

export default function register(api: OpenClawPluginApi) {
  const tool = createButleyApiTool(api);
  if (tool) {
    api.registerTool(tool as unknown as AnyAgentTool);
  }

  const config = (api.pluginConfig ?? {}) as Partial<ButleyApiConfig>;
  if (!config.convexUrl || !config.installationId || !config.gatewayToken) return;

  // llm_output hook: record token usage fire-and-forget
  api.on("llm_output", (event: PluginHookLlmOutputEvent, ctx: PluginHookAgentContext) => {
    if (!event.usage) return;

    const sessionId = event.sessionId ?? ctx.sessionId ?? "unknown";
    const counter = (sessionCounters.get(sessionId) ?? 0) + 1;
    sessionCounters.set(sessionId, counter);

    const body = {
      path: "agentApi:recordTokenUsage",
      args: {
        installationId: config.installationId,
        gatewayToken: config.gatewayToken,
        sessionId,
        inputTokens: event.usage.input ?? 0,
        outputTokens: event.usage.output ?? 0,
        model: event.model,
        provider: event.provider,
        costUsd: 0,
        timestamp: Date.now(),
        messageIndex: counter,
      },
      format: "json",
    };

    // Fire-and-forget: no await, does not block agent
    fetch(`${config.convexUrl}/api/mutation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch((err) => {
      api.logger?.warn?.(`butley-api: token usage recording failed: ${err}`);
    });
  });
}
