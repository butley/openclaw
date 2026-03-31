/**
 * P2P Authentication & Trust Verification
 *
 * Verifies trust relationships via Agent Registry API.
 * No JWT, no challenge-response — trust is checked via Registry.
 */

// Simple logger utility
function createLogger(name: string) {
  return {
    debug: (msg: string) => console.debug(`[${name}] ${msg}`),
    info: (msg: string) => console.info(`[${name}] ${msg}`),
    warn: (msg: string) => console.warn(`[${name}] ${msg}`),
    error: (msg: string) => console.error(`[${name}] ${msg}`),
  };
}

const logger = createLogger("p2p:auth");

/**
 * Configuration for trust verification
 */
export interface TrustVerifyOptions {
  registryUrl: string;
  registryApiKey?: string;
}

/**
 * Trust relationship from Registry
 */
export interface TrustRecord {
  requester_id: string;
  target_id: string;
  status: "pending" | "approved" | "rejected" | "blocked";
  created_at: string;
  approved_at?: string;
}

/**
 * Verify trust relationship between two agents
 *
 * @param fromId - Sender installation_id
 * @param toId - Recipient installation_id
 * @param options - Registry configuration
 * @returns true if trust relationship is approved, false otherwise
 */
export async function verifyTrust(
  fromId: string,
  toId: string,
  options: TrustVerifyOptions
): Promise<boolean> {
  try {
    const { registryUrl, registryApiKey } = options;

    // Construct trust list endpoint
    const url = `${registryUrl}/api/v1/trust/list/${toId}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (registryApiKey) {
      headers["Authorization"] = `Bearer ${registryApiKey}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      logger.warn(
        `Trust lookup failed for ${fromId} -> ${toId}: HTTP ${response.status}`
      );
      return false;
    }

    const data = (await response.json()) as { peers: TrustRecord[] };

    // Check if fromId is in approved peers
    const approved = data.peers.some(
      (peer) => peer.requester_id === fromId && peer.status === "approved"
    );

    if (approved) {
      logger.debug(`Trust verified: ${fromId} -> ${toId}`);
    } else {
      logger.debug(
        `Trust denied: ${fromId} -> ${toId} (not in approved list)`
      );
    }

    return approved;
  } catch (error) {
    logger.error(`Error verifying trust: ${error}`);
    return false;
  }
}

/**
 * Check if agent is blocked by recipient
 *
 * @param fromId - Sender installation_id
 * @param toId - Recipient installation_id
 * @param options - Registry configuration
 * @returns true if agent is blocked
 */
export async function isBlocked(
  fromId: string,
  toId: string,
  options: TrustVerifyOptions
): Promise<boolean> {
  try {
    const { registryUrl, registryApiKey } = options;

    const url = `${registryUrl}/api/v1/trust/list/${toId}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (registryApiKey) {
      headers["Authorization"] = `Bearer ${registryApiKey}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      return false;
    }

    const data = (await response.json()) as { peers: TrustRecord[] };

    const blocked = data.peers.some(
      (peer) => peer.requester_id === fromId && peer.status === "blocked"
    );

    return blocked;
  } catch (error) {
    logger.error(`Error checking blocked status: ${error}`);
    return false;
  }
}
