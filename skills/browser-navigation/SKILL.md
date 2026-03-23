---
name: browser-navigation
description: "Navigate websites, log into accounts, scrape content, and automate web interactions using Playwright + Chromium. Use when: user asks to visit a website, log into an account, check information on a web page, fill forms, extract data from sites, or interact with any web UI. NOT for: simple URL fetching where web_fetch suffices, API calls that don't need a browser, or static file downloads via curl."
metadata: { "openclaw": { "emoji": "🌐", "requires": { "bins": ["node"], "node_modules": ["playwright"] } } }
---

# Browser Navigation

Automate real browser interactions: login, navigate, extract data, fill forms.

## When to Use

✅ **USE this skill when:**

- "Log into my account on [site]"
- "Check my [dashboard/balance/status] on [site]"
- "Go to [URL] and get [information]"
- "Fill out this form on [site]"
- Sites that require JavaScript rendering, authentication, or interaction

❌ **DON'T use this skill when:**

- Simple page fetch (use `web_fetch` tool instead)
- Direct API calls (use `curl` or `exec`)
- Downloading files from direct URLs

## How It Works

Playwright controls a real Chromium browser in headless mode. It can do everything a human can: click, type, scroll, wait, extract text, handle popups.

## Launch Pattern

Always launch Chromium with anti-detection flags. Many sites block default headless browsers.

```javascript
const { chromium } = require("playwright");

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled"
  ]
});

const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
});

// Remove automation indicator
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
});

const page = await context.newPage();
```

**Why these flags matter:**
- `AutomationControlled` — disables Chrome's automation indicator that bot detectors check
- Custom `userAgent` — default headless UA contains "HeadlessChrome", which sites block
- `navigator.webdriver = false` — another automation flag that sites check

## Navigation

```javascript
// For most pages — waits until DOM is ready (fast, reliable)
await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 30000 });

// For pages that need JS to fully render content
await page.goto("https://example.com", { waitUntil: "load", timeout: 30000 });
```

⚠️ **Avoid `networkidle`** for content pages — ad trackers and analytics never stop loading, causing timeouts. Use it only for login/auth pages where you need all requests to settle.

## Cookie Consent Banners

Most sites show a consent popup that blocks interaction. Dismiss it first.

```javascript
// Common pattern: consent in an iframe
try {
  const consentFrame = page.frameLocator('[id*="consent"], [id*="cookie"]');
  await consentFrame.getByRole("button", { name: /accept|agree|ok|got it/i })
    .first().click({ timeout: 5000 });
  await page.waitForTimeout(2000);
} catch (e) {
  // Fallback: remove the overlay via JS
  await page.evaluate(() => {
    document.querySelectorAll('[id*="consent"], [id*="cookie"], [class*="consent"], [class*="cookie-banner"]')
      .forEach(el => el.remove());
  });
}
```

## Typing Credentials

Use `keyboard.type()` with delay — not `fill()`. Some sites monitor input events and `fill()` bypasses them, causing auth to fail silently.

```javascript
await page.locator("input[name=username]").click();
await page.keyboard.type("user@example.com", { delay: 50 });

await page.locator("input[name=password]").click();
await page.keyboard.type("secret", { delay: 50 });
```

## Form Submission

Prefer clicking the submit button naturally over `force: true`. Forced clicks bypass JavaScript event handlers that may be required for the form to work.

```javascript
// Good — triggers all JS handlers
await page.locator("form button[type=submit]").click();

// Avoid unless the button is obscured by an overlay you already handled
await page.locator("form button[type=submit]").click({ force: true });
```

## Waiting for Auth

After submitting login forms, wait for a URL change or specific element:

```javascript
// Wait for redirect after login
await page.waitForURL(/.*dashboard|account|home.*/, { timeout: 20000 });

// Or wait for a specific element that only appears when logged in
await page.waitForSelector(".user-profile, .logout-button", { timeout: 20000 });
```

## Extracting Content

```javascript
// Get visible text from the page
const text = await page.evaluate(() => document.body.innerText);

// Get specific elements
const items = await page.evaluate(() => {
  return Array.from(document.querySelectorAll(".item")).map(el => ({
    title: el.querySelector("h2")?.textContent?.trim(),
    value: el.querySelector(".value")?.textContent?.trim()
  }));
});
```

## Complete Login + Navigate Example

```javascript
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"]
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = await context.newPage();

  // 1. Go to login page
  await page.goto("https://example.com/login", { waitUntil: "networkidle", timeout: 30000 });

  // 2. Handle cookie consent
  try {
    const cf = page.frameLocator('[id*="consent"]');
    await cf.getByRole("button", { name: /accept/i }).first().click({ timeout: 5000 });
    await page.waitForTimeout(2000);
  } catch (e) {
    await page.evaluate(() => {
      document.querySelectorAll('[id*="consent"]').forEach(el => el.remove());
    });
  }

  // 3. Type credentials (with delay)
  await page.locator("input[type=email], input[name=username]").click();
  await page.keyboard.type("user@example.com", { delay: 50 });
  await page.locator("input[type=password]").click();
  await page.keyboard.type("password123", { delay: 50 });

  // 4. Submit
  await page.locator("form button[type=submit]").click();

  // 5. Wait for auth
  await page.waitForURL(/.*dashboard.*/, { timeout: 20000 });
  console.log("Logged in:", page.url());

  // 6. Navigate to target page
  await page.goto("https://example.com/target", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000); // Let JS render

  // 7. Extract data
  const content = await page.evaluate(() => document.body.innerText);
  console.log(content);

  await browser.close();
})();
```

## Running Scripts

Write the script to a temp file and execute with Node:

```bash
node /tmp/my_script.js
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| CORS errors on login | Bot detection — verify anti-detection flags are set |
| Login form submits but nothing happens | Use `keyboard.type()` with delay instead of `fill()` |
| Timeout on page load | Switch from `networkidle` to `domcontentloaded` |
| Element click intercepted | Cookie consent overlay — dismiss it first |
| "Navigation interrupted" errors | Page has hash routing — go to base URL first, then interact |

## Cleanup

Always close the browser when done:

```javascript
await browser.close();
```
