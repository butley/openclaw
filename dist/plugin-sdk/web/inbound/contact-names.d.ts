/**
 * Global contact name cache, populated from incoming messages (pushName).
 * Persisted to disk so it survives gateway restarts.
 * Used by outbound to resolve phone numbers to display names for @mentions.
 */
/** Load persisted contact names from disk. Called once at startup. */
export declare function loadContactNameCache(filePath?: string): void;
/**
 * Record a contact's display name (typically from pushName on incoming messages).
 */
export declare function noteContactName(e164: string | undefined, name: string | undefined): void;
/**
 * Look up a contact's display name by phone number.
 * Returns undefined if not known.
 */
export declare function getContactName(e164: string): string | undefined;
/**
 * Reverse lookup: find a phone number (E164) by display name.
 * Case-insensitive match. Returns the first match found.
 */
export declare function getContactPhone(name: string): string | undefined;
/**
 * Read the LID for a phone number from the WhatsApp auth directory's lid-mapping files.
 * Returns the LID JID (e.g., "264351109914877@lid") or undefined if not found.
 */
export declare function readLidForPhone(phone: string, authDir?: string): string | undefined;
