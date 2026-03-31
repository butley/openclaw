/**
 * Agent Registry — Pilot daemon management.
 *
 * Manages the local Pilot daemon lifecycle:
 * - Start / stop the daemon
 * - Check daemon status
 * - Get local Pilot address
 */

import { spawn, execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";

export type DaemonStatus = {
  running: boolean;
  address?: string;
  hostname?: string;
  node_id?: number;
  port?: number;
  uptime?: number;
};

/** Module-level reference to the spawned daemon process. */
let daemonProcess: ChildProcess | null = null;

/**
 * Start the local Pilot daemon as a child process.
 *
 * NOTE: In container/production environments, the daemon is managed by
 * entrypoint.sh (not this function). startDaemon/stopDaemon are for
 * local development only.
 */
export async function startDaemon(
  options?: { hostname?: string; port?: number },
): Promise<{ ok: boolean; address?: string; error?: string }> {
  if (daemonProcess && !daemonProcess.killed) {
    return { ok: false, error: "Daemon is already running" };
  }

  const args = ["start"];
  if (options?.hostname) {
    args.push("--hostname", options.hostname);
  }
  if (options?.port) {
    args.push("--port", String(options.port));
  }

  return new Promise((resolve) => {
    try {
      const child = spawn("pilot-daemon", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      // Address pattern: "0:xxxx.xxxx.xxxx" (Pilot address format)
      const addressPattern = /\b(0:[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4})\b/;

      // Listen for early exit (startup failure)
      child.on("error", (err) => {
        daemonProcess = null;
        resolve({ ok: false, error: err.message });
      });

      // Give the daemon a moment to emit its address on stdout, then resolve.
      // If it exits before that, we catch it above.
      const startupTimeout = setTimeout(() => {
        const match = stdout.match(addressPattern);
        if (match) {
          daemonProcess = child;
          resolve({ ok: true, address: match[1] });
        } else {
          // Daemon started but no address found yet — still treat as running
          daemonProcess = child;
          resolve({ ok: true });
        }
      }, 2000);

      child.on("exit", (code) => {
        clearTimeout(startupTimeout);
        if (!daemonProcess || daemonProcess === child) {
          daemonProcess = null;
        }
        if (code !== 0 && code !== null) {
          resolve({
            ok: false,
            error: stderr.trim() || `Daemon exited with code ${code}`,
          });
        }
      });
    } catch (err) {
      resolve({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

/**
 * Gracefully stop the Pilot daemon. Sends SIGTERM, then SIGKILL after 5s.
 *
 * NOTE: In container/production environments, the daemon is managed by
 * entrypoint.sh. This function is for local development only.
 */
export async function stopDaemon(): Promise<{ ok: boolean }> {
  if (!daemonProcess || daemonProcess.killed) {
    daemonProcess = null;
    return { ok: true };
  }

  return new Promise((resolve) => {
    const child = daemonProcess!;

    const killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already dead
      }
    }, 5000);

    child.on("exit", () => {
      clearTimeout(killTimer);
      daemonProcess = null;
      resolve({ ok: true });
    });

    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(killTimer);
      daemonProcess = null;
      resolve({ ok: true });
    }
  });
}

/** Get the current status of the Pilot daemon via `pilotctl info --json`. */
export async function getDaemonStatus(): Promise<DaemonStatus> {
  return new Promise((resolve) => {
    execFile("pilotctl", ["info", "--json"], (err, stdout) => {
      if (err) {
        resolve({ running: false });
        return;
      }

      try {
        const info = JSON.parse(stdout);
        // pilotctl info --json returns { data: { ... }, status: "ok" }
        const data = info.data ?? info;
        resolve({
          running: true,
          address: data.address,
          hostname: data.hostname,
          node_id: data.node_id,
          port: data.port,
          uptime: data.uptime_secs ?? data.uptime,
        });
      } catch {
        resolve({ running: false });
      }
    });
  });
}

/** Get the local Pilot virtual address, or undefined if unavailable. */
export async function getDaemonAddress(): Promise<string | undefined> {
  const status = await getDaemonStatus();
  return status.address;
}

/** Check if Pilot Protocol is available (pilotctl exists and daemon is running). */
export async function isPilotInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    // First check if pilotctl exists
    execFile("which", ["pilotctl"], (err) => {
      if (err) {
        resolve(false);
        return;
      }
      // Then check if daemon is running via pilotctl info
      execFile("pilotctl", ["info"], (infoErr) => {
        // If info succeeds, daemon is running and ready
        resolve(!infoErr);
      });
    });
  });
}
