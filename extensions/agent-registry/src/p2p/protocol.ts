/**
 * P2P WebSocket Protocol - Message Types and Serialization
 *
 * Defines the messaging protocol for direct agent-to-agent communication.
 * Version: 1.0
 */

export const PROTOCOL_VERSION = "1.0";

/**
 * Base P2P message envelope
 */
export interface P2PMessage {
  type:
    | "message"
    | "ping"
    | "pong"
    | "handshake_request"
    | "handshake_approved"
    | "handshake_rejected";
  id: string; // UUID
  from_id?: string; // sender installation_id (omitted in outbound)
  from_hostname?: string; // sender display name (omitted in outbound)
  body?: string; // message content
  timestamp: string; // ISO 8601
  protocol_version: string;
}

/**
 * Outbound message (sent by this agent)
 */
export interface P2POutbound extends P2PMessage {
  type: "message";
  body: string;
}

/**
 * Inbound message (received from peer)
 */
export interface P2PInbound extends P2PMessage {
  type: "message";
  from_id: string;
  from_hostname: string;
  body: string;
}

/**
 * Heartbeat ping
 */
export interface P2PPing extends P2PMessage {
  type: "ping";
}

/**
 * Heartbeat pong response
 */
export interface P2PPong extends P2PMessage {
  type: "pong";
}

/**
 * Handshake notification (delivered via P2P after approval)
 */
export interface HandshakeNotification extends P2PMessage {
  type: "handshake_request" | "handshake_approved" | "handshake_rejected";
  from_id: string;
  from_hostname: string;
  introduction?: string; // for requests
}

/**
 * Authentication challenge sent by server on new connection
 */
export interface AuthChallenge {
  type: "auth_challenge";
  nonce: string;
  protocol_version: string;
}

/**
 * Authentication response from client
 */
export interface AuthRequest {
  type: "auth";
  installation_id: string;
  protocol_version: string;
}

/**
 * Authentication success response
 */
export interface AuthOk {
  type: "auth_ok";
  authenticated: true;
  session_id: string;
}

/**
 * Authentication failure response
 */
export interface AuthFail {
  type: "auth_fail";
  authenticated: false;
  reason: string;
}

/**
 * Union type of all possible messages
 */
export type AnyP2PMessage =
  | P2POutbound
  | P2PInbound
  | P2PPing
  | P2PPong
  | HandshakeNotification
  | AuthChallenge
  | AuthRequest
  | AuthOk
  | AuthFail;

/**
 * Serialize a message to JSON
 */
export function serialize(msg: AnyP2PMessage): string {
  return JSON.stringify(msg);
}

/**
 * Deserialize a JSON message
 */
export function deserialize(data: string): AnyP2PMessage {
  try {
    const msg = JSON.parse(data);
    if (!msg.type || !msg.timestamp) {
      throw new Error("Invalid message: missing type or timestamp");
    }
    return msg as AnyP2PMessage;
  } catch (error) {
    throw new Error(`Failed to deserialize message: ${error}`);
  }
}

/**
 * Validate a message type
 */
export function isValidMessageType(type: string): boolean {
  const validTypes = [
    "message",
    "ping",
    "pong",
    "handshake_request",
    "handshake_approved",
    "handshake_rejected",
    "auth_challenge",
    "auth",
    "auth_ok",
    "auth_fail",
  ];
  return validTypes.includes(type);
}

/**
 * Create a timestamped message ID
 */
export function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get current timestamp in ISO 8601 format
 */
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}
