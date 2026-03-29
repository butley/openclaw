/**
 * Agent Registry — inbound message monitor.
 *
 * Subscribes to the local Pilot daemon's message stream via `pilotctl subscribe --json`.
 * Parses incoming JSON messages (one per line), converts them to AgentRegistryInboundMessage,
 * and dispatches through the provided onMessage callback.
 *
 * Features:
 * - Automatic reconnection with exponential backoff on disconnect
 * - Clean stop() method for graceful shutdown
 * - Error and lifecycle callbacks (onConnected, onDisconnected, onError)
 */

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { AgentRegistryInboundMessage } from "./types.js";

export type MonitorOptions = {
  pilotPort?: number;
  onMessage: (msg: AgentRegistryInboundMessage) => void | Promise<void>;
  onError?: (error: Error) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  maxReconnectAttempts?: number; // default 10
  baseReconnectDelayMs?: number; // default 1000
};

export type MonitorHandle = {
  /** Gracefully stop the monitor and kill the pilotctl process. */
  stop: () => void;
};

/**
 * Start listening for inbound Pilot messages.
 *
 * Spawns `pilotctl subscribe --json` and reads newline-delimited JSON from stdout.
 * Automatically reconnects on disconnect using exponential backoff.
 */
export async function startMonitor(options: MonitorOptions): Promise<MonitorHandle> {
  const {
    pilotPort,
    onMessage,
    onError,
    onConnected,
    onDisconnected,
    maxReconnectAttempts = 10,
    baseReconnectDelayMs = 1000,
  } = options;

  let stopped = false;
  let child: ChildProcess | null = null;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function buildArgs(): string[] {
    const args = ["subscribe", "--json"];
    if (pilotPort != null) {
      args.push("--port", String(pilotPort));
    }
    return args;
  }

  function parseMessage(line: string): AgentRegistryInboundMessage | null {
    try {
      const raw = JSON.parse(line);
      // Validate required fields
      if (
        typeof raw.from !== "string" ||
        typeof raw.fromAddress !== "string" ||
        typeof raw.body !== "string" ||
        typeof raw.timestamp !== "number" ||
        typeof raw.messageId !== "string"
      ) {
        return null;
      }
      return {
        from: raw.from,
        fromAddress: raw.fromAddress,
        body: raw.body,
        timestamp: raw.timestamp,
        messageId: raw.messageId,
        metadata: raw.metadata ?? undefined,
      };
    } catch {
      return null;
    }
  }

  let initialSpawnFailed = false;

  function connect(): void {
    if (stopped) return;

    const args = buildArgs();
    let spawned: ChildProcess;
    try {
      spawned = spawn("pilotctl", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
      scheduleReconnect();
      return;
    }

    child = spawned;

    // Handle spawn-level errors (e.g. binary not found)
    spawned.on("error", (err: NodeJS.ErrnoException) => {
      onError?.(err);
      child = null;
      
      // ENOENT means pilotctl not found - don't retry, throw immediately
      if (err.code === "ENOENT") {
        initialSpawnFailed = true;
        stopped = true; // Stop reconnect attempts
        return;
      }
      
      scheduleReconnect();
    });

    // Parse stdout as newline-delimited JSON
    if (spawned.stdout) {
      const rl = createInterface({ input: spawned.stdout });

      // First line received → treat as connected
      let connected = false;

      rl.on("line", (line) => {
        if (!connected) {
          connected = true;
          reconnectAttempts = 0; // reset on successful connection
          onConnected?.();
        }

        const trimmed = line.trim();
        if (!trimmed) return;

        const msg = parseMessage(trimmed);
        if (msg) {
          try {
            const result = onMessage(msg);
            // If onMessage returns a promise, catch its errors
            if (result && typeof (result as Promise<void>).catch === "function") {
              (result as Promise<void>).catch((err) => {
                onError?.(err instanceof Error ? err : new Error(String(err)));
              });
            }
          } catch (err) {
            onError?.(err instanceof Error ? err : new Error(String(err)));
          }
        } else {
          onError?.(new Error(`Failed to parse Pilot message: ${trimmed.slice(0, 200)}`));
        }
      });
    }

    // Collect stderr for error reporting
    let stderr = "";
    if (spawned.stderr) {
      spawned.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
        // Cap stderr collection to avoid memory leaks
        if (stderr.length > 4096) {
          stderr = stderr.slice(-2048);
        }
      });
    }

    spawned.on("exit", (code, signal) => {
      child = null;
      if (stopped) return;

      onDisconnected?.();

      if (code !== 0 && code !== null) {
        const errMsg = stderr.trim()
          ? `pilotctl subscribe exited (code ${code}): ${stderr.trim().slice(0, 500)}`
          : `pilotctl subscribe exited with code ${code}`;
        onError?.(new Error(errMsg));
      } else if (signal) {
        onError?.(new Error(`pilotctl subscribe killed by signal ${signal}`));
      }

      scheduleReconnect();
    });
  }

  function scheduleReconnect(): void {
    if (stopped) return;

    if (reconnectAttempts >= maxReconnectAttempts) {
      onError?.(
        new Error(
          `Monitor gave up after ${maxReconnectAttempts} reconnect attempts`,
        ),
      );
      return;
    }

    // Exponential backoff with jitter: delay = base * 2^attempts + random jitter
    const delay =
      baseReconnectDelayMs * Math.pow(2, reconnectAttempts) +
      Math.random() * baseReconnectDelayMs;
    reconnectAttempts++;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function stop(): void {
    stopped = true;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (child && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {
        // already dead
      }
      // Force-kill after 3s if still alive
      const killTimer = setTimeout(() => {
        if (child && !child.killed) {
          try {
            child.kill("SIGKILL");
          } catch {
            // already dead
          }
        }
      }, 3000);
      // Don't block Node shutdown
      if (killTimer.unref) killTimer.unref();
    }

    child = null;
  }

  // Start the initial connection
  connect();

  // Wait briefly for spawn error (ENOENT happens synchronously-ish)
  await new Promise<void>((resolve, reject) => {
    // Check immediately in case spawn failed synchronously
    if (initialSpawnFailed) {
      reject(Object.assign(new Error("pilotctl not found"), { code: "ENOENT" }));
      return;
    }
    
    // Check again after a short delay to catch async spawn errors
    setTimeout(() => {
      if (initialSpawnFailed) {
        reject(Object.assign(new Error("pilotctl not found"), { code: "ENOENT" }));
      } else {
        resolve();
      }
    }, 100);
  });

  return { stop };
}
