/**
 * wa-verbose-utils.ts — Butley custom patch: Verbose Light
 *
 * Extracted from process-message.ts to avoid upstream merge conflicts.
 * Upstream will never touch this file. Add all verbose-narration helpers here.
 * Includes: formatToolNarration, logToolNarrationDelivered.
 */
/**
 * Reformat upstream verbose tool narration into clean one-liners for WhatsApp.
 * Strips emoji prefixes, shortens paths, collapses verbose exec chains.
 */
export declare function formatToolNarration(raw: string): string;
/**
 * Log tool narration delivery at DEBUG level.
 * Tool narrations are side-channel messages — logging them at INFO
 * creates noise indistinguishable from final reply delivery.
 * Tool execution is already tracked via the native tool start/end logs.
 */
export declare function logToolNarrationDelivered(fromDisplay: string, hasMedia: boolean): void;
