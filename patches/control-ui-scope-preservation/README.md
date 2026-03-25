# P23 — Control UI Scope Preservation

**Status:** ⚠️ Active — provisional fix (pre-device-auth)  
**Branch:** `feat/rebase-3.22`  
**Commit:** `60d7b083cf`  
**Author:** Bob (AI agent) with Luke (Lucas Machado)  
**Created:** 2026-03-25 (v3.22 rebase)  
**Upstream risk:** Very low — 1 condition widened in 1 file  

---

## Why This Patch Exists

### The Product Problem

Butley's webchat dashboard is the **primary operator interface**: agent owners
monitor conversations, read tool outputs, intervene in chats, and manage their
agent — all through the dashboard at `work.butley.ai` or `www.butley.ai`.

After upgrading from alpha (v3.13) to v3.22, the dashboard stopped loading
entirely. Thread lists, chat history, session lists — every single query
returned:

```
missing scope: operator.read
```

The dashboard was a blank screen. No data, no threads, nothing. The agent
continued working (WhatsApp inbound/outbound was fine), but the owner had
zero visibility into what their agent was doing.

### What v3.22 Changed

v3.22 introduced **granular scope-based authorization** for all WebSocket
methods. Every WS request now maps to a required scope:

| Scope | Methods |
|---|---|
| `operator.read` | `chat.history`, `sessions.list`, `chat.send` (read path) |
| `operator.write` | `chat.send`, `sessions.update` |
| `operator.admin` | config, system operations |
| `operator.approvals` | elevated command approval |
| `operator.pairing` | device pairing flow |

This is a good security improvement — in multi-tenant scenarios, not every
connected client should have full access.

### How Scopes Work

In v3.22, scopes can come from two sources:

1. **Paired device record** — when a client pairs via QR code or setup code,
   the server stores approved scopes in the device record. On reconnect, scopes
   come from the server, not the client.

2. **Self-declared in connect params** — the client sends
   `scopes: ['operator.admin', 'operator.read', ...]` during the WS handshake.
   This is inherently untrusted unless validated against a device record.

### Why It Broke

The critical function is `handleMissingDeviceIdentity()` in
`src/gateway/server/ws-connection/message-handler.ts`. It contains this logic:

```ts
const preserveInsecureLocalControlUiScopes =
  isControlUi &&
  controlUiAuthPolicy.allowInsecureAuthConfigured &&
  isLocalClient &&
  (authMethod === "token" || authMethod === "password");

if (
  !device &&
  (decision.kind !== "allow" ||
    (!preserveInsecureLocalControlUiScopes && ...))
) {
  clearUnboundScopes();  // ← zeros ALL scopes
}
```

The key conditions for scope preservation were:
- `isControlUi` ✅ — the dashboard identifies as control-ui
- `allowInsecureAuthConfigured` ✅ — we have `allowInsecureAuth: true`
- **`isLocalClient`** ❌ — the dashboard comes via Tailscale funnel or Vercel,
  **not localhost**
- `authMethod === "token"` ✅ — token auth works

The `isLocalClient` check kills it. The dashboard works fine when accessed
from `localhost:18789` but fails when accessed externally via
`bob-mini.tail656a63.ts.net` or `work.butley.ai`.

With `dangerouslyDisableDeviceAuth: true`, `device` is **always null** by
design. There is no paired device record. The gateway was never meant to
require device identity — but v3.22's scope system assumes that device-less
external clients shouldn't have scopes.

---

## The Fix

### Approach: Widen the Preservation Guard

When `dangerouslyDisableDeviceAuth` is true, the entire device auth system is
explicitly bypassed. The fix extends this bypass to scope preservation:

```ts
const preserveInsecureLocalControlUiScopes =
  isControlUi &&
  (controlUiAuthPolicy.dangerouslyDisableDeviceAuth ||   // ← ADDED
    (controlUiAuthPolicy.allowInsecureAuthConfigured &&
      isLocalClient &&
      (authMethod === "token" || authMethod === "password")));
```

**What this does:** When `dangerouslyDisableDeviceAuth` is true and the client
is a control-ui, self-declared scopes are preserved regardless of whether the
client is local or external. The original `allowInsecureAuth + isLocalClient`
path remains unchanged for deployments that use device auth.

