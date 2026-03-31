/**
 * P2P WebSocket Server
 *
 * Listens for incoming P2P connections from remote agents.
 * Authenticates via installation_id, routes messages to local sessions.
 */

import { Server as WebSocketServer } from "ws";

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
  AuthChallenge,
  AuthRequest,
  AuthOk,
  AuthFail,
  P2PMessage,
  getCurrentTimestamp,
  PROTOCOL_VERSION,
  deserialize,
} from "./protocol.js";
import { verifyTrust, isBlocked } from "./auth.js";
import { ConnectionPool } from "./connection-pool.js";

const logger = createLogger("p2p:server");

/**
 * P2P Server Configuration
 */
export interface P2PServerConfig {
  port: number;
  installationId: string;
  hostname: string;
  registryUrl: string;
  registryApiKey?: string;
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
  onMessage?: (
    fromId: string,
    fromHostname: string,
    body: string
  ) => Promise<void>;
}

/**
 * Authenticated peer connection
 */
interface AuthenticatedPeer {
  ws: any;
  installation_id: string;
  hostname: string;
  authenticated: true;
  session_id: string;
  last_heartbeat: number;
}

/**
 * P2P WebSocket Server
 */
export class P2PServer {
  private wss: WebSocketServer | null = null;
  private config: P2PServerConfig;
  private peers = new Map<any, AuthenticatedPeer>();
  private connectionPool: ConnectionPool;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(config: P2PServerConfig) {
    this.config = {
      heartbeatInterval: 30000, // 30 seconds
      heartbeatTimeout: 10000, // 10 seconds
      ...config,
    };
    this.connectionPool = new ConnectionPool(20, 50);
  }

