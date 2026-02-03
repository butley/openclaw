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

const listeners = new Set<InboundEventListener>();

/**
 * Emit an inbound message event to all registered listeners.
 */
export function emitInboundMessageEvent(
  event: Omit<InboundMessageEventPayload, "timestamp"> & { timestamp?: number },
): void {
  const enriched: InboundMessageEventPayload = {
    ...event,
    timestamp: event.timestamp ?? Date.now(),
  };

  for (const listener of listeners) {
    try {
      listener(enriched);
    } catch {
      /* ignore listener errors */
    }
  }
}

/**
 * Register a listener for inbound message events.
 * Returns an unsubscribe function.
 */
export function onInboundMessageEvent(listener: InboundEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Check if any listeners are registered.
 */
export function hasInboundEventListeners(): boolean {
  return listeners.size > 0;
}
