/**
 * wa-streaming-utils.ts — Butley custom patch: WA Paragraph Streaming
 *
 * Extracted from process-message.ts to avoid upstream merge conflicts.
 * Upstream will never touch this file. Add all streaming-related helpers here.
 */
/** Resolve paragraph delay in ms for a given stream level and text length. */
export declare function resolveStreamDelayMs(streamLevel: string, charCount: number): number;
/** Read the /str stream level for a session from the session store. */
export declare function readSessionStreamLevel(sessionKey: string, storePath: string): string;
