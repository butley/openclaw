/**
 * Sample: Browserbase cloud browser navigation
 *
 * Use Browserbase when the target site blocks datacenter IPs
 * (banking sites, some e-commerce, government portals).
 *
 * Browserbase provides a real browser on residential IPs — no stealth
 * plugin needed since it's not detectable as automation.
 *
 * Requires: BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID env vars
 * or hardcode them below.
 *
 * Usage: node /tmp/my-script.mjs
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const puppeteerCore = require("/opt/openclaw/node_modules/puppeteer-core");

const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY || "YOUR_KEY_HERE";
const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID || "YOUR_PROJECT_HERE";

// ── Create Browserbase session ──────────────────────────────
async function createSession() {
  const res = await fetch("https://api.browserbase.com/v1/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bb-api-key": BROWSERBASE_API_KEY
    },
    body: JSON.stringify({
      projectId: BROWSERBASE_PROJECT_ID
    })
  });
  if (!res.ok) throw new Error(`Browserbase API error: ${res.status} ${await res.text()}`);
  return await res.json();
}

const session = await createSession();
console.log("Browserbase session:", session.id);

// ── Connect via CDP (no stealth needed — real browser) ──────
const browser = await puppeteerCore.connect({
  browserWSEndpoint: session.connectUrl
});

const pages = await browser.pages();
const page = pages[0] || await browser.newPage();
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
  await browser.close();
  console.log("Done");
}
