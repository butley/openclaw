/**
 * Sample: Browserbase cloud browser navigation
 *
 * Use Browserbase when the target site blocks datacenter IPs
 * (banking sites, some e-commerce, government portals).
 *
 * Browserbase provides a real browser on residential IPs — no stealth
 * plugin needed since it's not detectable as automation.
 *
 * Requires: BROWSERBASE_API_KEY env var (or hardcode below)
 *
 * Usage: BROWSERBASE_API_KEY=bb_live_xxx node /tmp/my-script.mjs
 *
 * Session replay available at:
 *   https://browserbase.com/sessions/<session-id>
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const puppeteerCore = require("/opt/openclaw/node_modules/puppeteer-core");
const Browserbase = require("/opt/openclaw/node_modules/@browserbasehq/sdk").default;

const bb = new Browserbase({
  apiKey: process.env.BROWSERBASE_API_KEY || "YOUR_KEY_HERE"
});

// ── Create session ──────────────────────────────────────────
const session = await bb.sessions.create();
console.log("Session:", session.id);

// ── Live debug URL (open in browser to watch in real time) ──
const debug = await bb.sessions.debug(session.id);
console.log("Live debug:", debug.debuggerUrl);

// ── Connect via CDP ─────────────────────────────────────────
const browser = await puppeteerCore.connect({
  browserWSEndpoint: session.connectUrl
});

const page = (await browser.pages())[0] || await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

try {
  // ── Step 1: Navigate ────────────────────────────────────────
  await page.goto("https://example.com/login", {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await new Promise(r => setTimeout(r, 5000));

  console.log("URL:", page.url());
  console.log("Title:", await page.title());

  // ── Step 2: Fill credentials ────────────────────────────────
  await page.waitForSelector('input[name="username"]', { timeout: 10000 });
  await page.type('input[name="username"]', "user@example.com", { delay: 70 });
  await page.type('input[name="password"]', "password123", { delay: 70 });

  // ── Step 3: Submit ──────────────────────────────────────────
  await page.evaluate(() => {
    const btn = document.querySelector('button[type="submit"]');
    if (btn) btn.click();
  });

  await new Promise(r => setTimeout(r, 8000));
  console.log("After login:", page.url());

  // ── Step 4: Extract data ────────────────────────────────────
  const data = await page.evaluate(() => ({
    title: document.title,
    url: window.location.href,
    text: document.body.innerText.substring(0, 5000)
  }));
  console.log(JSON.stringify(data, null, 2));

} catch (err) {
  console.error("Error:", err.message);
} finally {
  await page.close();
  await browser.close();
  console.log(`Session replay: https://browserbase.com/sessions/${session.id}`);
}
