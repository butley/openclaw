/**
 * Pilot Protocol messaging transport.
 *
 * Handles peer-to-peer message exchange between agents using
 * the Pilot Protocol. Messages are JSON-encoded with a standard envelope.
 */

import net from "node:net";

export type PilotMessageType = "text" | "request" | "response" | "ping" | "pong";

export type PilotMessage = {
  type: PilotMessageType;
  from: string;
  to: string;
  payload: unknown;
  timestamp: number;
  id?: string;
};

export type PeerMessageCallback = (message: PilotMessage, socket: net.Socket) => void;

/**
 * Dial a peer agent and send a message via Pilot Protocol.
 *
 * Opens a TCP connection to the peer's hostname:port, sends
 * the JSON-encoded message, and waits for a response.
 */
export function dialPeer(
  hostname: string,
  port: number,
  message: PilotMessage,
): Promise<PilotMessage | null> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Connection to ${hostname}:${port} timed out`));
    }, 30_000);

    let buffer = "";

    socket.connect(port, hostname, () => {
      socket.write(JSON.stringify(message) + "\n");
    });

    socket.on("data", (data) => {
      buffer += data.toString();
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex !== -1) {
        clearTimeout(timeout);
        const raw = buffer.slice(0, newlineIndex);
        try {
          const response = JSON.parse(raw) as PilotMessage;
          resolve(response);
        } catch {
          resolve(null);
        }
        socket.end();
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to connect to ${hostname}:${port}: ${err.message}`));
    });

    socket.on("close", () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

/**
 * Listen for incoming peer connections on a given port.
 *
 * Starts a TCP server that accepts Pilot Protocol messages
 * and invokes the callback for each received message.
 */
export function listenForPeers(
  port: number,
  callback: PeerMessageCallback,
): net.Server {
  const server = net.createServer((socket) => {
    let buffer = "";

    socket.on("data", (data) => {
      buffer += data.toString();
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex !== -1) {
        const raw = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        try {
          const message = JSON.parse(raw) as PilotMessage;
          callback(message, socket);
        } catch {
          // Ignore malformed messages.
        }
      }
    });

    socket.on("error", () => {
      // Ignore individual socket errors.
    });
  });

  server.listen(port);
  return server;
}

/**
 * High-level send: compose and deliver a message to a peer agent.
 */
export async function sendMessage(
  peerHostname: string,
  payload: {
    from: string;
    type?: PilotMessageType;
    content: unknown;
    port?: number;
  },
): Promise<PilotMessage | null> {
  const message: PilotMessage = {
    type: payload.type ?? "text",
    from: payload.from,
    to: peerHostname,
    payload: payload.content,
    timestamp: Date.now(),
  };

  const port = payload.port ?? 1001;
  return dialPeer(peerHostname, port, message);
}
