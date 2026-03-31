/**
 * P2P WebSocket Client
 *
 * Connects to remote agents and sends messages.
 * Handles reconnection with exponential backoff.
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

import {
  P2POutbound,
  generateMessageId,
  getCurrentTimestamp,
  PROTOCOL_VERSION,
  AuthRequest,
  deserialize,
} from "./protocol.js";
import { ConnectionPool } from "./connection-pool.js";

const logger = createLogger("p2p:client");

/**
 * P2P Client Configuration
 */
export interface P2PClientConfig {
  installationId: string;
  hostname: string;
  registryUrl: string;
  connectionPool: ConnectionPool;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
}

/**
 * P2P Client for outbound connections
 */
export class P2PClient {
  private config: P2PClientConfig;
  private reconnectAttempts = new Map<string, number>(); // installation_id -> attempt count
  private reconnectMinMs: number;
  private reconnectMaxMs: number;

  constructor(config: P2PClientConfig) {
    this.config = config;
    this.reconnectMinMs = config.reconnectMinMs || 1000;
    this.reconnectMaxMs = config.reconnectMaxMs || 60000;
  }

  /**
   * Send a message to a peer
   *
   * @param installation_id - Target agent installation_id
   * @param body - Message content
   * @returns true if sent, false if failed
   */
  async sendMessage(installation_id: string, body: string): Promise<boolean> {
    try {
      const ws = await this.connectToPeer(installation_id);

      const msg: P2POutbound = {
        type: "message",
        id: generateMessageId(),
        body,
        timestamp: getCurrentTimestamp(),
        protocol_version: PROTOCOL_VERSION,
      };

      ws.send(JSON.stringify(msg));
      logger.debug(
        `Message sent to ${installation_id}: ${body.substring(0, 50)}`
      );
      return true;
    } catch (error) {
      logger.error(`Failed to send message to ${installation_id}: ${error}`);
      return false;
    }
  }

  /**
   * Connect to a peer (reuses existing connection from pool if available)
   *
   * @param installation_id - Target agent installation_id
   * @returns WebSocket connection
   */
  async connectToPeer(installation_id: string): Promise<any> {
    return this.config.connectionPool.getOrCreate(
      installation_id,
      async (id) => {
        return this.createConnection(id);
      }
    );
  }

  /**
   * Create a new connection to a peer
   */
  private async createConnection(installation_id: string): Promise<any> {
    // Lookup peer p2p_endpoint in registry
    const endpoint = await this.lookupPeerEndpoint(installation_id);
    if (!endpoint) {
      throw new Error(`Could not find P2P endpoint for ${installation_id}`);
    }

    logger.debug(`Connecting to ${installation_id} at ${endpoint}`);

    // Dynamic import to avoid ws circular dependency at module load
    const ws_module = await import("ws");
    const WebSocket = (ws_module as any).default || ws_module;

    return new Promise((resolve, reject) => {
      const attempts = (this.reconnectAttempts.get(installation_id) || 0) + 1;
      this.reconnectAttempts.set(installation_id, attempts);

      const ws = new WebSocket(endpoint);
      let authCompleted = false;
      let authTimeout: NodeJS.Timeout | null = null;

      ws.on("open", () => {
        // Send auth request
        const auth: AuthRequest = {
          type: "auth",
          installation_id: this.config.installationId,
          protocol_version: PROTOCOL_VERSION,
        };

        ws.send(JSON.stringify(auth));

        // Wait for auth response
        authTimeout = setTimeout(() => {
          logger.error(`Auth timeout for ${installation_id}`);
          ws.close(1000, "Auth timeout");
          reject(new Error("Auth timeout"));
        }, 5000);
      });

      ws.on("message", (data: any) => {
        try {
          const str =
            data instanceof Buffer ? data.toString("utf-8") : data;
          const msg = deserialize(str as string);

          if (msg.type === "auth_ok") {
            if (authTimeout) clearTimeout(authTimeout);
            authCompleted = true;
            this.reconnectAttempts.delete(installation_id);
            logger.info(`Authenticated to ${installation_id}`);
            resolve(ws);
          } else if (msg.type === "auth_fail") {
            if (authTimeout) clearTimeout(authTimeout);
            logger.error(
              `Auth failed for ${installation_id}: ${(msg as any).reason}`
            );
            ws.close(1008, "Auth failed");
            reject(new Error(`Auth failed: ${(msg as any).reason}`));
          }
        } catch (error) {
          logger.error(`Error processing auth response: ${error}`);
          if (authTimeout) clearTimeout(authTimeout);
          ws.close(1011, "Message processing error");
          reject(error);
        }
      });

      ws.on("close", () => {
        if (!authCompleted) {
          if (authTimeout) clearTimeout(authTimeout);
          // Reconnect with backoff
          this.scheduleReconnect(installation_id);
        }
      });

      ws.on("error", (error: any) => {
        if (!authCompleted) {
          if (authTimeout) clearTimeout(authTimeout);
          logger.error(`Connection error to ${installation_id}: ${error}`);
          // Will reconnect via close handler
        }
      });
    });
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(installation_id: string): void {
    const attempts = this.reconnectAttempts.get(installation_id) || 1;
    // Exponential backoff: min * 2^(attempts-1) with jitter
    const baseDelay = Math.min(
      this.reconnectMinMs * Math.pow(2, attempts - 1),
      this.reconnectMaxMs
    );
    const jitter = Math.random() * 0.1 * baseDelay;
    const delay = baseDelay + jitter;

    logger.debug(
      `Scheduling reconnect to ${installation_id} in ${delay.toFixed(0)}ms (attempt ${attempts})`
    );

    setTimeout(() => {
      // Clear from pool and retry on next send
      this.reconnectAttempts.set(installation_id, attempts + 1);
    }, delay);
  }

  /**
   * Lookup peer's P2P endpoint from registry
   */
  private async lookupPeerEndpoint(installation_id: string): Promise<string | null> {
    try {
      const url = `${this.config.registryUrl}/api/v1/agents/${installation_id}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        logger.warn(
          `Failed to lookup peer ${installation_id}: HTTP ${response.status}`
        );
        return null;
      }

      const data = (await response.json()) as {
        p2p_endpoint?: string;
      };

      return data.p2p_endpoint || null;
    } catch (error) {
      logger.error(
        `Error looking up peer endpoint for ${installation_id}: ${error}`
      );
      return null;
    }
  }

  /**
   * Close connection to a specific peer
   */
  closePeer(installation_id: string): void {
    this.config.connectionPool.close(installation_id);
    this.reconnectAttempts.delete(installation_id);
  }

  /**
   * Close all connections
   */
  closeAll(): void {
    this.config.connectionPool.closeAll();
    this.reconnectAttempts.clear();
  }

  /**
   * Get connection pool statistics
   */
  stats() {
    return this.config.connectionPool.stats();
  }
}