  /**
   * Start the P2P server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.config.port });

        this.wss.on("connection", async (ws: any) => {
          try {
            await this.handleNewConnection(ws);
          } catch (error) {
            logger.error(`Error handling new connection: ${error}`);
            ws.close(1011, "Internal server error");
          }
        });

        this.wss.on("error", (error) => {
          logger.error(`WebSocket server error: ${error}`);
          reject(error);
        });

        logger.info(
          `P2P server listening on port ${this.config.port} (installation: ${this.config.installationId})`
        );

        // Start heartbeat monitor
        this.startHeartbeat();

        resolve();
      } catch (error) {
        logger.error(`Failed to start P2P server: ${error}`);
        reject(error);
      }
    });
  }

  /**
   * Stop the P2P server
   */
  async stop(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all peer connections
    const entries = Array.from(this.peers.entries());
    for (const [ws, peer] of entries) {
      ws.close(1000, "Server shutdown");
      this.peers.delete(ws);
    }

    // Close server
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          logger.info("P2P server stopped");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get list of connected peers
   */
  getConnections(): Array<{
    installation_id: string;
    hostname: string;
    session_id: string;
  }> {
    const connections: Array<{
      installation_id: string;
      hostname: string;
      session_id: string;
    }> = [];

    const values = Array.from(this.peers.values());
    for (const peer of values) {
      connections.push({
        installation_id: peer.installation_id,
        hostname: peer.hostname,
        session_id: peer.session_id,
      });
    }

    return connections;
  }

  /**
   * Get connection pool for outbound connections
   */
  getConnectionPool(): ConnectionPool {
    return this.connectionPool;
  }

  /**
   * Handle new WebSocket connection
   */
  private async handleNewConnection(ws: any): Promise<void> {
    logger.debug("New P2P connection");

    // Set up message listener (before auth)
    ws.on("message", (data: any) => {
      try {
        this.handleMessage(ws, data);
      } catch (error) {
        logger.error(`Message handler error: ${error}`);
      }
    });

    ws.on("close", () => {
      const peer = this.peers.get(ws);
      if (peer) {
        logger.info(`Peer disconnected: ${peer.installation_id}`);
        this.peers.delete(ws);
      }
      this.connectionPool.registerInbound(peer?.installation_id || "unknown", ws);
    });

    ws.on("error", (error: any) => {
      logger.error(`Connection error: ${error}`);
    });

    // Send auth challenge
    const challenge: AuthChallenge = {
      type: "auth_challenge",
      nonce: Math.random().toString(36).substring(2, 15),
      protocol_version: PROTOCOL_VERSION,
    };

    ws.send(JSON.stringify(challenge));
  }

  /**
   * Handle message from peer
   */
  private async handleMessage(ws: any, data: any): Promise<void> {
    try {
      const str = data instanceof Buffer ? data.toString("utf-8") : data;
      const msg = deserialize(str as string);

      let peer = this.peers.get(ws);

      // Handle auth
      if (msg.type === "auth") {
        if (peer) {
          logger.warn("Auth message on already authenticated connection");
          ws.close(1002, "Already authenticated");
          return;
        }

        const authReq = msg as AuthRequest;

        // Verify not blocked
        const blocked = await isBlocked(
          authReq.installation_id,
          this.config.installationId,
          {
            registryUrl: this.config.registryUrl,
            registryApiKey: this.config.registryApiKey,
          }
        );

        if (blocked) {
          logger.warn(`Blocked peer attempted connection: ${authReq.installation_id}`);
          const fail: AuthFail = {
            type: "auth_fail",
            authenticated: false,
            reason: "Peer is blocked",
          };
          ws.send(JSON.stringify(fail));
          ws.close(1008, "Peer is blocked");
          return;
        }

        // Create peer record
        peer = {
          ws,
          installation_id: authReq.installation_id,
          hostname: authReq.installation_id, // Will be updated if in registry
          authenticated: true,
          session_id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          last_heartbeat: Date.now(),
        };

        this.peers.set(ws, peer);

        // Register inbound connection
        this.connectionPool.registerInbound(authReq.installation_id, ws);

        // Send auth ok
        const ok: AuthOk = {
          type: "auth_ok",
          authenticated: true,
          session_id: peer.session_id,
        };

        ws.send(JSON.stringify(ok));
        logger.info(
          `Peer authenticated: ${authReq.installation_id} (session ${peer.session_id})`
        );
        return;
      }

      // All other messages require auth
      if (!peer) {
        logger.warn(`Unauthenticated message received, closing connection`);
        ws.close(1008, "Not authenticated");
        return;
      }

      // Handle heartbeat
      if (msg.type === "pong") {
        peer.last_heartbeat = Date.now();
        return;
      }

      // Handle regular messages
      if (msg.type === "message") {
        const inbound = msg as any;

        // Verify trust relationship
        const trusted = await verifyTrust(
          peer.installation_id,
          this.config.installationId,
          {
            registryUrl: this.config.registryUrl,
            registryApiKey: this.config.registryApiKey,
          }
        );

        if (!trusted) {
          logger.warn(
            `Message from untrusted peer: ${peer.installation_id}, ignoring`
          );
          return;
        }

        // Deliver to session
        if (this.config.onMessage) {
          await this.config.onMessage(
            peer.installation_id,
            peer.hostname,
            inbound.body
          );
        }

        logger.debug(`Message from ${peer.installation_id}: ${inbound.body.substring(0, 50)}`);
      }
    } catch (error) {
      logger.error(`Error processing message: ${error}`);
    }
  }

  /**
   * Start heartbeat monitor
   */
  private startHeartbeat(): void {
    const interval = this.config.heartbeatInterval || 30000;
    const timeout = this.config.heartbeatTimeout || 10000;

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();

      const entries = Array.from(this.peers.entries());
      for (const [ws, peer] of entries) {
        // Send ping
        ws.ping();

        // Check timeout
        if (now - peer.last_heartbeat > timeout) {
          logger.warn(
            `Heartbeat timeout for peer ${peer.installation_id}, closing`
          );
          ws.close(1000, "Heartbeat timeout");
          this.peers.delete(ws);
        }
      }
    }, interval);

    logger.debug(
      `Heartbeat monitor started (interval: ${interval}ms, timeout: ${timeout}ms)`
    );
  }
}
