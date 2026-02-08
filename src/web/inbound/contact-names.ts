/**
 * Global in-memory contact name cache, populated from incoming messages (pushName).
 * Used by outbound to resolve phone numbers to display names for @mentions.
 */

import fs from "node:fs";
import path from "node:path";
import { normalizeE164 } from "../../utils.js";

const contactNames = new Map<string, string>();

/**
 * Record a contact's display name (typically from pushName on incoming messages).
 */
export function noteContactName(e164: string | undefined, name: string | undefined): void {
  if (!e164 || !name) {
    return;
  }
  const normalized = normalizeE164(e164);
  if (normalized) {
    contactNames.set(normalized, name);
  }
}

/**
 * Look up a contact's display name by phone number.
 * Returns undefined if not known.
 */
export function getContactName(e164: string): string | undefined {
  const normalized = normalizeE164(e164);
  if (!normalized) {
    return undefined;
  }
  return contactNames.get(normalized);
}

/**
 * Reverse lookup: find a phone number (E164) by display name.
 * Case-insensitive match. Returns the first match found.
 */
export function getContactPhone(name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [phone, contactName] of contactNames.entries()) {
    if (contactName.toLowerCase() === lower) {
      return phone;
    }
  }
  // Partial match: check if the search name is a prefix of a contact name
  for (const [phone, contactName] of contactNames.entries()) {
    if (contactName.toLowerCase().startsWith(lower)) {
      return phone;
    }
  }
  return undefined;
}

/**
 * Read the LID for a phone number from the WhatsApp auth directory's lid-mapping files.
 * Returns the LID JID (e.g., "264351109914877@lid") or undefined if not found.
 */
export function readLidForPhone(phone: string, authDir?: string): string | undefined {
  const digits = phone.replace(/[^\d]/g, "");
  if (!digits) {
    return undefined;
  }
  const dirs = authDir ? [authDir] : [];
  // Default auth dir
  const defaultDir = path.join(
    process.env.HOME ?? "/home/ubuntu",
    ".openclaw/credentials/whatsapp/default",
  );
  if (!dirs.includes(defaultDir)) {
    dirs.push(defaultDir);
  }
  for (const dir of dirs) {
    const filePath = path.join(dir, `lid-mapping-${digits}.json`);
    try {
      const data = fs.readFileSync(filePath, "utf8");
      const lid = JSON.parse(data) as string | null;
      if (lid) {
        return `${lid}@lid`;
      }
    } catch {
      // File doesn't exist or can't be read
    }
  }
  return undefined;
}
