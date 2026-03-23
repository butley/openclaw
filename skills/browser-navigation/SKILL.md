---
name: browser-navigation
description: "Navigate websites, log into accounts, scrape content, and automate web interactions using Browserbase cloud browsers. Use when: user asks to visit a website, log into an account, check information on a web page, fill forms, extract data from sites, or interact with any web UI. NOT for: simple URL fetching where web_fetch suffices, API calls that don't need a browser, or static file downloads via curl."
metadata: { "openclaw": { "emoji": "🌐", "requires": { "bins": ["node"], "node_modules": ["puppeteer-core", "@browserbasehq/sdk"] } } }
---

# Browser Navigation

Automate real browser interactions: login, navigate, extract data, fill forms.

Uses **Browserbase** cloud browsers with **puppeteer-core**. No local Chrome needed — the browser runs on Browserbase's infrastructure with residential IPs that bypass WAFs (Imperva, Cloudflare, DataDome) without any stealth plugins.

## When to Use

✅ **USE this skill when:**

- "Log into my account on [site]"
- "Check my [dashboard/balance/status] on [site]"
- "Go to [URL] and get [information]"
- "Fill out this form on [site]"
- Sites that require JavaScript rendering, authentication, or interaction
- Sites with bot detection (Imperva, Cloudflare, DataDome)
- Sites that block datacenter IPs (banking, government portals)

❌ **DON'T use this skill when:**

- Simple page fetch (use `web_fetch` tool instead)
- Direct API calls (use `curl` or `exec`)
- Downloading files from direct URLs

## Why Browserbase (Not Local Chrome)

Browserbase provides cloud browsers on residential IPs. Key advantages:

- **No local Chrome binary** — smaller container, fewer system deps
- **Residential IPs** — bypasses datacenter IP blocks (banking, government)
- **No stealth plugins needed** — real browser fingerprint, not patched
- **Live debug** — watch the browser in real time via debug URL
- **Session replay** — review any session at `browserbase.com/sessions/<id>`

## Environment Variables

The orchestrator injects these into agent containers:

- `BROWSERBASE_API_KEY` — API key for Browserbase
- `BROWSERBASE_PROJECT_ID` — Project ID for Browserbase

## Reference Sample

See `references/sample-browserbase-navigation.mjs` for a complete working example with session create, connect, navigate, and cleanup.

## Connection Pattern

**Important: ESM compatibility.** Scripts must use `.mjs` extension and `createRequire()` with absolute paths:

```javascript
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const puppeteerCore = require("/opt/openclaw/node_modules/puppeteer-core");
const Browserbase = require("/opt/openclaw/node_modules/@browserbasehq/sdk").default;

// Initialize Browserbase client
const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });

// Create a new browser session
const session = await bb.sessions.create({
  projectId: process.env.BROWSERBASE_PROJECT_ID
});

// Get live debug URL (watch the browser in real time)
const debug = await bb.sessions.debug(session.id);
console.log("Live debug:", debug.debuggerFullscreenUrl);

// Connect via CDP WebSocket
const browser = await puppeteerCore.connect({
  browserWSEndpoint: session.connectUrl
});

const page = (await browser.pages())[0];
// ... use page normally (goto, type, click, evaluate, etc.)
```

**Why `createRequire` + absolute paths?** The packages live in `/opt/openclaw/node_modules/` but scripts run from `/tmp/` or `/root/`. ESM import resolution won't find them without the absolute path.

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

Use `page.type()` with delay — it generates real keyboard events:

```javascript
await page.type("input[name=username]", "user@example.com", { delay: 50 });
await page.type("input[name=password]", "secret123", { delay: 50 });
```

**Why delay matters:** Sites monitor input event timing. Instant input flags automation. 30-80ms delay mimics human typing.

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
await page.waitForSelector(".user-profile, .logout-button, .dashboard", { timeout: 15000 });

// Or wait for URL pattern
await page.waitForFunction(
  () => window.location.href.includes("dashboard"),
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
const session = await bb.sessions.create({
  projectId: process.env.BROWSERBASE_PROJECT_ID
});

const debug = await bb.sessions.debug(session.id);
console.log("Live debug:", debug.debuggerFullscreenUrl);

const browser = await puppeteerCore.connect({
  browserWSEndpoint: session.connectUrl
});

const page = (await browser.pages())[0];

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
  console.log(`Session replay: https://browserbase.com/sessions/${session.id}`);
}
```

## Debugging

Browserbase provides two ways to inspect sessions:

1. **Live debug** — watch the browser in real time:
   ```javascript
   const debug = await bb.sessions.debug(session.id);
   console.log(debug.debuggerFullscreenUrl); // Opens in browser
   ```

2. **Session replay** — review after completion:
   ```
   https://browserbase.com/sessions/<session-id>
   ```

## Running Scripts

Write the script as an `.mjs` file and execute:

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
| `BROWSERBASE_API_KEY` not set | Check orchestrator config — env var must be injected into container |
| Session creation fails | Verify API key and project ID are valid at browserbase.com |
| WebSocket connection refused | Session may have expired — create a new one |
| Login form submits but nothing happens | Use `page.type()` with `delay: 50`, not `page.evaluate()` to set values |
| Timeout on page load | Switch from `networkidle0` to `networkidle2` or `domcontentloaded` |
| Element click intercepted | Cookie consent overlay — dismiss it first (check iframes) |
| "Navigation interrupted" | Page uses hash routing — use `waitForFunction` instead of `waitForNavigation` |
| Session billed unexpectedly | Always close browser in `finally` block to end the session |

## Cleanup

Always close the browser in a finally block to end the Browserbase session:

```javascript
try {
  // ... automation
} finally {
  await browser.close();
  console.log(`Replay: https://browserbase.com/sessions/${session.id}`);
}
```
