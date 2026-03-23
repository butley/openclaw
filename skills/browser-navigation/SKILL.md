---
name: browser-navigation
description: "Navigate websites, log into accounts, scrape content, and automate web interactions using Browserbase cloud browser. Use when: user asks to visit a website, log into an account, check information on a web page, fill forms, extract data from sites, or interact with any web UI. NOT for: simple URL fetching where web_fetch suffices, API calls that don't need a browser, or static file downloads via curl."
metadata: { "openclaw": { "emoji": "🌐", "requires": { "bins": ["node"], "node_modules": ["puppeteer-core", "@browserbasehq/sdk"] } } }
---

# Browser Navigation

Automate real browser interactions: login, navigate, extract data, fill forms.

Uses **Browserbase** cloud browser infrastructure. Browserbase provides a real Chrome browser on residential IPs — no stealth plugins or anti-detection needed since the browser is indistinguishable from a regular user.

## When to Use

✅ **USE this skill when:**

- "Log into my account on [site]"
- "Check my [dashboard/balance/status] on [site]"
- "Go to [URL] and get [information]"
- "Fill out this form on [site]"
- Sites that require JavaScript rendering, authentication, or interaction
- Sites with bot detection (Imperva, Cloudflare, DataDome)
- Sites that block datacenter IPs (banking, government)

❌ **DON'T use this skill when:**

- Simple page fetch (use `web_fetch` tool instead)
- Direct API calls (use `curl` or `exec`)
- Downloading files from direct URLs

## Why Browserbase (Not Local Chrome)

Browserbase runs a real Chrome browser on their cloud infrastructure with residential IPs. This means:

- **No anti-detection needed** — it's a real browser, not detectable as automation
- **Residential IPs** — bypasses datacenter IP blocks (banking, government portals)
- **No local Chrome** — ~250MB smaller container image
- **Live debug** — watch the browser in real time via debug URL
- **Session replay** — review sessions at `browserbase.com/sessions/<id>`

## Environment

The `BROWSERBASE_API_KEY` env var is injected into the container by the orchestrator. No configuration needed in the agent.

## Reference Sample

See `references/sample-browserbase-navigation.mjs` for a complete working example with login, data extraction, and error handling.

## Launch Pattern

Use `puppeteer-core` with `@browserbasehq/sdk` — connect to a Browserbase session via CDP.

**Important: ESM compatibility.** Scripts must use `.mjs` extension and `createRequire()` with absolute paths to resolve the packages correctly:

```javascript
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const puppeteerCore = require("/opt/openclaw/node_modules/puppeteer-core");
const Browserbase = require("/opt/openclaw/node_modules/@browserbasehq/sdk").default;

const bb = new Browserbase({
  apiKey: process.env.BROWSERBASE_API_KEY
});

// Create session + get live debug URL
const session = await bb.sessions.create();
console.log("Session:", session.id);

const debug = await bb.sessions.debug(session.id);
console.log("Live debug:", debug.debuggerUrl);

// Connect via CDP
const browser = await puppeteerCore.connect({
  browserWSEndpoint: session.connectUrl
});

const page = (await browser.pages())[0] || await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
```

**Why `createRequire` + absolute paths?** The packages live in `/opt/openclaw/node_modules/` but scripts run from `/tmp/` or `/root/`. ESM import resolution won't find them without the absolute path.

## Navigation

```javascript
// For most pages — waits until network settles (best for SPAs)
await page.goto("https://example.com", { waitUntil: "networkidle2", timeout: 45000 });

// For fast loads where you don't need all resources
await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 45000 });
```

**Note:** Browserbase sessions may have slightly higher latency than local Chrome. Use generous timeouts (45s+) and longer waits between actions.

## Cookie Consent Banners

Most sites show a consent popup that blocks interaction. Dismiss it first.

```javascript
try {
  const frames = page.frames();
  for (const frame of frames) {
    const btn = await frame.$('button[title="Accept All"]');
    if (btn) { await btn.click(); break; }
  }
} catch (e) {
  try {
    await page.click('[id*="accept"], [class*="accept"]', { timeout: 3000 });
  } catch (e2) {
    // No consent banner — continue
  }
}
await new Promise(r => setTimeout(r, 2000));
```

## Typing Credentials

Use `page.type()` with delay — it generates real keyboard events.

```javascript
await page.type("input[name=username]", "user@example.com", { delay: 70 });
await page.type("input[name=password]", "secret123", { delay: 70 });
```

## Form Submission

Click the submit button — don't call `form.submit()` directly. SPAs attach event handlers to buttons, not forms.

```javascript
await page.click("button[type=submit]");
```

## Waiting for Auth

After submitting login forms, wait for navigation or a specific element:

```javascript
// Wait for URL change (redirects after login)
await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});

// Or wait for a specific element
await page.waitForSelector(".dashboard, .user-profile, .logout-button", { timeout: 15000 });

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
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const puppeteerCore = require("/opt/openclaw/node_modules/puppeteer-core");
const Browserbase = require("/opt/openclaw/node_modules/@browserbasehq/sdk").default;

const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
const session = await bb.sessions.create();
console.log("Session:", session.id);

const browser = await puppeteerCore.connect({
  browserWSEndpoint: session.connectUrl
});

const page = (await browser.pages())[0] || await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

try {
  // 1. Navigate to login page
  await page.goto("https://example.com/login", { waitUntil: "domcontentloaded", timeout: 45000 });
  await new Promise(r => setTimeout(r, 5000));

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
  await page.type("input[name=username]", "user@example.com", { delay: 70 });
  await page.type("input[name=password]", "password123", { delay: 70 });

  // 4. Submit and wait for auth
  await page.click("button[type=submit]");
  await new Promise(r => setTimeout(r, 8000));

  console.log("Logged in:", page.url());

  // 5. Navigate to target page
  await page.goto("https://example.com/dashboard", { waitUntil: "networkidle2", timeout: 45000 });
  await new Promise(r => setTimeout(r, 3000));

  // 6. Extract data
  const content = await page.evaluate(() => document.body.innerText);
  console.log(content);

} finally {
  await page.close();
  await browser.close();
  console.log(`Session replay: https://browserbase.com/sessions/${session.id}`);
}
```

## Running Scripts

Write the script as an `.mjs` file (ES modules) and execute:

```bash
cat > /tmp/scrape.mjs << 'EOF'
import { createRequire } from "module";
const require = createRequire(import.meta.url);
// ... script content
EOF

node /tmp/scrape.mjs
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `BROWSERBASE_API_KEY` not set | Check orchestrator config — the env var is injected automatically |
| Session creation fails | Verify API key is valid at browserbase.com |
| Timeout on page load | Use `domcontentloaded` instead of `networkidle0`; increase timeout to 45s+ |
| Login form submits but nothing happens | Use `page.type()` with `delay: 70`, not `page.evaluate()` to set values |
| Element click intercepted | Cookie consent overlay — dismiss it first (check iframes) |
| "Navigation interrupted" | Page uses hash routing — use `waitForFunction` instead of `waitForNavigation` |
| Slow page interactions | Browserbase has network latency; add `await new Promise(r => setTimeout(r, 3000))` between steps |
| Need to debug visually | Use `bb.sessions.debug(session.id)` to get a live debug URL |

## Cleanup

Always close the browser in a finally block:

```javascript
try {
  // ... automation
} finally {
  await page.close();
  await browser.close();
}
```
