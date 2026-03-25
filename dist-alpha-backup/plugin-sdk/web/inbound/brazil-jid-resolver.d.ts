/**
 * Brazil WhatsApp JID Resolver
 *
 * Handles the legacy 8-digit vs 9-digit mobile number issue in Brazil.
 * Uses Baileys' onWhatsApp() to discover the correct registered JID.
 */
type OnWhatsAppResult = {
    exists?: boolean;
    jid?: string;
};
type OnWhatsAppApi = {
    onWhatsApp: (jid: string) => Promise<Array<OnWhatsAppResult>>;
};
/**
 * Check if a number is a Brazilian mobile number that needs resolution
 */
export declare function isBrazilianMobile(digits: string): boolean;
/**
 * Generate both 8-digit and 9-digit variants for a Brazilian number
 */
export declare function generateBrazilianVariants(digits: string): string[];
/**
 * Resolve the correct WhatsApp JID for a Brazilian number
 *
 * @param sock - Baileys socket with onWhatsApp method
 * @param inputJid - The input JID (e.g., "5531996348700@s.whatsapp.net")
 * @returns The verified JID or original if not Brazilian/not found
 */
export declare function resolveBrazilianJid(sock: OnWhatsAppApi, inputJid: string): Promise<string>;
/**
 * Clear a specific entry from the cache
 */
export declare function clearCacheEntry(digits: string): boolean;
/**
 * Clear the entire cache
 */
export declare function clearCache(): void;
export {};
