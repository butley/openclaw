# Baileys Protocol Version Pin

## Problem

`fetchLatestBaileysVersion()` fetches the protocol version from the Baileys master branch on GitHub at runtime. This returns a newer version than what `@whiskeysockets/baileys@7.0.0-rc.9` (the version bundled with OpenClaw) actually implements.

The version mismatch causes WhatsApp to send protocol messages that rc.9 cannot handle, resulting in **silent pairing failure** — zero `connection.update` events after scanning the QR code.

## Solution

Pin the protocol version to `[2, 3000, 1027934701]`, which is the version bundled with rc.9, instead of fetching from GitHub.

## Files

- `src/web/session.ts` — replaced `fetchLatestBaileysVersion()` call with hardcoded version array

## Key Grep Pattern

```bash
grep -q '1027934701' src/web/session.ts
```

## Upstream Issues

- openclaw/openclaw#20157
- openclaw/openclaw#24947

## Author

Guilherme Ramos (`guiramos@gmail.com`) — 2026-02-27

## Commit

`9520469` on `dev`

## Notes

This pin must be updated if OpenClaw upgrades Baileys beyond rc.9. When that happens, check the new bundled version and update the array accordingly.
