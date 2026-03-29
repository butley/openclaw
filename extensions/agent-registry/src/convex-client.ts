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
