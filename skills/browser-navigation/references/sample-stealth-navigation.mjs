/**
 * Sample: Stealth browser navigation with login + data extraction
 *
 * This template demonstrates the recommended pattern for navigating
 * websites that have bot detection (Imperva, Cloudflare, DataDome).
 *
 * Usage: node /tmp/my-script.mjs
 *
 * Key patterns:
 * - createRequire() for ESM compatibility with CJS packages
 * - Absolute paths to /opt/openclaw/node_modules/ for package resolution
 * - StealthPlugin for WAF bypass
 * - page.type() with delay for natural input
 * - page.evaluate() for clicking when selectors are unreliable
 * - try/finally for guaranteed browser cleanup
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const puppeteerExtra = require("/opt/openclaw/node_modules/puppeteer-extra");
const StealthPlugin = require("/opt/openclaw/node_modules/puppeteer-extra-plugin-stealth");

puppeteerExtra.use(StealthPlugin());

const browser = await puppeteerExtra.launch({
  executablePath: "/opt/chrome/chrome",
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage"
  ]
});

const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });

try {
  // ── Step 1: Navigate to login page ──────────────────────────
  await page.goto("https://example.com/login", {
    waitUntil: "networkidle2",
    timeout: 30000
  });
  await new Promise(r => setTimeout(r, 3000));

  // ── Step 2: Handle cookie consent (if present) ──────────────
  try {
    const frames = page.frames();
    for (const frame of frames) {
      const btn = await frame.$('button[title="Accept All"]');
      if (btn) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 2000));
  } catch (e) { /* no consent banner */ }

  // ── Step 3: Fill credentials with natural typing delay ──────
  await page.waitForSelector('input[name="username"]', { timeout: 10000 });
  await page.type('input[name="username"]', "user@example.com", { delay: 70 });
  await page.type('input[name="password"]', "password123", { delay: 70 });

  // ── Step 4: Click submit via evaluate (reliable for SPAs) ───
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const submit = btns.find(b =>
      b.textContent?.trim().toLowerCase().includes("sign in") ||
      b.type === "submit"
    );
    if (submit) submit.click();
  });

  // ── Step 5: Wait for auth redirect ──────────────────────────
  await page.waitForFunction(
    () => window.location.href.includes("dashboard") ||
          window.location.href.includes("account"),
    { timeout: 20000 }
  );
  await new Promise(r => setTimeout(r, 3000));
  console.log("Logged in:", page.url());

  // ── Step 6: Navigate to target page ─────────────────────────
  await page.goto("https://example.com/dashboard", {
    waitUntil: "networkidle2",
    timeout: 30000
  });
  await new Promise(r => setTimeout(r, 3000));

  // ── Step 7: Extract data ────────────────────────────────────
  const data = await page.evaluate(() => {
    // Extract structured data from the page
    return {
      title: document.title,
      url: window.location.href,
      // Example: extract a list of items
      items: Array.from(document.querySelectorAll(".item")).map(el => ({
        name: el.querySelector("h3")?.textContent?.trim(),
        value: el.querySelector(".value")?.textContent?.trim()
      })),
      // Or just get all visible text
      text: document.body.innerText.substring(0, 5000)
    };
  });

  console.log(JSON.stringify(data, null, 2));

} catch (err) {
  console.error("Error:", err.message);
  // Take a debug screenshot on failure
  await page.screenshot({ path: "/tmp/debug-screenshot.png" }).catch(() => {});
} finally {
  await browser.close();
}
