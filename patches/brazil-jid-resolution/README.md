# Brazil WhatsApp JID Resolution Patch

## Problem

Brazilian mobile numbers transitioned from 8 to 9 digits (adding a leading `9`) around 2012-2016. WhatsApp accounts created before the migration may still be registered internally with the **old 8-digit format**, causing silent message delivery failures.

Example:
- User dials: `+5511999998888` (9-digit modern format)
- WhatsApp registration: `5511999998888` OR `551199998888` (8-digit legacy)
- If Clawdbot sends to wrong format → message silently fails

## Solution

This patch uses Baileys' `onWhatsApp()` to query which format is actually registered before sending, then caches the result for 7 days.

## Files

- `brazil-jid-resolver.mjs` - The resolver module (queries variants, caches results)
- `outbound.patched.js` - Modified outbound.js that resolves JID before sending
- `monitor.patched.js` - Modified monitor.js that exposes onWhatsApp on listener
- `apply.sh` - Apply the patch
- `revert.sh` - Revert to original

## What Gets Patched

1. **outbound.js** (main fix)
   - Adds `resolveJidWithBrazil()` function
   - Calls resolver before sending to get correct JID
   - Returns resolved JID in response

2. **monitor.js**
   - Exposes `onWhatsApp` function on the listener object
   - This allows outbound.js to query WhatsApp for JID verification

3. **brazil-jid-resolver.mjs** (new file)
   - Detects Brazilian mobile numbers
   - Generates 8-digit and 9-digit variants
   - Queries WhatsApp to find which is registered
   - Caches results for 7 days

## Quick Apply

```bash
bash ~/clawd/patches/brazil-jid-resolution/apply.sh
```

The script will:
1. Backup original files
2. Install the resolver module
3. Patch outbound.js and monitor.js
4. Verify the patch
5. Restart the gateway

## Quick Revert

```bash
bash ~/clawd/patches/brazil-jid-resolution/revert.sh
clawdbot gateway restart
```

## After Clawdbot Updates

⚠️ **This patch must be reapplied after `npm update clawdbot`**

```bash
bash ~/clawd/patches/brazil-jid-resolution/apply.sh
```

## Cache

Resolved JIDs are cached at: `~/.config/clawdbot/brazil-jid-cache.json`

Cache TTL: 7 days

To clear cache:
```bash
rm ~/.config/clawdbot/brazil-jid-cache.json
```

## Logs

When working correctly, you'll see logs like:
```
[brazil-jid] Resolved 5511999998888 -> 551199998888@s.whatsapp.net
```

In the gateway/whatsapp outbound logs:
```
[brazil-jid] Resolved 5531991382076@s.whatsapp.net -> 553191382076@s.whatsapp.net
```

## Contact Matching Fix

In addition to the JID resolution, the WhatsApp logs workflow also needs to handle 8/9 digit variations when matching contacts:

**Files updated:**
- `~/clawd/workflows/whatsapp/logs-daily/log-inbound.mjs`
- `~/clawd/workflows/whatsapp/logs-daily/log-outbound.mjs`

Both `findContactByPhone()` functions now try 8/9 digit variants when matching contacts.

## Testing

Send a message to a Brazilian number and check:
1. The `toJid` in the response should show the resolved format
2. The cache file should be created/updated
3. The recipient should actually receive the message

```bash
# Check cache
cat ~/.config/clawdbot/brazil-jid-cache.json | jq '.entries | keys'
```

## Upstream

- PR: https://github.com/moltbot/moltbot/pull/4181
- Issue: https://github.com/moltbot/moltbot/issues/4168
