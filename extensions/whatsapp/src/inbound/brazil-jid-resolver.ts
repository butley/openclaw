/**
 * Brazil WhatsApp JID Resolver
 *
 * Handles the legacy 8-digit vs 9-digit mobile number issue in Brazil.
 * Uses Baileys' onWhatsApp() to discover the correct registered JID.
 */

import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "openclaw/plugin-sdk/text-runtime";

const CACHE_FILE = path.join(CONFIG_DIR, "brazil-jid-cache.json");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type CacheEntry = {
  jid: string;
  originalInput: string;
  variant: string;
  timestamp: number;
};

type OnWhatsAppResult = { exists?: boolean; jid?: string };

type OnWhatsAppApi = {
  onWhatsApp: (jid: string) => Promise<Array<OnWhatsAppResult>>;
};

// In-memory cache (persisted to disk)
let jidCache: Record<string, CacheEntry> | null = null;

function loadCache(): Record<string, CacheEntry> {
  if (jidCache !== null) {
    return jidCache;
  }
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")) as {
        entries?: Record<string, CacheEntry>;
      };
      jidCache = data.entries || {};
    } else {
      jidCache = {};
    }
  } catch {
    jidCache = {};
  }
  return jidCache;
}

function saveCache(): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify(
        {
          entries: jidCache ?? {},
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error("[brazil-jid] Failed to save cache:", err instanceof Error ? err.message : err);
  }
}

export function isBrazilianMobile(digits: string): boolean {
  if (!digits.startsWith("55")) {
    return false;
  }
  const afterCountryCode = digits.slice(2);
  if (afterCountryCode.length < 10 || afterCountryCode.length > 11) {
    return false;
  }
  const areaCode = afterCountryCode.slice(0, 2);
  const areaNum = Number.parseInt(areaCode, 10);
  if (areaNum < 11 || areaNum > 99) {
    return false;
  }
  const localNumber = afterCountryCode.slice(2);
  if (localNumber.length >= 8 && localNumber.length <= 9) {
    if (localNumber.length === 9 && localNumber[0] === "9") {
      return true;
    }
    if (localNumber.length === 8 && ["6", "7", "8", "9"].includes(localNumber[0] ?? "")) {
      return true;
    }
  }
  return false;
}

export function generateBrazilianVariants(digits: string): string[] {
  if (!digits.startsWith("55")) {
    return [digits];
  }
  const areaCode = digits.slice(2, 4);
  const localNumber = digits.slice(4);
  const variants: string[] = [];
  if (localNumber.length === 9 && localNumber.startsWith("9")) {
    variants.push(digits);
    variants.push(`55${areaCode}${localNumber.slice(1)}`);
  } else if (localNumber.length === 8) {
    variants.push(digits);
    variants.push(`55${areaCode}9${localNumber}`);
  } else {
    variants.push(digits);
  }
  return variants;
}

export async function resolveBrazilianJid(sock: OnWhatsAppApi, inputJid: string): Promise<string> {
  if (!sock?.onWhatsApp) {
    return inputJid;
  }
  const match = inputJid.match(/^(\d+)@s\.whatsapp\.net$/i);
  if (!match) {
    return inputJid;
  }
  const digits = match[1];
  if (!isBrazilianMobile(digits)) {
    return inputJid;
  }
  const cache = loadCache();
  const cacheKey = digits.length === 13 ? digits : `55${digits.slice(2, 4)}9${digits.slice(4)}`;
  const cached = cache[cacheKey];
  if (cached && cached.jid && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log(`[brazil-jid] Cache hit: ${digits} → ${cached.jid}`);
    return cached.jid;
  }
  const variants = generateBrazilianVariants(digits);
  console.log(`[brazil-jid] Checking variants for ${digits}:`, variants);
  for (const variant of variants) {
    const testJid = `${variant}@s.whatsapp.net`;
    try {
      const [result] = await sock.onWhatsApp(testJid);
      if (result?.exists) {
        const verifiedJid = result.jid || testJid;
        console.log(`[brazil-jid] Found: ${digits} → ${verifiedJid}`);
        cache[cacheKey] = {
          jid: verifiedJid,
          originalInput: digits,
          variant,
          timestamp: Date.now(),
        };
        jidCache = cache;
        saveCache();
        return verifiedJid;
      }
    } catch (err) {
      console.warn(
        `[brazil-jid] Query failed for ${variant}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  console.log(`[brazil-jid] No match found for ${digits}, using original`);
  return inputJid;
}

export function clearCacheEntry(digits: string): boolean {
  const cache = loadCache();
  const normalizedKey = digits.replace(/\D/g, "");
  if (cache[normalizedKey]) {
    delete cache[normalizedKey];
    jidCache = cache;
    saveCache();
    return true;
  }
  return false;
}

export function clearCache(): void {
  jidCache = {};
  saveCache();
}