### Why This Is Correct (For Now)

`dangerouslyDisableDeviceAuth` already bypasses device identity verification,
device signature checks, and pairing requirements. **Scope clearing for
device-less clients is the same security boundary** — it doesn't make sense to
bypass one half (device identity) but enforce the other (scope verification).
The flag's name says "dangerously" precisely because it trusts clients.

### What This Is NOT

This is not a permanent architecture. It's a provisional fix that:

- **Trusts client-declared scopes** — the frontend declares `operator.admin`
  and the gateway believes it. There's no server-side verification.
- **Has no per-user scope differentiation** — every control-ui connection gets
  whatever scopes it claims. There's no "viewer vs editor vs admin" role
  mapping.
- **Relies on a deprecated config flag** — `dangerouslyDisableDeviceAuth` was
  always meant to be temporary (Issue #49).

---

## Files Changed

| File | Change |
|---|---|
| `src/gateway/server/ws-connection/message-handler.ts` | Widened `preserveInsecureLocalControlUiScopes` condition to include `dangerouslyDisableDeviceAuth` |

**Lines changed:** 1 condition, +5 lines (including comment).

---

## The Real Fix: Device Auth for Butley

### Does Butley Need Device Auth?

**Not in the traditional OpenClaw sense.** OpenClaw's device auth model
(QR code pairing, crypto keypairs, device signatures) was designed for a
single-owner personal assistant: one human, one gateway, one phone scanning a
QR code.

Butley is **multi-tenant SaaS**. Operators authenticate via Better Auth
(email/password, OAuth) through the Next.js frontend. The "device" is just
a browser — there's no persistent pairing relationship.

### What Butley Actually Needs

The right solution is **session-based scope resolution**: when a control-ui
client connects, the gateway should resolve scopes from the authenticated
user's session (via Better Auth JWT → Convex user record → role → scopes)
instead of from device pairing or client self-declaration.

Conceptually:

```
Browser → Better Auth login → JWT → WS connect with JWT
→ Gateway validates JWT against Convex → resolves user role
→ Injects server-side scopes based on role
→ No device auth needed, no client self-declaration trusted
```

This maps to the existing `controlUi.auth.trustedProxy` path in v3.22's
config schema, where an upstream proxy (Next.js API route) authenticates
the user and passes a trusted header to the gateway.

### Scope Mapping (Future)

| Butley Role | OpenClaw Scopes |
|---|---|
| Owner/Admin | `operator.admin` (full access) |
| Operator | `operator.read`, `operator.write`, `operator.approvals` |
| Viewer | `operator.read` |

### Priority

**Low for now.** This patch works correctly for the current deployment
(single-operator, `dangerouslyDisableDeviceAuth`). The real auth work
becomes critical when:

1. Multiple operators access the same installation
2. The dashboard goes live to paying customers
3. `dangerouslyDisableDeviceAuth` needs to be removed (Issue #49)

Until then, this patch keeps the dashboard functional without weakening
security beyond what `dangerouslyDisableDeviceAuth` already allows.

---

## Verify

```bash
# Pattern: dangerouslyDisableDeviceAuth in scope preservation logic
grep -q 'dangerouslyDisableDeviceAuth' src/gateway/server/ws-connection/message-handler.ts \
  && echo "P23: ✅" || echo "P23: ❌"
```

---

## Merge Guide

### On Upstream Update

If upstream modifies `handleMissingDeviceIdentity()` or the
`preserveInsecureLocalControlUiScopes` condition in `message-handler.ts`:

1. Check if upstream added a config path for external scope preservation
2. If yes — this patch can be dropped in favor of upstream config
3. If no — reapply the `dangerouslyDisableDeviceAuth` OR condition

### When to Remove This Patch

Remove when ANY of these is implemented:
- Trusted proxy auth (JWT → server-side scopes)
- Better Auth integration with gateway scope resolution
- Real device auth for Butley dashboard clients
- Upstream provides a `controlUi.scopePolicy: "trust-client"` config option

---

## History

| Date | Event |
|---|---|
| 2026-03-25 | Created as provisional fix during v3.22 deployment. Dashboard was fully broken for external access. Root cause: v3.22 scope system + `dangerouslyDisableDeviceAuth` = scopes cleared for non-local clients. |
