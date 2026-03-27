"""
Butley agent bootstrap — runs in background alongside the OpenClaw gateway.

Phases:
  1. Credential provisioning (gateway token, frontend device pairing)
  2. QMD memory indexing
  3. Wait for gateway health
  4. Create .bootstrap-done marker
  5. Onboarding injection (if BOOTSTRAP.md exists)
  6. Session registration
  7. System cron provisioning (idempotent, every start)

Phases 1-2 and 7 run on every container start (idempotent).
Phases 3-6 only run on first boot (skipped if .bootstrap-done exists).
"""

import fcntl
import json
import logging
import os
import secrets
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

logging.basicConfig(
    level=logging.DEBUG,
    format="[bootstrap] %(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("bootstrap")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
OPENCLAW_DIR = Path("/root/.openclaw")
DEVICES_DIR = OPENCLAW_DIR / "devices"
CREDS_FILE = OPENCLAW_DIR / "gateway-credentials.json"
PAIRED_FILE = DEVICES_DIR / "paired.json"
PENDING_FILE = DEVICES_DIR / "pending.json"
OPENCLAW_CONFIG = OPENCLAW_DIR / "openclaw.json"
MARKER_FILE = OPENCLAW_DIR / ".bootstrap-done"
LOCK_FILE = OPENCLAW_DIR / ".bootstrap.lock"
WORKSPACE = Path("/root/workspace")
BOOTSTRAP_MD = WORKSPACE / "BOOTSTRAP.md"
SESSIONS_DIR = OPENCLAW_DIR / "agents" / "main" / "sessions"

ALL_OPERATOR_SCOPES = [
    "operator.admin",
    "operator.approvals",
    "operator.pairing",
    "operator.read",
    "operator.write",
]


# ---------------------------------------------------------------------------
# Phase 1: Credential provisioning
# ---------------------------------------------------------------------------
def provision_credentials() -> None:
    """Ensure gateway-credentials.json, paired.json, and pending.json exist."""
    log.info("Phase 1: Credential provisioning — start")
    t0 = time.monotonic()

    log.debug("Ensuring directory exists: %s", DEVICES_DIR)
    DEVICES_DIR.mkdir(parents=True, exist_ok=True)

    if CREDS_FILE.exists():
        log.info("  Found existing credentials: %s", CREDS_FILE)
        creds = json.loads(CREDS_FILE.read_text())
        frontend_device_id = creds["frontendDeviceId"]
        frontend_device_token = creds["frontendDeviceToken"]
        log.info("  Read frontendDeviceId=%s from credentials", frontend_device_id)
    else:
        log.info("  No credentials file at %s — generating new ones", CREDS_FILE)

        env_gw_token = os.environ.get("OPENCLAW_GATEWAY_TOKEN")
        if env_gw_token:
            gateway_token = env_gw_token
            log.info("  Gateway token: from OPENCLAW_GATEWAY_TOKEN env var")
        else:
            gateway_token = secrets.token_hex(16)
            log.info("  Gateway token: generated (secrets.token_hex)")

        env_device_id = os.environ.get("FRONTEND_DEVICE_ID")
        if env_device_id:
            frontend_device_id = env_device_id
            log.info("  Frontend device ID: from FRONTEND_DEVICE_ID env var = %s", frontend_device_id)
        else:
            frontend_device_id = "butley-frontend-device"
            log.info("  Frontend device ID: default = %s", frontend_device_id)

        env_device_token = os.environ.get("FRONTEND_DEVICE_TOKEN")
        if env_device_token:
            frontend_device_token = env_device_token
            log.info("  Frontend device token: from FRONTEND_DEVICE_TOKEN env var")
        else:
            frontend_device_token = secrets.token_hex(16)
            log.info("  Frontend device token: generated (secrets.token_hex)")

        timestamp_ms = int(time.time() * 1000)
        creds = {
            "gatewayToken": gateway_token,
            "frontendDeviceId": frontend_device_id,
            "frontendDeviceToken": frontend_device_token,
            "createdAtMs": timestamp_ms,
        }
        CREDS_FILE.write_text(json.dumps(creds, indent=2) + "\n")
        log.info("  Wrote credentials to %s (createdAtMs=%d)", CREDS_FILE, timestamp_ms)

    # Create or patch paired.json
    if not PAIRED_FILE.exists():
        log.info("  No paired.json at %s — creating with device %s", PAIRED_FILE, frontend_device_id)
        timestamp_ms = int(time.time() * 1000)
        paired = {
            frontend_device_id: {
                "deviceId": frontend_device_id,
                "platform": "web",
                "clientId": "butley-frontend",
                "clientMode": "webchat",
                "role": "operator",
                "roles": ["operator"],
                "scopes": list(ALL_OPERATOR_SCOPES),
                "tokens": {
                    "operator": {
                        "token": frontend_device_token,
                        "role": "operator",
                        "scopes": list(ALL_OPERATOR_SCOPES),
                        "createdAtMs": timestamp_ms,
                    }
                },
                "createdAtMs": timestamp_ms,
                "approvedAtMs": timestamp_ms,
            }
        }
        PAIRED_FILE.write_text(json.dumps(paired, indent=2) + "\n")
        log.info("  Wrote paired.json with scopes: %s", ALL_OPERATOR_SCOPES)
    else:
        log.info("  Found existing paired.json at %s — checking operator.read scope", PAIRED_FILE)
        _patch_operator_read_scope()

    # Create empty pending.json if missing
    if not PENDING_FILE.exists():
        PENDING_FILE.write_text("[]\n")
        log.info("  Created empty pending.json at %s", PENDING_FILE)
    else:
        log.debug("  pending.json already exists at %s", PENDING_FILE)

    elapsed = time.monotonic() - t0
    log.info("Phase 1: Credential provisioning — done (%.2fs)", elapsed)



# ---------------------------------------------------------------------------
# Phase 1b: Gateway config patching
# ---------------------------------------------------------------------------
def patch_gateway_config() -> None:
    """Ensure openclaw.json has required settings for Docker (LAN bind) mode.

    When OPENCLAW_BIND=lan (default in Dockerfile), the gateway binds to 0.0.0.0.
    v2026.3.3+ requires explicit controlUi origin config for non-loopback binds.
    This patches openclaw.json idempotently on every start.
    """
    log.info("Phase 1b: Gateway config patching — start")
    t0 = time.monotonic()

    if OPENCLAW_CONFIG.exists():
        try:
            config = json.loads(OPENCLAW_CONFIG.read_text())
        except (json.JSONDecodeError, OSError):
            log.warning("  Corrupt openclaw.json — recreating")
            config = {}
    else:
        config = {}

    # Ensure nested structure
    gw = config.setdefault("gateway", {})
    cui = gw.setdefault("controlUi", {})

    changed = False
    if not cui.get("dangerouslyAllowHostHeaderOriginFallback"):
        cui["dangerouslyAllowHostHeaderOriginFallback"] = True
        changed = True
        log.info("  Set controlUi.dangerouslyAllowHostHeaderOriginFallback=true")

    if changed:
        OPENCLAW_CONFIG.write_text(json.dumps(config, indent=2) + "\n")
        log.info("  Wrote %s", OPENCLAW_CONFIG)
    else:
        log.debug("  openclaw.json already has required config — no changes")

    elapsed = time.monotonic() - t0
    log.info("Phase 1b: Gateway config patching — done (%.2fs)", elapsed)


def _patch_operator_read_scope() -> None:
    """Add operator.read to paired.json if missing (fixes pre-existing installations)."""
    log.debug("  Reading paired.json for scope patching")
    try:
        raw = PAIRED_FILE.read_text()
        data = json.loads(raw)
    except (json.JSONDecodeError, OSError) as exc:
        log.warning("  Could not read/parse %s: %s", PAIRED_FILE, exc)
        return

    device_count = len(data)
    log.debug("  Found %d device(s) in paired.json", device_count)

    modified = False
    for device_id, device in data.items():
        # Device-level scopes
        scopes = device.get("scopes", [])
        if "operator.read" not in scopes:
            scopes.append("operator.read")
            modified = True
            log.info("  Device %s: added operator.read to device scopes", device_id)
        else:
            log.debug("  Device %s: operator.read already in device scopes", device_id)

        # Token-level scopes
        token = device.get("tokens", {}).get("operator", {})
        token_scopes = token.get("scopes", [])
        if "operator.read" not in token_scopes:
            token_scopes.append("operator.read")
            modified = True
            log.info("  Device %s: added operator.read to token scopes", device_id)
        else:
            log.debug("  Device %s: operator.read already in token scopes", device_id)

    if modified:
        PAIRED_FILE.write_text(json.dumps(data, indent=2) + "\n")
        log.info("  Wrote patched paired.json to %s", PAIRED_FILE)
    else:
        log.info("  All devices already have operator.read — no patch needed")


# ---------------------------------------------------------------------------
# Phase 2: QMD memory indexing
# ---------------------------------------------------------------------------
def index_memory() -> None:
    """Index MEMORY.md and memory/ dir for QMD semantic search."""
    log.info("Phase 2: QMD memory indexing — start")
    t0 = time.monotonic()

    memory_md = WORKSPACE / "MEMORY.md"
    memory_dir = WORKSPACE / "memory"

    found_any = False
    if memory_md.exists():
        log.info("  Found %s — indexing as memory-root", memory_md)
        _run_qmd(["qmd", "collection", "add", "MEMORY.md", "--name", "memory-root"])
        found_any = True
    else:
        log.debug("  %s does not exist — skipping", memory_md)

    if memory_dir.is_dir():
        log.info("  Found %s/ — indexing as memory-dir", memory_dir)
        _run_qmd(["qmd", "collection", "add", "memory/", "--name", "memory-dir"])
        found_any = True
    else:
        log.debug("  %s/ does not exist — skipping", memory_dir)

    if not found_any:
        log.info("  No memory files found yet (will be indexed on first update)")

    elapsed = time.monotonic() - t0
    log.info("Phase 2: QMD memory indexing — done (%.2fs)", elapsed)


def _run_qmd(cmd: list[str]) -> None:
    """Run a qmd command, swallowing errors (non-fatal)."""
    cmd_str = " ".join(cmd)
    log.debug("  Running: %s (cwd=%s, timeout=30s)", cmd_str, WORKSPACE)
    try:
        result = subprocess.run(
            cmd,
            cwd=str(WORKSPACE),
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            log.info("  qmd success (rc=0): %s", cmd_str)
            if result.stdout.strip():
                log.debug("  qmd stdout: %s", result.stdout.strip()[:200])
        else:
            log.warning("  qmd failed (rc=%d): %s", result.returncode, cmd_str)
            if result.stderr.strip():
                log.warning("  qmd stderr: %s", result.stderr.strip()[:500])
            if result.stdout.strip():
                log.debug("  qmd stdout: %s", result.stdout.strip()[:200])
    except subprocess.TimeoutExpired:
        log.warning("  qmd timed out after 30s: %s", cmd_str)
    except Exception as exc:
        log.warning("  qmd error running '%s': %s", cmd_str, exc)


# ---------------------------------------------------------------------------
# Phase 3: Wait for gateway health
# ---------------------------------------------------------------------------
def wait_for_gateway(port: int, timeout: int = 60) -> bool:
    """Poll gateway until it responds to HTTP (any status = ready)."""
    log.info("Phase 3: Waiting for gateway — start (port=%d, timeout=%ds)", port, timeout)
    url = f"http://127.0.0.1:{port}/__openclaw__/canvas/"
    deadline = time.monotonic() + timeout
    attempt = 0

    while time.monotonic() < deadline:
        attempt += 1
        remaining = deadline - time.monotonic()
        try:
            with urlopen(url, timeout=3) as resp:
                log.info("  Gateway ready at %s (status=%d, attempt %d, %.1fs elapsed)", url, resp.status, attempt, timeout - remaining)
                log.info("  Waiting 5s for agent runtime initialization (session store, tools, auth profiles)...")
                time.sleep(5)
                log.info("Phase 3: Waiting for gateway — done")
                return True
        except URLError as exc:
            # HTTP errors (4xx/5xx) from urllib raise URLError wrapping HTTPError.
            # If we get an HTTP error, the server IS up — just no route.
            if hasattr(exc, "code"):
                log.info("  Gateway responding (HTTP %s, attempt %d) — treating as ready", exc.code, attempt)
                log.info("  Waiting 5s for agent runtime initialization...")
                time.sleep(5)
                log.info("Phase 3: Waiting for gateway — done")
                return True
            if attempt <= 5 or attempt % 10 == 0:
                log.debug("  Attempt %d: not ready — %s (%.0fs remaining)", attempt, exc, remaining)
        except OSError as exc:
            if attempt <= 5 or attempt % 10 == 0:
                log.debug("  Attempt %d: not ready — %s (%.0fs remaining)", attempt, exc, remaining)
        time.sleep(1)

    log.error("Phase 3: Gateway not ready after %ds (%d attempts)", timeout, attempt)
    return False


# ---------------------------------------------------------------------------
# Phase 5: Onboarding injection
# ---------------------------------------------------------------------------
def inject_onboarding(port: int, token: str) -> bool:
    """Send onboarding message via gateway /tools/invoke API."""
    log.info("Phase 5: Onboarding injection — start")
    url = f"http://127.0.0.1:{port}/tools/invoke"
    payload = {
        "tool": "sessions_send",
        "args": {
            "sessionKey": "agent:main:main",
            "message": (
                "[System] This is your first session. BOOTSTRAP.md exists in your "
                "workspace. Please follow its instructions and introduce yourself "
                "to the user."
            ),
        },
    }
    body = json.dumps(payload).encode()
    log.info("  POST %s", url)
    log.info("  Tool: sessions_send, sessionKey: agent:main:main")
    log.debug("  Payload: %s", json.dumps(payload, indent=2))

    req = Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )

    for attempt in range(1, 6):
        log.info("  Attempt %d/5...", attempt)
        try:
            with urlopen(req, timeout=15) as resp:
                resp_body = resp.read()
                result = json.loads(resp_body)
                log.info("  Response (status=%d): %s", resp.status, json.dumps(result)[:300])
                if result.get("ok"):
                    log.info("  Onboarding sent successfully on attempt %d", attempt)
                    log.info("Phase 5: Onboarding injection — done")
                    return True
                log.warning("  Response 'ok' field is falsy: %s", result)
        except Exception as exc:
            log.warning("  Attempt %d failed: %s: %s", attempt, type(exc).__name__, exc)
        if attempt < 5:
            log.info("  Retrying in 5s...")
            time.sleep(5)

    log.error("Phase 5: Onboarding injection — FAILED after 5 attempts")
    return False


# ---------------------------------------------------------------------------
# Phase 6: Register session
# ---------------------------------------------------------------------------
def register_session() -> None:
    """Create sessions.json if transcript exists but sessions file doesn't."""
    log.info("Phase 6: Session registration — start")
    transcript_file = SESSIONS_DIR / "main.jsonl"
    sessions_file = SESSIONS_DIR / "sessions.json"

    log.debug("  Checking transcript: %s (exists=%s)", transcript_file, transcript_file.exists())
    log.debug("  Checking sessions:   %s (exists=%s)", sessions_file, sessions_file.exists())

    if not transcript_file.exists():
        log.info("  No transcript file at %s — skipping session registration", transcript_file)
        log.info("Phase 6: Session registration — skipped (no transcript)")
        return
    if sessions_file.exists():
        log.info("  sessions.json already exists at %s — skipping", sessions_file)
        log.info("Phase 6: Session registration — skipped (already registered)")
        return

    log.debug("  Creating directory: %s", SESSIONS_DIR)
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp_ms = int(time.time() * 1000)
    session_id = str(uuid.uuid4())

    sessions = {
        "agent:main:main": {
            "sessionId": session_id,
            "updatedAt": timestamp_ms,
            "chatType": "direct",
            "sessionFile": str(transcript_file),
        }
    }
    sessions_file.write_text(json.dumps(sessions, indent=2) + "\n")
    log.info("  Wrote sessions.json: sessionId=%s, updatedAt=%d", session_id, timestamp_ms)
    log.info("  Session file path: %s", sessions_file)
    log.info("Phase 6: Session registration — done")


# ---------------------------------------------------------------------------
# Phase 7: System cron provisioning
# ---------------------------------------------------------------------------

SYSTEM_CRONS = [
    {
        "name": "system-context-harvester",
        "schedule": {"kind": "every", "everyMs": 1800000},
        "sessionTarget": "isolated",
        "payload": {
            "kind": "agentTurn",
            "message": (
                "Run the context harvester script: "
                "cd /root/workspace/tools/context-harvester && bash run.sh. "
                "Report a brief summary of what changed (sessions scanned, "
                "messages collected, topics added/removed). If it fails, report the error."
            ),
            "model": "haiku",
            "timeoutSeconds": 300,
        },
        "delivery": {"mode": "none"},
        "enabled": True,
    },
]


def provision_system_crons() -> None:
    """Ensure system-* cron jobs exist via ``openclaw cron`` CLI (idempotent).

    Lists existing cron jobs, skips any that already exist (matched by name),
    and creates missing ones using ``openclaw cron add``.
    """
    log.info("Phase 7: System cron provisioning — start")
    t0 = time.monotonic()

    # Check if context-harvester tool exists
    harvester_path = WORKSPACE / "tools" / "context-harvester" / "run.sh"
    if not harvester_path.exists():
        log.info("  Context harvester not installed at %s — skipping cron provisioning", harvester_path)
        elapsed = time.monotonic() - t0
        log.info("Phase 7: System cron provisioning — skipped (%.2fs)", elapsed)
        return

    # List existing cron jobs via CLI (--json for machine-readable output)
    existing_names: set[str] = set()
    try:
        result = subprocess.run(
            ["openclaw", "cron", "list", "--json"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            data = json.loads(result.stdout)
            jobs = data if isinstance(data, list) else data.get("jobs", [])
            existing_names = {j.get("name", "") for j in jobs}
            log.info("  Found %d existing cron job(s): %s", len(jobs), existing_names or "(none)")
        else:
            log.warning("  cron list returned rc=%d — stderr: %s", result.returncode, result.stderr.strip()[:200])
    except json.JSONDecodeError:
        log.warning("  cron list output not valid JSON — will attempt creation anyway")
    except Exception as exc:
        log.warning("  Could not list cron jobs: %s — will attempt creation anyway", exc)

    # Create missing system crons using CLI flags
    created = 0
    skipped = 0
    for cron_def in SYSTEM_CRONS:
        name = cron_def["name"]
        if name in existing_names:
            log.info("  Cron '%s' already exists — skipping", name)
            skipped += 1
            continue

        log.info("  Creating cron '%s'...", name)
        try:
            cmd = ["openclaw", "cron", "add", "--name", name]

            # Schedule
            schedule = cron_def["schedule"]
            if schedule["kind"] == "every":
                every_ms = schedule["everyMs"]
                # Convert ms to human duration for CLI
                if every_ms >= 3600000:
                    cmd += ["--every", f"{every_ms // 3600000}h"]
                elif every_ms >= 60000:
                    cmd += ["--every", f"{every_ms // 60000}m"]
                else:
                    cmd += ["--every", f"{every_ms // 1000}s"]
            elif schedule["kind"] == "cron":
                cmd += ["--cron", schedule["expr"]]
                if schedule.get("tz"):
                    cmd += ["--tz", schedule["tz"]]

            # Payload
            payload = cron_def["payload"]
            if payload["kind"] == "agentTurn":
                cmd += ["--message", payload["message"]]
                cmd += ["--session", cron_def.get("sessionTarget", "isolated")]
                if payload.get("model"):
                    cmd += ["--model", payload["model"]]
                if payload.get("timeoutSeconds"):
                    cmd += ["--timeout-seconds", str(payload["timeoutSeconds"])]

            # Delivery
            delivery = cron_def.get("delivery", {})
            if delivery.get("mode") == "none":
                cmd += ["--no-deliver"]

            cmd += ["--json"]

            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=30,
            )
            if result.returncode == 0:
                log.info("  Created cron '%s': %s", name, result.stdout.strip()[:200])
                created += 1
            else:
                log.warning("  Failed to create cron '%s' (rc=%d): %s %s",
                            name, result.returncode,
                            result.stderr.strip()[:200],
                            result.stdout.strip()[:200])
        except Exception as exc:
            log.warning("  Failed to create cron '%s': %s", name, exc)

    elapsed = time.monotonic() - t0
    log.info("Phase 7: System cron provisioning — done (created=%d, skipped=%d, %.2fs)", created, skipped, elapsed)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def wait_for_gateway_quick(port: int, timeout: int = 30) -> bool:
    """Quick gateway readiness check (shorter timeout for restart scenarios)."""
    log.debug("Quick gateway check (port=%d, timeout=%ds)", port, timeout)
    url = f"http://127.0.0.1:{port}/__openclaw__/canvas/"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urlopen(url, timeout=3) as resp:
                log.debug("Gateway ready (status=%d)", resp.status)
                return True
        except URLError as exc:
            if hasattr(exc, "code"):
                return True
        except OSError:
            pass
        time.sleep(1)
    return False


def load_gateway_token() -> str:
    """Read gateway token from credentials file."""
    log.debug("Reading gateway token from %s", CREDS_FILE)
    creds = json.loads(CREDS_FILE.read_text())
    log.debug("Gateway token loaded (length=%d)", len(creds["gatewayToken"]))
    return creds["gatewayToken"]


def acquire_lock() -> "open":
    """Acquire exclusive file lock — exits if another instance is running."""
    log.debug("Acquiring bootstrap lock: %s", LOCK_FILE)
    OPENCLAW_DIR.mkdir(parents=True, exist_ok=True)
    lock_fh = open(LOCK_FILE, "w")  # noqa: SIM115
    try:
        fcntl.flock(lock_fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log.info("Another bootstrap instance holds %s — exiting", LOCK_FILE)
        sys.exit(0)
    log.info("Lock acquired: %s (pid=%d)", LOCK_FILE, os.getpid())
    return lock_fh


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    log.info("=" * 60)
    log.info("Bootstrap starting (pid=%d)", os.getpid())
    log.info("=" * 60)

    # Log environment snapshot for debugging
    log.info("Environment:")
    log.info("  OPENCLAW_PORT=%s", os.environ.get("OPENCLAW_PORT", "(unset, default 18789)"))
    log.info("  OPENCLAW_BIND=%s", os.environ.get("OPENCLAW_BIND", "(unset, default lan)"))
    log.info("  XDG_CACHE_HOME=%s", os.environ.get("XDG_CACHE_HOME", "(unset)"))
    log.info("  HOME=%s", os.environ.get("HOME", "(unset)"))

    # Log file existence state
    log.info("File state:")
    log.info("  credentials:     %s (exists=%s)", CREDS_FILE, CREDS_FILE.exists())
    log.info("  paired.json:     %s (exists=%s)", PAIRED_FILE, PAIRED_FILE.exists())
    log.info("  pending.json:    %s (exists=%s)", PENDING_FILE, PENDING_FILE.exists())
    log.info("  .bootstrap-done: %s (exists=%s)", MARKER_FILE, MARKER_FILE.exists())
    log.info("  BOOTSTRAP.md:    %s (exists=%s)", BOOTSTRAP_MD, BOOTSTRAP_MD.exists())

    _lock_fh = acquire_lock()  # must stay open to hold the lock
    t0 = time.monotonic()

    try:
        # Phases 1-2 run on EVERY start (idempotent, ensures config is patched)
        provision_credentials()
        patch_gateway_config()
        index_memory()

        # Phases 3-6 only run on first boot (skipped if marker exists)
        if MARKER_FILE.exists():
            log.info(".bootstrap-done exists — skipping phases 3-6 (gateway wait + onboarding)")
        else:
            port = int(os.environ.get("OPENCLAW_PORT", "18789"))
            log.info("First boot detected — running phases 3-6 (port=%d)", port)

            if not wait_for_gateway(port):
                log.error("Gateway never became ready — creating marker anyway to unblock frontend")

            # Phase 4: marker
            MARKER_FILE.touch()
            log.info("Phase 4: Created .bootstrap-done marker at %s", MARKER_FILE)

            if BOOTSTRAP_MD.exists():
                log.info("BOOTSTRAP.md exists — proceeding with onboarding injection")
                token = load_gateway_token()
                if inject_onboarding(port, token):
                    register_session()
                else:
                    log.warning("Onboarding injection failed — agent will not auto-introduce")
                    log.warning("User can still interact manually via the chat UI")
            else:
                log.info("No BOOTSTRAP.md at %s — skipping onboarding (agent already initialized or manual setup)", BOOTSTRAP_MD)

        # Phase 7: System cron provisioning (runs every start, needs gateway)
        port = int(os.environ.get("OPENCLAW_PORT", "18789"))
        if wait_for_gateway_quick(port):
            provision_system_crons()
        else:
            log.warning("Gateway not ready — skipping system cron provisioning")

    except Exception:
        log.exception("Bootstrap failed with unexpected error")
        # Still create marker — don't block frontend forever
        if not MARKER_FILE.exists():
            MARKER_FILE.touch()
            log.info("Created .bootstrap-done marker at %s (after error — frontend unblocked)", MARKER_FILE)

    elapsed = time.monotonic() - t0
    log.info("=" * 60)
    log.info("Bootstrap completed in %.1fs (pid=%d)", elapsed, os.getpid())
    log.info("=" * 60)


if __name__ == "__main__":
    main()
