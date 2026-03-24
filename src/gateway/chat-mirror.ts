// [FORK-PATCH-4] Chat Mirror — extracted from server-chat.ts to deduplicate.
// Re-delivers final reply to the session's original channel (e.g. WhatsApp)
// when the run was initiated from webchat with mirror enabled.

import { sendMessageWhatsApp } from "../channel-web.js";
import { getAgentRunContext } from "../infra/agent-events.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("gateway/chat-mirror");

export function maybeMirrorToChannel(params: {
  sessionKey: string;
  runId: string;
  text: string;
}): void {
  const { sessionKey, runId, text } = params;
  if (!text) {
    return;
  }
  const runContext = getAgentRunContext(runId);
  if (!runContext?.mirror) {
    return;
  }
  try {
    const keyParts = sessionKey.split(":").filter(Boolean);
    // Format: agent:{agentId}:{channel}:{peerKind}:{peerId}
    if (keyParts.length >= 5 && keyParts[0] === "agent") {
      const channel = keyParts[2];
      const peerId = keyParts.slice(4).join(":");
      if (channel === "whatsapp" && peerId) {
        sendMessageWhatsApp(peerId, text, { verbose: false })
          .then(() => log.info(`[mirror] sent to ${channel}:${peerId}`))
          .catch((err: unknown) => log.warn(`[mirror] failed: ${String(err)}`));
      }
    }
  } catch (mirrorErr) {
    log.warn(`[mirror] error: ${String(mirrorErr)}`);
  }
}
