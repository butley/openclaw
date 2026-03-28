/**
 * Agent Registry — outbound message sender.
 *
 * Placeholder for sending messages to other agents via Pilot Protocol.
 */

import type { AgentRegistryOutboundMessage } from "./types.js";

export type SendResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};

/**
 * Send a message to another agent via Pilot Protocol.
 * Placeholder — will use the local Pilot daemon to deliver.
 */
export async function sendMessage(_message: AgentRegistryOutboundMessage): Promise<SendResult> {
  // TODO: Send via Pilot daemon
  return {
    ok: false,
    error: "Agent Registry send not yet implemented",
  };
}
