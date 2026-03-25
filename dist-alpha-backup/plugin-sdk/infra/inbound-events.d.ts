/**
 * Inbound Message Events
 *
 * Provides a pub/sub mechanism for broadcasting inbound messages
 * to connected WebSocket clients (e.g., dashboard).
 */
export type InboundMessageEventPayload = {
    /** Unique message ID */
    messageId?: string;
    /** Session key for routing */
    sessionKey?: string;
    /** Channel the message came from (whatsapp, telegram, discord, etc.) */
    channel: string;
    /** Account ID within the channel */
    accountId?: string;
    /** Sender identifier (phone, username, etc.) */
    from: string;
    /** Sender display name */
    senderName?: string;
    /** Message content */
    content: string;
    /** Unix timestamp in milliseconds */
    timestamp: number;
    /** Chat type (dm, group) */
    chatType?: "dm" | "group";
    /** Conversation/chat ID */
    conversationId?: string;
    /** Thread ID if applicable */
    threadId?: string;
    /** Whether message has media */
    hasMedia?: boolean;
    /** Media type if present */
    mediaType?: string;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
};
type InboundEventListener = (evt: InboundMessageEventPayload) => void;
/**
 * Emit an inbound message event to all registered listeners.
 */
export declare function emitInboundMessageEvent(event: Omit<InboundMessageEventPayload, "timestamp"> & {
    timestamp?: number;
}): void;
/**
 * Register a listener for inbound message events.
 * Returns an unsubscribe function.
 */
export declare function onInboundMessageEvent(listener: InboundEventListener): () => void;
/**
 * Check if any listeners are registered.
 */
export declare function hasInboundEventListeners(): boolean;
export {};
