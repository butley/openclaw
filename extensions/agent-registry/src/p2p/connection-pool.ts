/**
 * P2P Connection Pool - LRU Management
 *
 * Manages persistent WebSocket connections to remote agents.
 * - Max 20 outbound connections (to peers)
 * - Max 50 inbound connections (from peers)
 * - LRU eviction for outbound
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

const logger = createLogger("p2p:connection-pool");

/**
 * Connection pool entry
 */
interface PoolEntry {
  ws: any;
  installation_id: string;
  created_at: number;
  last_activity: number;
}

/**
 * LRU Connection Pool
 */
export class ConnectionPool {
  private outbound = new Map<string, PoolEntry>(); // installation_id -> connection
  private inbound_count = 0;
  private maxOutbound: number;
  private maxInbound: number;

  constructor(maxOutbound = 20, maxInbound = 50) {
    this.maxOutbound = maxOutbound;
    this.maxInbound = maxInbound;
  }

  /**
   * Get or create an outbound connection
   *
   * @param installation_id - Target agent installation_id
   * @param factory - Function to create new connection if needed
   * @returns Existing or newly created connection
   */
  async getOrCreate(
    installation_id: string,
    factory: (id: string) => Promise<any>
  ): Promise<any> {
    // Return existing connection
    const existing = this.outbound.get(installation_id);
    if (existing && existing.ws.readyState === WebSocket.OPEN) {
      existing.last_activity = Date.now();
      return existing.ws;
    }

    // Remove stale connection
    if (existing) {
      this.outbound.delete(installation_id);
    }

    // Check capacity
    if (this.outbound.size >= this.maxOutbound) {
      this.evictLRU();
    }

    // Create new connection
    const ws = await factory(installation_id);
    const entry: PoolEntry = {
      ws,
      installation_id,
      created_at: Date.now(),
      last_activity: Date.now(),
    };

    this.outbound.set(installation_id, entry);
    logger.debug(`Created outbound connection to ${installation_id}`);

    // Auto-cleanup on close
    ws.on("close", () => {
      this.outbound.delete(installation_id);
      logger.debug(`Removed closed connection to ${installation_id}`);
    });

    return ws;
  }

  /**
   * Register an inbound connection
   *
   * @param installation_id - Peer agent installation_id
   * @param ws - WebSocket connection
   * @returns true if registered, false if at capacity
   */
  registerInbound(installation_id: string, ws: any): boolean {
    if (this.inbound_count >= this.maxInbound) {
      logger.warn(
        `Rejecting inbound connection from ${installation_id}: pool at capacity`
      );
      return false;
    }

    this.inbound_count++;
    logger.debug(
      `Registered inbound connection from ${installation_id} (${this.inbound_count}/${this.maxInbound})`
    );

    // Auto-cleanup on close
    ws.on("close", () => {
      this.inbound_count--;
      logger.debug(
        `Removed closed inbound connection (${this.inbound_count}/${this.maxInbound})`
      );
    });

    return true;
  }

  /**
   * Get an active outbound connection
   *
   * @param installation_id - Target agent installation_id
   * @returns Connection or null if not found/closed
   */
  get(installation_id: string): any | null {
    const entry = this.outbound.get(installation_id);
    if (entry && entry.ws.readyState === 1) { // 1 = OPEN
      entry.last_activity = Date.now();
      return entry.ws;
    }
    if (entry) {
      this.outbound.delete(installation_id);
    }
    return null;
  }

  /**
   * List all active outbound connections
   */
  listOutbound(): string[] {
    const active: string[] = [];
    const entries = Array.from(this.outbound.entries());
    for (const [id, entry] of entries) {
      if (entry.ws.readyState === 1) { // 1 = OPEN
        active.push(id);
      }
    }
    return active;
  }

  /**
   * Close a specific connection
   *
   * @param installation_id - Target agent installation_id
   */
  close(installation_id: string): void {
    const entry = this.outbound.get(installation_id);
    if (entry) {
      entry.ws.close(1000, "Closed by pool");
      this.outbound.delete(installation_id);
      logger.debug(`Closed connection to ${installation_id}`);
    }
  }

  /**
   * Close all connections
   */
  closeAll(): void {
    const values = Array.from(this.outbound.values());
    for (const entry of values) {
      entry.ws.close(1000, "Pool shutdown");
    }
    this.outbound.clear();
    logger.debug("Closed all outbound connections");
  }

  /**
   * Get connection statistics
   */
  stats() {
    return {
      outbound: this.outbound.size,
      maxOutbound: this.maxOutbound,
      inbound: this.inbound_count,
      maxInbound: this.maxInbound,
    };
  }

  /**
   * Evict least recently used connection
   */
  private evictLRU(): void {
    let lru: [string, PoolEntry] | null = null;
    let min_activity = Infinity;

    const entries = Array.from(this.outbound.entries());
    for (const entry of entries) {
      if (entry[1].last_activity < min_activity) {
        min_activity = entry[1].last_activity;
        lru = entry;
      }
    }

    if (lru) {
      const [id, entry] = lru;
      logger.debug(`Evicting LRU connection to ${id}`);
      entry.ws.close(1000, "LRU eviction");
      this.outbound.delete(id);
    }
  }
}
