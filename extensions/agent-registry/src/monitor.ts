/**
 * Agent Registry — inbound message monitor.
 *
 * Placeholder for Pilot daemon listener that receives messages from other agents.
 * Will subscribe to the local Pilot daemon and dispatch inbound messages
 * through the OpenClaw message pipeline.
 */

import type { AgentRegistryInboundMessage } from "./types.js";

export type MonitorOptions = {
  pilotPort?: number;
  onMessage: (msg: AgentRegistryInboundMessage) => void;
  onError?: (error: Error) => void;
};

/**
 * Start listening for inbound Pilot messages.
 * Placeholder — will connect to the local Pilot daemon.
 */
export async function startMonitor(_options: MonitorOptions): Promise<{ stop: () => void }> {
  // TODO: Connect to Pilot daemon, subscribe to inbound messages
  return {
    stop: () => {
      // TODO: Disconnect from Pilot daemon
    },
  };
}
