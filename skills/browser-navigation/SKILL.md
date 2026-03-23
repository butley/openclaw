---
name: browser-navigation
description: "Navigate websites, log into accounts, scrape content, and automate web interactions using Puppeteer + Stealth. Use when: user asks to visit a website, log into an account, check information on a web page, fill forms, extract data from sites, or interact with any web UI. NOT for: simple URL fetching where web_fetch suffices, API calls that don't need a browser, or static file downloads via curl."
metadata: { "openclaw": { "emoji": "🌐", "requires": { "bins": ["node"], "node_modules": ["puppeteer-extra", "puppeteer-extra-plugin-stealth", "puppeteer-core"] } } }
---

# Browser Navigation

Automate real browser interactions: login, navigate, extract data, fill forms.

Uses **Puppeteer + puppeteer-extra-plugin-stealth** for robust anti-bot evasion. This combo passes most WAFs (Imperva, Cloudflare, etc.) that block vanilla headless Chrome or Playwright.

## When to Use

✅ **USE this skill when:**

- "Log into my account on [site]"
- "Check my [dashboard/balance/status] on [site]"
- "Go to [URL] and get [information]"
- "Fill out this form on [site]"
- Sites that require JavaScript rendering, authentication, or interaction
- Sites with bot detection (Imperva, Cloudflare, DataDome)

❌ **DON'T use this skill when:**

- Simple page fetch (use `web_fetch` tool instead)
- Direct API calls (use `curl` or `exec`)
- Downloading files from direct URLs

## Why Puppeteer + Stealth (Not Playwright)

Playwright's headless mode is easily detected by WAFs because it uses a patched Chromium with unique fingerprints. The `puppeteer-extra-plugin-stealth` applies ~12 evasion techniques:

- `navigator.webdriver` removal
- Chrome runtime injection (`window.chrome`)
- WebGL vendor/renderer spoofing
- Permissions API masking
- Language and plugin consistency
- iframe contentWindow protection
- Media codecs fingerprint
- Source URL leak prevention

This is the difference between getting blocked and passing through.

## Chrome Binary

The container includes Chrome for Testing at:

```
/opt/chrome/chrome
```

If the path changes or you need to find it:

```bash
find / -name "chrome" -type f 2>/dev/null | head -5
```

## Launch Pattern

Always use `puppeteer-extra` with the stealth plugin — never raw `puppeteer-core`.

```javascript
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

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
```

**Why these flags:**
- `--no-sandbox` — required when running as root in containers
- `--disable-blink-features=AutomationControlled` — extra automation flag removal
- `--disable-dev-shm-usage` — prevents crashes in Docker (limited /dev/shm)
- Stealth plugin handles the rest automatically

## Navigation

```javascript
// For most pages — waits until network settles (best for SPAs)
await page.goto("https://example.com", { waitUntil: "networkidle2", timeout: 30000 });

// For fast loads where you don't need all resources
await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 30000 });
```

## Cookie Consent Banners

Most sites show a consent popup that blocks interaction. Dismiss it first.

```javascript
// Common pattern: consent in an iframe
try {
  const frames = page.frames();
  for (const frame of frames) {
    const btn = await frame.$('button[title="Accept All"]');
    if (btn) { await btn.click(); break; }
  }
} catch (e) {
  // Try alternative selectors
  try {
    await page.click('[id*="accept"], [class*="accept"], button:has-text("Accept")', { timeout: 3000 });
  } catch (e2) {
    // No consent banner — continue
  }
}

await new Promise(r => setTimeout(r, 2000));
```

## Typing Credentials

Use `page.type()` with delay — it generates real keyboard events. Never use Puppeteer's `page.evaluate()` to set input values directly, as form handlers won't trigger.

```javascript
await page.type(".username-input", "user@example.com", { delay: 50 });
await page.type("input[name=password]", "secret123", { delay: 50 });
```

**Why delay matters:** Sites monitor input event timing. Instant input (0ms between keystrokes) flags automation. 30-80ms delay mimics human typing.

## Form Submission

Click the submit button — don't call `form.submit()` directly. SPAs (React, Angular, jQuery) attach event handlers to buttons, not forms.

```javascript
await page.click("button[type=submit]");
```

## Waiting for Auth

After submitting login forms, wait for navigation or a specific element:

```javascript
// Wait for URL change (redirects after login)
await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});

// Or wait for a specific element
await page.waitForSelector(".user-profile, .logout-button, .dashboard", { timeout: 15000 });

// Or wait for URL pattern
await page.waitForFunction(
  () => window.location.href.includes("dashboard") || window.location.href.includes("account"),
  { timeout: 15000 }
);
```

## Extracting Content

```javascript
// Get all visible text
const text = await page.evaluate(() => document.body.innerText);

// Get specific elements
const items = await page.evaluate(() => {
  return Array.from(document.querySelectorAll(".item")).map(el => ({
    title: el.querySelector("h2")?.textContent?.trim(),
    value: el.querySelector(".value")?.textContent?.trim()
  }));
});

// Take a screenshot for debugging
await page.screenshot({ path: "/tmp/debug.png", fullPage: true });
```

## Complete Login + Navigate Example

```javascript
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteerExtra.use(StealthPlugin());

const browser = await puppeteerExtra.launch({
  executablePath: "/opt/chrome/chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"]
});

const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });

try {
  // 1. Navigate to login page
  await page.goto("https://example.com/login", { waitUntil: "networkidle2", timeout: 30000 });

  // 2. Handle cookie consent
  try {
    const frames = page.frames();
    for (const frame of frames) {
      const btn = await frame.$('button[title="Accept All"]');
      if (btn) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 2000));
  } catch (e) { /* no consent banner */ }

  // 3. Type credentials with natural delay
  await page.type("input[name=username]", "user@example.com", { delay: 50 });
  await page.type("input[name=password]", "password123", { delay: 50 });

  // 4. Submit and wait for auth
  await page.click("button[type=submit]");
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));

  console.log("Logged in:", page.url());

  // 5. Navigate to target page
  await page.goto("https://example.com/dashboard", { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // 6. Extract data
  const content = await page.evaluate(() => document.body.innerText);
  console.log(content);

} finally {
  await browser.close();
}
```

## Running Scripts

Write the script as an `.mjs` file (ES modules) and execute:

```bash
cat > /tmp/scrape.mjs << 'EOF'
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
// ... script content
EOF

node /tmp/scrape.mjs
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Pardon Our Interruption" / WAF block | Verify stealth plugin is loaded (check `puppeteerExtra.use(StealthPlugin())` before launch) |
| Login form submits but nothing happens | Use `page.type()` with `delay: 50`, not `page.evaluate()` to set values |
| CORS / network errors on XHR | Bot detection at TLS level — stealth plugin should handle this |
| Timeout on page load | Switch from `networkidle0` to `networkidle2` or `domcontentloaded` |
| Element click intercepted | Cookie consent overlay — dismiss it first (check iframes) |
| "Navigation interrupted" | Page uses hash routing — use `waitForFunction` instead of `waitForNavigation` |
| Chrome crash in Docker | Add `--disable-dev-shm-usage` flag |

## Cleanup

Always close the browser in a finally block:

```javascript
try {
  // ... automation
} finally {
  await browser.close();
}
```
