// [FORK-PATCH-4] Chat Mirror
//
// Re-delivers assistant replies to the session's original channel (e.g. WhatsApp)
// when the run was initiated from a different surface (e.g. webchat).
//
// Architecture:
//   - Self-contained mirror registry (Map<runId, MirrorEntry>).
//     No dependency on AgentRunContext or any upstream state.
//   - `registerMirror()` — called from chat.send handler when a run starts.
//   - `consumeMirror()` — called from emitChatFinal's onFinalText callback.
//     Returns the entry and auto-deletes it (one-shot, leak-proof).
//   - `deliverMirror()` — resolves the target channel from sessionKey and sends.
//
// Upstream touch surface: ZERO (chat-mirror.ts is 100% fork-owned).
// The only integration points are:
//   1. chat.send handler calls registerMirror() — 1 line
//   2. emitChatFinal opts.onFinalText callback calls consumeMirror() + deliverMirror() — 3 lines

import { sendMessageWhatsApp } from "../channel-web.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("gateway/chat-mirror");

// ---------------------------------------------------------------------------
// Mirror Registry — fully self-contained, no upstream dependencies
// ---------------------------------------------------------------------------

interface MirrorEntry {
  sessionKey: string;
  registeredAt: number;
}

const MIRROR_REGISTRY_KEY = Symbol.for("openclaw.chatMirror.registry");

/** Singleton registry survives hot-reload / chunk duplication. */
function getRegistry(): Map<string, MirrorEntry> {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[MIRROR_REGISTRY_KEY]) {
    g[MIRROR_REGISTRY_KEY] = new Map<string, MirrorEntry>();
  }
  return g[MIRROR_REGISTRY_KEY] as Map<string, MirrorEntry>;
}

// Auto-cleanup stale entries every 10 minutes (runs that crashed without consuming).
const STALE_MS = 10 * 60 * 1000;
let cleanupTimer: ReturnType<typeof setInterval> | undefined;

function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    const registry = getRegistry();
    for (const [runId, entry] of registry) {
      if (now - entry.registeredAt > STALE_MS) {
        registry.delete(runId);
        log.info(`[mirror] stale entry cleaned: runId=${runId}`);
      }
    }
  }, STALE_MS);
  // Don't block process exit
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a mirror intent for a run. Called once from chat.send handler.
 * @param runId  The agent run ID (same as clientRunId passed to onAgentRunStart)
 * @param sessionKey  The session key (contains channel + peer info)
 */
export function registerMirror(runId: string, sessionKey: string): void {
  getRegistry().set(runId, { sessionKey, registeredAt: Date.now() });
  ensureCleanupTimer();
}

/**
 * Consume (and delete) a mirror entry. Returns undefined if not registered.
 * One-shot: calling twice returns undefined the second time.
 */
export function consumeMirror(runId: string): MirrorEntry | undefined {
  const registry = getRegistry();
  const entry = registry.get(runId);
  if (entry) registry.delete(runId);
  return entry;
}

/**
 * Deliver the final text to the mirror target channel.
 * Resolves channel + peerId from the sessionKey.
 * Currently supports WhatsApp; extensible to other channels.
 */
export function deliverMirror(sessionKey: string, text: string): void {
  if (!text) return;
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
      // Future: add other channels here (telegram, discord, etc.)
    }
  } catch (mirrorErr) {
    log.warn(`[mirror] error: ${String(mirrorErr)}`);
  }
}

// ---------------------------------------------------------------------------
// Param extraction — strip `mirror` before upstream schema validation
// ---------------------------------------------------------------------------

/**
 * Extract and strip the `mirror` property from raw chat.send params.
 * Must be called BEFORE schema validation (upstream uses additionalProperties: false).
 * Returns true if mirror is requested (default: true for all webchat sends).
 */
export function extractMirrorParam(raw: Record<string, unknown>): boolean {
  const val = raw["mirror"];
  delete raw["mirror"];
  // Default true — webchat messages mirror to WA unless explicitly disabled
  if (val === undefined || val === null) return true;
  return Boolean(val);
}
