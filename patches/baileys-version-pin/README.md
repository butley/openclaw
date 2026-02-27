# Baileys Protocol Version Pin

## Problem

`fetchLatestBaileysVersion()` fetches the protocol version from the Baileys master branch on GitHub at runtime. This returns a newer version than what `@whiskeysockets/baileys@7.0.0-rc.9` (the version bundled with OpenClaw) actually implements.

The version mismatch causes WhatsApp to send protocol messages that rc.9 cannot handle, resulting in **silent pairing failure** — zero `connection.update` events after scanning the QR code.

## Solution

Pin to a hardcoded version array instead of fetching from GitHub.

## Files

- `src/web/session.ts` — replaced `fetchLatestBaileysVersion()` call with hardcoded version array

## Key Grep Pattern

```bash
grep -qE '\[2, 3000, [0-9]+\]' src/web/session.ts
```

## Upstream Issues

- openclaw/openclaw#20157
- openclaw/openclaw#24947

## Author

Guilherme Ramos (`guiramos@gmail.com`) — 2026-02-27

## Commit

`9520469` on `dev`

## Version History

| Date | Version | Notes |
|------|---------|-------|
| 2026-02-27 | `1027934701` | Original pin (rc.9 bundled). Broke same day — WhatsApp bumped minimum. |
| 2026-02-27 | `1033846690` | Updated after 405 "Method Not Allowed" (location: "frc") on connect. |

## ⚠️ KNOWN MAINTENANCE BURDEN

WhatsApp periodically bumps the minimum protocol version. When pinned, this causes **silent connection failure** (405, zero events after QR/reconnect).

**Symptoms:** `channel exited` with `statusCode: 405`, `location: "frc"`.

**Fix:** Fetch current version from https://raw.githubusercontent.com/WhiskeySockets/Baileys/refs/heads/master/src/Defaults/baileys-version.json and update the array in `src/web/session.ts`.

**Long-term:** Consider reverting to dynamic `fetchLatestBaileysVersion()` if Baileys rc.9 compatibility is confirmed with newer protocol versions.
