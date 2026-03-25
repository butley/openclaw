import { t as CONFIG_DIR } from "./utils-CkvAiB-V.js";
import fs from "node:fs";
import path from "node:path";
//#region src/web/inbound/brazil-jid-resolver.ts
/**
* Brazil WhatsApp JID Resolver
*
* Handles the legacy 8-digit vs 9-digit mobile number issue in Brazil.
* Uses Baileys' onWhatsApp() to discover the correct registered JID.
*/
const CACHE_FILE = path.join(CONFIG_DIR, "brazil-jid-cache.json");
const CACHE_TTL_MS = 10080 * 60 * 1e3;
let jidCache = null;
/**
* Load cache from disk
*/
function loadCache() {
	if (jidCache !== null) return jidCache;
	try {
		if (fs.existsSync(CACHE_FILE)) jidCache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")).entries || {};
		else jidCache = {};
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
			entries: jidCache ?? {},
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		}, null, 2));
	} catch (err) {
		console.error("[brazil-jid] Failed to save cache:", err instanceof Error ? err.message : err);
	}
}
/**
* Check if a number is a Brazilian mobile number that needs resolution
*/
function isBrazilianMobile(digits) {
	if (!digits.startsWith("55")) return false;
	const afterCountryCode = digits.slice(2);
	if (afterCountryCode.length < 10 || afterCountryCode.length > 11) return false;
	const areaCode = afterCountryCode.slice(0, 2);
	const areaNum = Number.parseInt(areaCode, 10);
	if (areaNum < 11 || areaNum > 99) return false;
	const localNumber = afterCountryCode.slice(2);
	if (localNumber.length >= 8 && localNumber.length <= 9) {
		if (localNumber.length === 9 && localNumber[0] === "9") return true;
		if (localNumber.length === 8 && [
			"6",
			"7",
			"8",
			"9"
		].includes(localNumber[0] ?? "")) return true;
	}
	return false;
}
/**
* Generate both 8-digit and 9-digit variants for a Brazilian number
*/
function generateBrazilianVariants(digits) {
	if (!digits.startsWith("55")) return [digits];
	const areaCode = digits.slice(2, 4);
	const localNumber = digits.slice(4);
	const variants = [];
	if (localNumber.length === 9 && localNumber.startsWith("9")) {
		variants.push(digits);
		variants.push(`55${areaCode}${localNumber.slice(1)}`);
	} else if (localNumber.length === 8) {
		variants.push(digits);
		variants.push(`55${areaCode}9${localNumber}`);
	} else variants.push(digits);
	return variants;
}
/**
* Resolve the correct WhatsApp JID for a Brazilian number
*
* @param sock - Baileys socket with onWhatsApp method
* @param inputJid - The input JID (e.g., "5531996348700@s.whatsapp.net")
* @returns The verified JID or original if not Brazilian/not found
*/
async function resolveBrazilianJid(sock, inputJid) {
	if (!sock?.onWhatsApp) return inputJid;
	const match = inputJid.match(/^(\d+)@s\.whatsapp\.net$/i);
	if (!match) return inputJid;
	const digits = match[1];
	if (!isBrazilianMobile(digits)) return inputJid;
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
					timestamp: Date.now()
				};
				jidCache = cache;
				saveCache();
				return verifiedJid;
			}
		} catch (err) {
			console.warn(`[brazil-jid] Query failed for ${variant}:`, err instanceof Error ? err.message : err);
		}
	}
	console.log(`[brazil-jid] No match found for ${digits}, using original`);
	return inputJid;
}
//#endregion
export { resolveBrazilianJid as t };
