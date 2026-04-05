import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentNetworkTool } from "./agent-network-tool.js";

function createApi() {
  return {
    pluginConfig: {
      registryUrl: "https://registry.test",
      registryApiKey: "test-key",
    },
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
  };
}

function readText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
  const textBlock = content.find((entry) => entry.type === "text");
  return textBlock?.text ?? "";
}

describe("agent network tool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.BUTLEY_CONVEX_URL = "https://convex.test";
    process.env.BUTLEY_INSTALLATION_ID = "self-installation";
  });

  it("sends assistant_name and human_name in handshake requests", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = createAgentNetworkTool(createApi() as never);
    await tool?.execute("call-1", {
      action: "handshake",
      installation_id: "peer-installation",
      assistant_name: "Junin",
      human_name: "Guilherme",
      introduction: "Hi there",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const handshakeCall = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined];
    expect(JSON.parse(String(handshakeCall[1]?.body ?? ""))).toEqual({
      from_id: "self-installation",
      to_id: "peer-installation",
      assistant_name: "Junin",
      human_name: "Guilherme",
      introduction: "Hi there",
    });
  });

  it("requires assistant_name for handshake", async () => {
    const tool = createAgentNetworkTool(createApi() as never);
    const result = await tool?.execute("call-2", {
      action: "handshake",
      installation_id: "peer-installation",
    });

    expect(readText(result)).toContain("Missing required arg 'assistant_name'");
  });

  it("generates a fallback introduction when handshake omits one", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = createAgentNetworkTool(createApi() as never);
    await tool?.execute("call-2b", {
      action: "handshake",
      installation_id: "peer-installation",
      assistant_name: "Junin",
      human_name: "Guilherme",
    });

    const handshakeCall = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined];
    expect(JSON.parse(String(handshakeCall[1]?.body ?? ""))).toEqual({
      from_id: "self-installation",
      to_id: "peer-installation",
      assistant_name: "Junin",
      human_name: "Guilherme",
      introduction: "Junin is reaching out on behalf of Guilherme.",
    });
  });

  it("shows pending names from the API without parsing introduction text", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/trust/pending/")) {
        return {
          ok: true,
          json: async () => ({
            requests: [
              {
                from_id: "peer-installation",
                from_assistant_name: "Stored Assistant",
                from_human_name: "Stored Human",
                introduction: "Hi, I'm Different Assistant, assistant for Different Human",
                created_at: "2026-04-04T12:00:00Z",
              },
            ],
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const tool = createAgentNetworkTool(createApi() as never);
    const result = await tool?.execute("call-3", { action: "pending" });
    const text = readText(result);
    const formatted = JSON.parse(text.split("\n\n")[1] ?? "[]") as Array<{
      assistant_name: string;
      human_name: string;
      introduction: string;
    }>;

    expect(text).toContain('"assistant_name": "Stored Assistant"');
    expect(text).toContain('"human_name": "Stored Human"');
    expect(formatted[0]?.human_name).toBe("Stored Human");
    expect(formatted[0]?.introduction).toContain("Different Human");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("approves by assistant_name using pending API names before fallback lookup", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/trust/pending/")) {
        return {
          ok: true,
          json: async () => ({
            requests: [
              {
                from_id: "peer-installation",
                from_assistant_name: "Stored Assistant",
              },
            ],
          }),
        };
      }
      if (url.endsWith("/api/v1/trust/approve")) {
        return {
          ok: true,
          json: async () => ({ ok: true, body: init?.body }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const tool = createAgentNetworkTool(createApi() as never);
    const result = await tool?.execute("call-4", {
      action: "approve",
      assistant_name: "Stored Assistant",
    });

    expect(readText(result)).toContain("Approved handshake from 'Stored Assistant'");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const approveCall = fetchMock.mock.calls[1] as [RequestInfo | URL, RequestInit | undefined];
    expect(JSON.parse(String(approveCall[1]?.body ?? ""))).toEqual({
      from_id: "peer-installation",
      to_id: "self-installation",
    });
  });
});
