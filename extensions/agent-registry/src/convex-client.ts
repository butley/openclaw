/**
 * Agent Registry — Convex client for reading workspace network metadata.
 *
 * Uses the same HTTP API pattern as butley-api (POST /api/query with gatewayToken auth).
 * Config comes from environment variables set by the orchestrator.
 */

export interface NetworkMetadata {
  networkDiscoverable: boolean;
  networkDisplayName?: string;
  networkDescription?: string;
  networkCapabilities?: string[];
  networkScheduleEnabled?: boolean;
  networkScheduleTimezone?: string;
  networkSchedule?: Record<string, { start?: string; end?: string } | null>;
}

interface ConvexEnv {
  convexUrl: string;
  installationId: string;
  gatewayToken: string;
}

/** Read Convex connection info from environment variables. */
export function getConvexEnv(): ConvexEnv | null {
  const convexUrl = process.env.BUTLEY_CONVEX_URL?.trim();
  const installationId = (process.env.BUTLEY_INSTALLATION_ID ?? process.env.INSTALLATION_ID)?.trim();
  const gatewayToken = process.env.BUTLEY_GATEWAY_TOKEN?.trim();

  if (!convexUrl || !installationId) return null;
  return { convexUrl, installationId, gatewayToken: gatewayToken ?? "" };
}

/** Fetch the installation's network metadata from Convex. */
export async function fetchNetworkMetadata(env?: ConvexEnv | null): Promise<NetworkMetadata | null> {
  const e = env ?? getConvexEnv();
  if (!e) return null;

  try {
    const res = await fetch(`${e.convexUrl}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "installations:get",
        args: {
          id: e.installationId,
          gatewayToken: e.gatewayToken,
        },
        format: "json",
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (data.status === "error" || !data.value) return null;

    const metadata = data.value.metadata ?? {};
    return {
      networkDiscoverable: metadata.networkDiscoverable === true,
      networkDisplayName: metadata.networkDisplayName,
      networkDescription: metadata.networkDescription,
      networkCapabilities: metadata.networkCapabilities,
      networkScheduleEnabled: metadata.networkScheduleEnabled,
      networkScheduleTimezone: metadata.networkScheduleTimezone,
      networkSchedule: metadata.networkSchedule,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Agent Network Handshakes — Convex CRUD                             */
/* ------------------------------------------------------------------ */

export interface HandshakeRecord {
  _id: string;
  installationId: string;
  fromNodeId: number;
  fromHostname?: string;
  fromPublicKey: string;
  introduction: string;
  status: "pending" | "approved" | "rejected";
  receivedAt: number;
  processedAt?: number;
  firstMessageSent: boolean;
  notificationSent: boolean;
}

/** Helper to call a Convex mutation via HTTP API. */
async function callConvexMutation(
  path: string,
  args: Record<string, unknown>,
  env?: ConvexEnv | null,
): Promise<{ ok: boolean; value?: unknown; error?: string }> {
  const e = env ?? getConvexEnv();
  if (!e) return { ok: false, error: "Convex env not configured" };

  try {
    const res = await fetch(`${e.convexUrl}/api/mutation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path,
        args: { ...args, installationId: e.installationId, gatewayToken: e.gatewayToken },
        format: "json",
      }),
    });

    const data = await res.json();
    if (!res.ok || data.status === "error") {
      return { ok: false, error: data.errorMessage ?? data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, value: data.value };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Helper to call a Convex query via HTTP API. */
async function callConvexQuery(
  path: string,
  args: Record<string, unknown>,
  env?: ConvexEnv | null,
): Promise<{ ok: boolean; value?: unknown; error?: string }> {
  const e = env ?? getConvexEnv();
  if (!e) return { ok: false, error: "Convex env not configured" };

  try {
    const res = await fetch(`${e.convexUrl}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path,
        args: { ...args, installationId: e.installationId, gatewayToken: e.gatewayToken },
        format: "json",
      }),
    });

    const data = await res.json();
    if (!res.ok || data.status === "error") {
      return { ok: false, error: data.errorMessage ?? data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, value: data.value };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Upsert a handshake record (insert or update existing by nodeId). */
export async function upsertHandshake(params: {
  fromNodeId: number;
  fromHostname?: string;
  fromPublicKey: string;
  introduction: string;
  status?: "pending" | "approved" | "rejected";
}): Promise<{ ok: boolean; error?: string }> {
  const result = await callConvexMutation("agentNetworkHandshakes:upsert", {
    fromNodeId: params.fromNodeId,
    fromHostname: params.fromHostname,
    fromPublicKey: params.fromPublicKey ?? "",
    introduction: params.introduction ?? "",
    status: params.status ?? "pending",
    receivedAt: Date.now(),
  });
  return { ok: result.ok, error: result.error };
}

/** Update handshake status (approved/rejected). */
export async function updateHandshakeStatus(params: {
  fromNodeId: number;
  status: "approved" | "rejected";
}): Promise<{ ok: boolean; error?: string }> {
  const result = await callConvexMutation("agentNetworkHandshakes:updateStatus", {
    fromNodeId: params.fromNodeId,
    status: params.status,
    processedAt: Date.now(),
  });
  return { ok: result.ok, error: result.error };
}

/** List pending handshakes for this installation. */
export async function listPendingHandshakes(): Promise<{ ok: boolean; handshakes?: HandshakeRecord[]; error?: string }> {
  const result = await callConvexQuery("agentNetworkHandshakes:listPending", {});
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, handshakes: (result.value as HandshakeRecord[]) ?? [] };
}

/** Mark first message as sent for a peer. */
export async function markFirstMessageSent(params: {
  fromNodeId: number;
}): Promise<{ ok: boolean; error?: string }> {
  const result = await callConvexMutation("agentNetworkHandshakes:markFirstMessageSent", {
    fromNodeId: params.fromNodeId,
  });
  return { ok: result.ok, error: result.error };
}

/** Mark notification as sent for a handshake (prevents re-notification on next poll). */
export async function markNotificationSent(params: {
  fromNodeId: number;
}): Promise<{ ok: boolean; error?: string }> {
  const result = await callConvexMutation("agentNetworkHandshakes:markNotificationSent", {
    fromNodeId: params.fromNodeId,
  });
  return { ok: result.ok, error: result.error };
}

/** List all handshakes for this installation (for cache rebuilding). */
export async function listAllHandshakes(): Promise<{ ok: boolean; handshakes?: HandshakeRecord[]; error?: string }> {
  const result = await callConvexQuery("agentNetworkHandshakes:listAll", {});
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, handshakes: (result.value as HandshakeRecord[]) ?? [] };
}

/** Get handshake record by node ID. */
export async function getHandshakeByNodeId(params: {
  fromNodeId: number;
}): Promise<{ ok: boolean; handshake?: HandshakeRecord | null; error?: string }> {
  const result = await callConvexQuery("agentNetworkHandshakes:getByNodeId", {
    fromNodeId: params.fromNodeId,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, handshake: (result.value as HandshakeRecord | null) ?? null };
}
