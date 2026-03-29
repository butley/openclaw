/**
 * Agent Registry — outbound message sender.
 *
 * Sends messages to other agents via Pilot Protocol using `pilotctl send`.
 * Supports single-target, address-based, and broadcast sends.
 */

import { spawn } from "node:child_process";
import type { AgentRegistryOutboundMessage } from "./types.js";

export type SendResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};

export type SendOptions = {
  pilotPort?: number;
  /** Timeout in milliseconds for the pilotctl command (default: 15000). */
  timeoutMs?: number;
};

/**
 * Send a message to another agent via Pilot Protocol.
 *
 * Uses `pilotctl send --to <hostname> --json` with the message body piped via stdin.
 * The `to` field on the message can be either a hostname or a Pilot address.
 */
export async function sendMessage(
  message: AgentRegistryOutboundMessage,
  options?: SendOptions,
): Promise<SendResult> {
  const { pilotPort, timeoutMs = 15000 } = options ?? {};

  const payload = JSON.stringify({
    body: message.body,
    metadata: message.metadata ?? {},
  });

  const args = ["send", "--to", message.to, "--json"];
  if (pilotPort != null) {
    args.push("--port", String(pilotPort));
  }

  return executePilotSend(args, payload, timeoutMs);
}

/**
 * Send a message directly to a Pilot address (e.g. "1:0001.A3F2:1001").
 */
export async function sendMessageToAddress(
  address: string,
  body: string,
  options?: SendOptions & { metadata?: Record<string, unknown> },
): Promise<SendResult> {
  const { pilotPort, timeoutMs = 15000, metadata } = options ?? {};

  const payload = JSON.stringify({
    body,
    metadata: metadata ?? {},
  });

  const args = ["send", "--to", address, "--json"];
  if (pilotPort != null) {
    args.push("--port", String(pilotPort));
  }

  return executePilotSend(args, payload, timeoutMs);
}

/**
 * Broadcast a message to multiple agents.
 *
 * Sends the same message to each hostname in parallel.
 * Returns an array of results corresponding to each target.
 */
export async function broadcastMessage(
  hostnames: string[],
  body: string,
  options?: SendOptions & { metadata?: Record<string, unknown> },
): Promise<{ results: Array<SendResult & { to: string }> }> {
  const { metadata, ...sendOpts } = options ?? {};

  const results = await Promise.allSettled(
    hostnames.map(async (hostname) => {
      const result = await sendMessage(
        { to: hostname, body, metadata },
        sendOpts,
      );
      return { ...result, to: hostname };
    }),
  );

  return {
    results: results.map((r, i) => {
      if (r.status === "fulfilled") {
        return r.value;
      }
      return {
        ok: false,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        to: hostnames[i],
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Execute a pilotctl send command, piping the JSON payload via stdin.
 * Parses stdout for a delivery confirmation containing a messageId.
 */
function executePilotSend(
  args: string[],
  stdinPayload: string,
  timeoutMs: number,
): Promise<SendResult> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    try {
      const child = spawn("pilotctl", args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", (err) => {
        if (timer) clearTimeout(timer);
        resolve({ ok: false, error: err.message });
      });

      child.on("exit", (code) => {
        if (timer) clearTimeout(timer);

        if (code !== 0 && code !== null) {
          const errMsg = stderr.trim()
            ? `pilotctl send failed (code ${code}): ${stderr.trim().slice(0, 500)}`
            : `pilotctl send exited with code ${code}`;
          resolve({ ok: false, error: errMsg });
          return;
        }

        // Try to parse messageId from JSON response
        const result = parseSendResponse(stdout);
        resolve(result);
      });

      // Write payload to stdin and close
      child.stdin?.write(stdinPayload, () => {
        child.stdin?.end();
      });

      // Timeout guard
      timer = setTimeout(() => {
        timer = null;
        try {
          child.kill("SIGKILL");
        } catch {
          // already dead
        }
        resolve({ ok: false, error: `pilotctl send timed out after ${timeoutMs}ms` });
      }, timeoutMs);
    } catch (err) {
      if (timer) clearTimeout(timer);
      resolve({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

/**
 * Parse the JSON response from `pilotctl send --json`.
 * Expected format: { "ok": true, "messageId": "uuid" }
 */
function parseSendResponse(stdout: string): SendResult {
  const trimmed = stdout.trim();
  if (!trimmed) {
    // No output but exit code 0 — treat as success without messageId
    return { ok: true };
  }

  try {
    const data = JSON.parse(trimmed);
    if (data.ok === false) {
      return { ok: false, error: data.error ?? "Send rejected by Pilot daemon" };
    }
    return {
      ok: true,
      messageId: data.messageId ?? data.message_id ?? undefined,
    };
  } catch {
    // Non-JSON output — if the command succeeded (exit 0), treat as ok
    // Try to extract a UUID-like messageId from the text
    const uuidMatch = trimmed.match(
      /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i,
    );
    return {
      ok: true,
      messageId: uuidMatch?.[1],
    };
  }
}
