/**
 * Pilot Protocol daemon management.
 *
 * Manages the lifecycle of the pilot-daemon process, which handles
 * peer-to-peer agent communication via the Pilot Protocol.
 */

import { spawn, execSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";

let daemonProcess: ChildProcess | null = null;

export type DaemonInfo = {
  hostname: string;
  address: string;
  port: number;
  running: boolean;
};

/**
 * Start the Pilot Protocol daemon.
 *
 * Spawns a `pilot-daemon start` process with the given hostname.
 * The daemon listens for incoming peer connections on the Pilot Protocol.
 */
export function startDaemon(hostname: string): void {
  if (daemonProcess) {
    throw new Error("Pilot daemon is already running");
  }

  daemonProcess = spawn("pilot-daemon", ["start", "--hostname", hostname], {
    stdio: "pipe",
    detached: false,
  });

  daemonProcess.on("exit", (_code) => {
    daemonProcess = null;
  });

  daemonProcess.on("error", (_err) => {
    daemonProcess = null;
  });
}

/**
 * Stop the Pilot Protocol daemon gracefully.
 */
export function stopDaemon(): void {
  if (!daemonProcess) {
    return;
  }

  daemonProcess.kill("SIGTERM");
  daemonProcess = null;
}

/**
 * Get information about the running daemon.
 *
 * Calls `pilotctl info` to retrieve the daemon's current address and status.
 */
export function getDaemonInfo(): DaemonInfo | null {
  try {
    const output = execSync("pilotctl info", {
      encoding: "utf-8",
      timeout: 5_000,
    }).trim();

    // Parse pilotctl info output (expected format TBD).
    // Stub: return a basic parsed result.
    const lines = output.split("\n");
    const info: Record<string, string> = {};
    for (const line of lines) {
      const [key, ...valueParts] = line.split(":");
      if (key && valueParts.length > 0) {
        info[key.trim().toLowerCase()] = valueParts.join(":").trim();
      }
    }

    return {
      hostname: info["hostname"] ?? "",
      address: info["address"] ?? "",
      port: parseInt(info["port"] ?? "0", 10),
      running: true,
    };
  } catch {
    return null;
  }
}

/**
 * Check if the Pilot Protocol daemon is currently running.
 */
export function isDaemonRunning(): boolean {
  if (daemonProcess && !daemonProcess.killed) {
    return true;
  }

  // Also check via pilotctl as a fallback (daemon may be running externally).
  const info = getDaemonInfo();
  return info?.running ?? false;
}
