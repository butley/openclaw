/**
 * wa-streaming-utils.ts — Butley custom patch: WA Paragraph Streaming
 *
 * Extracted from process-message.ts to avoid upstream merge conflicts.
 * Upstream will never touch this file. Add all streaming-related helpers here.
 */

import { normalizeStreamLevel } from "../../../../src/auto-reply/thinking.js";
import { loadSessionStore } from "../../../../src/config/sessions.js";

/** Resolve paragraph delay in ms for a given stream level and text length. */
export function resolveStreamDelayMs(streamLevel: string, charCount: number): number {
  switch (streamLevel) {
    case "fast":
      return Math.max(2000, Math.min(6000, charCount * 20));
    case "on":
      return Math.max(4000, Math.min(10000, charCount * 40));
    case "slow":
      return Math.max(6000, Math.min(15000, charCount * 70));
    case "off":
      return 0;
    default: {
      // Support "custom:XX" where XX is ms per character
      if (streamLevel.startsWith("custom:")) {
        const msPerChar = parseInt(streamLevel.slice(7), 10);
        if (!isNaN(msPerChar) && msPerChar > 0) {
          return Math.max(1000, Math.min(20000, charCount * msPerChar));
        }
      }
      return 0;
    }
  }
}

/** Read the /str stream level for a session from the session store. */
export function readSessionStreamLevel(sessionKey: string, storePath: string): string {
  try {
    const store = loadSessionStore(storePath);
    const entry = store[sessionKey];
    const raw = entry?.streamLevel;
    if (!raw) {
      return "off";
    }
    // Already normalized (e.g. "custom:55") — return as-is if valid, otherwise re-normalize.
    if (raw.startsWith("custom:")) {
      return raw;
    }
    return normalizeStreamLevel(raw) ?? "off";
  } catch {
    return "off";
  }
}
