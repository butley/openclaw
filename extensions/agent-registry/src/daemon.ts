/**
 * Agent Registry — Pilot daemon management.
 *
 * Placeholder for managing the local Pilot daemon lifecycle:
 * - Start / stop the daemon
 * - Check daemon status
 * - Get local Pilot address
 */

export type DaemonStatus = {
  running: boolean;
  address?: string;
  hostname?: string;
  port?: number;
  uptime?: number;
};

/**
 * Start the local Pilot daemon.
 * Placeholder — will spawn or connect to the pilot process.
 */
export async function startDaemon(_options?: { port?: number }): Promise<{ ok: boolean; error?: string }> {
  // TODO: Start Pilot daemon
  return { ok: false, error: "Pilot daemon start not yet implemented" };
}

/**
 * Stop the local Pilot daemon.
 * Placeholder.
 */
export async function stopDaemon(): Promise<{ ok: boolean }> {
  // TODO: Stop Pilot daemon
  return { ok: false };
}

/**
 * Get the current status of the Pilot daemon.
 * Placeholder.
 */
export async function getDaemonStatus(): Promise<DaemonStatus> {
  // TODO: Query Pilot daemon status
  return { running: false };
}
