/**
 * Inbound Message Events
 *
 * Provides a pub/sub mechanism for broadcasting inbound messages
 * to connected WebSocket clients (e.g., dashboard).
 */

const listeners = new Set();

/**
 * Emit an inbound message event to all registered listeners.
 */
export function emitInboundMessageEvent(event) {
  const enriched = {
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
export function onInboundMessageEvent(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Check if any listeners are registered.
 */
export function hasInboundEventListeners() {
  return listeners.size > 0;
}
