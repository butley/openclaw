/**
 * Brazil WhatsApp JID Resolver
 * 
 * Handles the legacy 8-digit vs 9-digit mobile number issue in Brazil.
 * Uses Baileys' onWhatsApp() to discover the correct registered JID.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = process.env.CLAWDBOT_CONFIG_DIR || path.join(os.homedir(), '.config', 'clawdbot');
const CACHE_FILE = path.join(CONFIG_DIR, 'brazil-jid-cache.json');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// In-memory cache (persisted to disk)
let jidCache = null;

/**
 * Load cache from disk
 */
function loadCache() {
  if (jidCache !== null) return jidCache;
  
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      jidCache = data.entries || {};
    } else {
      jidCache = {};
    }
  } catch {
    jidCache = {};
  }
  return jidCache;
}

/**
 * Save cache to disk
 */
function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ 
      entries: jidCache,
      updatedAt: new Date().toISOString()
    }, null, 2));
  } catch (err) {
    console.error('[brazil-jid] Failed to save cache:', err.message);
  }
}

/**
 * Check if a number is a Brazilian mobile number that needs resolution
 */
export function isBrazilianMobile(digits) {
  // Must start with 55 (Brazil country code)
  if (!digits.startsWith('55')) return false;
  
  // After country code: 2-digit area code + 8 or 9 digit local number
  // Area codes: 11-99
  const afterCountryCode = digits.slice(2);
  
  // Total length should be 10 (8-digit) or 11 (9-digit) after country code
  if (afterCountryCode.length < 10 || afterCountryCode.length > 11) return false;
  
  const areaCode = afterCountryCode.slice(0, 2);
  const areaNum = parseInt(areaCode, 10);
  
  // Valid area codes are 11-99
  if (areaNum < 11 || areaNum > 99) return false;
  
  const localNumber = afterCountryCode.slice(2);
  
  // Mobile numbers start with 9 (after area code)
  // 8-digit: 9XXXXXXX (first digit is 9)
  // 9-digit: 9XXXXXXXX (first digit is 9)
  if (localNumber.length >= 8 && localNumber.length <= 9) {
    // For 9-digit, first digit should be 9
    if (localNumber.length === 9 && localNumber[0] === '9') return true;
    // For 8-digit legacy, first digit should be 6-9 (mobile range)
    if (localNumber.length === 8 && ['6', '7', '8', '9'].includes(localNumber[0])) return true;
  }
  
  return false;
}

/**
 * Generate both 8-digit and 9-digit variants for a Brazilian number
 */
export function generateBrazilianVariants(digits) {
  if (!digits.startsWith('55')) return [digits];
  
  const areaCode = digits.slice(2, 4);
  const localNumber = digits.slice(4);
  
  const variants = [];
  
  if (localNumber.length === 9 && localNumber.startsWith('9')) {
    // Has 9-digit format: try as-is and without leading 9
    variants.push(digits); // 9-digit
    variants.push(`55${areaCode}${localNumber.slice(1)}`); // 8-digit
  } else if (localNumber.length === 8) {
    // Has 8-digit format: try as-is and with leading 9
    variants.push(digits); // 8-digit
    variants.push(`55${areaCode}9${localNumber}`); // 9-digit
  } else {
    variants.push(digits);
  }
  
  return variants;
}

/**
 * Resolve the correct WhatsApp JID for a Brazilian number
 * 
 * @param {object} sock - Baileys socket with onWhatsApp method
 * @param {string} inputJid - The input JID (e.g., "5531996348700@s.whatsapp.net")
 * @returns {Promise<string>} - The verified JID or original if not Brazilian/not found
 */
export async function resolveBrazilianJid(sock, inputJid) {
  // Extract digits from JID
  const match = inputJid.match(/^(\d+)@s\.whatsapp\.net$/i);
  if (!match) return inputJid; // Not a user JID, return as-is
  
  const digits = match[1];
  
  // Only process Brazilian mobile numbers
  if (!isBrazilianMobile(digits)) return inputJid;
  
  // Check cache first
  const cache = loadCache();
  const cacheKey = digits.length === 13 ? digits : `55${digits.slice(2, 4)}9${digits.slice(4)}`; // Normalize to 9-digit for cache key
  const cached = cache[cacheKey];
  
  if (cached && cached.jid && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    console.log(`[brazil-jid] Cache hit: ${digits} → ${cached.jid}`);
    return cached.jid;
  }
  
  // Generate variants to check
  const variants = generateBrazilianVariants(digits);
  console.log(`[brazil-jid] Checking variants for ${digits}:`, variants);
  
  // Query WhatsApp for each variant
  for (const variant of variants) {
    const testJid = `${variant}@s.whatsapp.net`;
    try {
      const [result] = await sock.onWhatsApp(testJid);
      if (result?.exists) {
        const verifiedJid = result.jid || testJid;
        console.log(`[brazil-jid] Found: ${digits} → ${verifiedJid}`);
        
        // Cache the result
        cache[cacheKey] = {
          jid: verifiedJid,
          originalInput: digits,
          variant,
          timestamp: Date.now()
        };
        jidCache = cache;
        saveCache();
        
        return verifiedJid;
      }
    } catch (err) {
      console.warn(`[brazil-jid] Query failed for ${variant}:`, err.message);
    }
  }
  
  console.log(`[brazil-jid] No match found for ${digits}, using original`);
  return inputJid;
}

/**
 * Clear a specific entry from the cache
 */
export function clearCacheEntry(digits) {
  const cache = loadCache();
  const normalizedKey = digits.replace(/\D/g, '');
  if (cache[normalizedKey]) {
    delete cache[normalizedKey];
    jidCache = cache;
    saveCache();
    return true;
  }
  return false;
}

/**
 * Clear the entire cache
 */
export function clearCache() {
  jidCache = {};
  saveCache();
}
