// [FORK-PATCH-10] Logs Pretty Formatter — `openclaw logs --pretty` with icons, phone aliases, UUID compaction. Entire file is fork-only. See patches/README.md #10.
/**
 * Rich log formatter for `openclaw logs --pretty`.
 * Ported from oc-logs.py — categories, icons, phone aliases, UUID compaction,
 * message body extraction, time-gap separators, terminal-aware wrapping.
 */

import { parseLogLine } from "../logging/parse-log-line.js";

// ─── ANSI helpers ───────────────────────────────────────────────
const RST = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

function fg256(n: number, bold = false): string {
  return bold ? `\x1b[38;5;${n};1m` : `\x1b[38;5;${n}m`;
}

// ─── Level styles ───────────────────────────────────────────────
const LEVEL_STYLES: Record<string, { color: string; badge: string }> = {
  debug: { color: fg256(243), badge: "dbg" },
  trace: { color: fg256(243), badge: "trc" },
  info: { color: fg256(252), badge: "inf" },
  warn: { color: fg256(214, true), badge: "WRN" },
  error: { color: fg256(196, true), badge: "ERR" },
  fatal: { color: fg256(196, true), badge: "FTL" },
};

// ─── Category detection ─────────────────────────────────────────
type Category = {
  keywords: string[];
  headerColor: string;
  icon: string;
  contentColor: string;
};

const CATEGORIES: Category[] = [
  // WhatsApp inbound
  {
    keywords: ["whatsapp/inbound", "web-inbound"],
    headerColor: fg256(115),
    icon: "←",
    contentColor: fg256(115),
  },
  // WhatsApp outbound
  {
    keywords: ["whatsapp/outbound", "web-auto-reply"],
    headerColor: fg256(75),
    icon: "→",
    contentColor: fg256(75),
  },
  // WhatsApp general
  {
    keywords: ["whatsapp", "brazil-jid"],
    headerColor: fg256(115),
    icon: "◆",
    contentColor: fg256(115),
  },
  // Agent
  {
    keywords: ["agent", "embedded"],
    headerColor: fg256(183),
    icon: "▸",
    contentColor: fg256(140),
  },
  // Cron
  {
    keywords: ["cron"],
    headerColor: fg256(222),
    icon: "⏱",
    contentColor: fg256(180),
  },
  // Memory / QMD
  {
    keywords: ["memory", "qmd"],
    headerColor: fg256(212),
    icon: "◈",
    contentColor: fg256(175),
  },
  // WebSocket
  {
    keywords: ["ws", "websocket", "web-heartbeat"],
    headerColor: fg256(244),
    icon: "~",
    contentColor: fg256(243),
  },
  // Diagnostic
  {
    keywords: ["diagnostic"],
    headerColor: fg256(241),
    icon: "·",
    contentColor: fg256(240),
  },
  // Config
  {
    keywords: ["config"],
    headerColor: fg256(252),
    icon: "⚙",
    contentColor: fg256(248),
  },
];

const DEFAULT_CAT = { headerColor: fg256(248), icon: "•", contentColor: fg256(245) };

// ─── Known aliases ──────────────────────────────────────────────
const PHONE_ALIASES: Record<string, string> = {
  "+553196348700": "Luke",
  "+551151942900": "Bob",
};

const CRON_NAMES: Record<string, string> = {
  "2f867f09": "Scribe",
  "479ae2ac": "Curator",
  c2163640: "Architect",
  "36373c6b": "Digest",
};

const C_TIME = fg256(240);
const C_BODY = fg256(252);
const C_SEP = fg256(236);

// ─── Tool / Run formatting ───────────────────────────────────────
const C_TOOL_NAME = fg256(183, true); // bold lavender
const C_TOOL_META = fg256(248); // dim grey
const C_TOOL_PHASE = fg256(243); // dim for phase arrows

const TOOL_EMOJI: Record<string, string> = {
  exec: "⚙",
  process: "🧰",
  read: "📖",
  write: "✏",
  edit: "📝",
  apply_patch: "🩹",
  attach: "📎",
  browser: "🌐",
  canvas: "🖼️",
  web_search: "🔍",
  web_fetch: "🌐",
  image: "🖼️",
  message: "💬",
  tts: "🔊",
  cron: "⏱",
  gateway: "⚙",
  memory_search: "🧠",
  memory_get: "🧠",
  nodes: "📡",
  sessions_spawn: "🚀",
  sessions_send: "📨",
  sessions_list: "📋",
  sessions_history: "📜",
  session_status: "📊",
  subagents: "🤖",
  whatsapp_login: "📱",
  agents_list: "👥",
};

const MODEL_SHORT: Record<string, string> = {
  "claude-opus-4-6": "opus-4.6",
  "claude-opus-4-5": "opus-4.5",
  "claude-sonnet-4-6": "sonnet-4.6",
  "claude-sonnet-4-5": "sonnet-4.5",
  "claude-haiku-4-5": "haiku-4.5",
};

// State for run/tool tracking
const _runInfo = new Map<string, { model: string }>();
const _toolStartTime = new Map<string, string>();
const TOOL_MERGE_THRESHOLD_S = 2.0;

function parseRunKv(rest: string): Record<string, string> {
  const kv: Record<string, string> = {};
  for (const m of rest.matchAll(/(\w+)=(\S+)/g)) {
    kv[m[1]] = m[2];
  }
  return kv;
}

/** Format `embedded run *` lifecycle lines. Returns null if not a run line, '' to suppress. */
function formatRunLine(msg: string): string | null {
  const m = msg.match(
    /^embedded run (start|prompt start|agent start|agent end|prompt end|done): runId=(\S+)(.*)/,
  );
  if (!m) {
    return null;
  }
  const [, phase, runId, rest] = m;
  const kv = parseRunKv(rest);

  if (phase === "start") {
    const model = MODEL_SHORT[kv.model ?? ""] ?? kv.model ?? "";
    const thinking = kv.thinking ?? "";
    const channel = kv.messageChannel ?? "";
    _runInfo.set(runId, { model });
    const parts = [`${C_TOOL_PHASE}▶${RST} 🤖 ${C_TOOL_NAME}${model}${RST}`];
    if (thinking) {
      parts.push(`${C_TOOL_META}thinking=${thinking}${RST}`);
    }
    if (channel) {
      parts.push(`${C_TOOL_META}(${channel})${RST}`);
    }
    return parts.join(" ");
  }
  if (phase === "prompt start") {
    return "";
  }
  if (phase === "agent start") {
    const info = _runInfo.get(runId);
    const model = info?.model ?? "";
    const modelPart = model ? ` ${C_TOOL_NAME}${model}${RST}` : "";
    return ` ${C_TOOL_META}📡 calling API…${RST}${modelPart}`;
  }
  if (phase === "agent end") {
    const isError = kv.isError === "true";
    if (isError) {
      return ` \x1b[1;31m📡 API error${RST}`;
    }
    return "";
  }
  if (phase === "prompt end") {
    const info = _runInfo.get(runId);
    _runInfo.delete(runId);
    const model = info?.model ?? "";
    const ms = kv.durationMs ? parseFloat(kv.durationMs) : null;
    const durStr = ms !== null ? ` ${C_TOOL_META}${(ms / 1000).toFixed(1)}s${RST}` : "";
    const modelPart = model ? ` ${C_TOOL_NAME}${model}${RST}` : "";
    return `${C_TOOL_PHASE}■${RST} 🤖${modelPart} done${durStr}`;
  }
  if (phase === "done") {
    return "";
  }
  return null;
}

/**
 * Format exec/write/edit meta: strip heredoc content lines, show compact summary.
 *
 * Raw meta looks like:
 *   "create folder ~/x → show > → run import → run import → run ..."
 *   "search \"foo\" in src/ -> show first 10 lines"
 *
 * Strategy:
 *   1. Split on " → run " — first chunk is the command, rest are content lines.
 *   2. If content lines present, replace with "[+N lines]".
 *   3. Strip " → show >" heredoc marker.
 *   4. Truncate to MAX_META_CHARS.
 */
const MAX_META_CHARS = 90;

function formatToolMeta(toolName: string, raw: string): string {
  // Take only the first real line (meta may span newlines in rare cases)
  let meta = raw
    .replace(/\n[\s\S]*/s, "")
    .trim()
    .replace(/`$/, "")
    .trim();

  // Split off heredoc content lines ("→ run <code>")
  const runParts = meta.split(/ → run /);
  const command = runParts[0].trim();
  const contentLineCount = runParts.length - 1;

  // Also count content from "-> run" (arrow variants)
  const altRunCount = (command.match(/ -> run /g) ?? []).length;
  const totalLines = contentLineCount + altRunCount;

  // Strip heredoc show marker "→ show >" and "-> show >"
  let cmd = command
    .replace(/ [→\->]+ show >.*$/, "")
    .replace(/ -> show.*$/, "")
    .trim();

  // For write/edit, strip trailing heredoc echoes
  if (toolName === "write" || toolName === "edit") {
    cmd = cmd.replace(/\s+EOF\s*$/, "").trim();
  }

  // Truncate long commands
  if (cmd.length > MAX_META_CHARS) {
    cmd = cmd.slice(0, MAX_META_CHARS - 1) + "…";
  }

  if (totalLines > 0) {
    return `${cmd} ${DIM}[+${totalLines} lines]${RST}`;
  }
  return cmd;
}

/** Format `embedded run tool start/end` lines. Returns null if not a tool line, '' to suppress. */
function formatToolLine(msg: string, timeStr: string): string | null {
  const m = msg.match(
    /^embedded run tool (start|end): runId=\S+ tool=(\S+) toolCallId=(\S+)(?:\s+meta=(.+))?/s,
  );
  if (!m) {
    return null;
  }
  const [, phase, toolName, toolCallId, metaRaw] = m;

  // Format meta with tool-aware cleanup
  const rawMeta = (metaRaw ?? "").trim();
  const meta = rawMeta ? formatToolMeta(toolName, rawMeta) : "";

  const emoji = TOOL_EMOJI[toolName] ?? "🧩";
  const metaPart = meta ? ` ${C_TOOL_META}${meta}${RST}` : "";
  const core = `${emoji} ${C_TOOL_NAME}${toolName}${RST}${metaPart}`;

  if (phase === "start") {
    _toolStartTime.set(toolCallId, timeStr);
    return `${C_TOOL_PHASE}→${RST} ${core}`;
  }
  // end
  const startTime = _toolStartTime.get(toolCallId);
  _toolStartTime.delete(toolCallId);
  let dur: number | null = null;
  if (startTime && timeStr) {
    try {
      const toS = (t: string) =>
        parseInt(t.slice(0, 2)) * 3600 + parseInt(t.slice(3, 5)) * 60 + parseInt(t.slice(6, 8));
      dur = toS(timeStr) - toS(startTime);
    } catch {
      /* ignore */
    }
  }
  if (dur !== null && dur < TOOL_MERGE_THRESHOLD_S) {
    return "";
  }
  const durStr = dur !== null ? ` ${C_TOOL_META}(${dur.toFixed(1)}s)${RST}` : "";
  return `${C_TOOL_PHASE}✓${RST} ${core}${durStr}`;
}

// ─── Utilities ──────────────────────────────────────────────────

function getTermWidth(): number {
  return process.stdout.columns || 120;
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function phoneAlias(text: string): string {
  for (const [phone, alias] of Object.entries(PHONE_ALIASES)) {
    text = text.replaceAll(phone, alias);
  }
  return text;
}

function compactIds(msg: string): string {
  // Replace known cron IDs with names
  for (const [shortId, name] of Object.entries(CRON_NAMES)) {
    msg = msg.replace(new RegExp(`${shortId}[0-9a-f-]*`, "g"), `${shortId}…(${name})`);
  }
  // Compact UUIDs
  msg = msg.replace(/([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "$1…");
  return msg;
}

function categorize(
  subsystem: string,
  msg: string,
): { headerColor: string; icon: string; contentColor: string } {
  const text = `${subsystem} ${msg}`.toLowerCase();
  for (const cat of CATEGORIES) {
    for (const kw of cat.keywords) {
      if (text.includes(kw)) {
        return { headerColor: cat.headerColor, icon: cat.icon, contentColor: cat.contentColor };
      }
    }
  }
  return DEFAULT_CAT;
}

function formatTimeBRT(ts: string): string {
  if (!ts) {
    return "??:??:??";
  }
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) {
      return ts.slice(11, 19) || ts;
    }
    // Convert to BRT (UTC-3)
    const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
    const h = String(brt.getUTCHours()).padStart(2, "0");
    const m = String(brt.getUTCMinutes()).padStart(2, "0");
    const s = String(brt.getUTCSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  } catch {
    return ts.slice(11, 19) || ts;
  }
}

function stripSubsystemPrefix(msg: string): string {
  msg = msg.replace(/^\{"subsystem":"[^"]*"\}\s*/, "");
  msg = msg.replace(/^\{"module":"[^"]*"(?:,"runId":"[^"]*")?\}\s*/, "");
  // Handle module meta with extra fields (e.g. cron's storePath)
  msg = msg.replace(/^\{[^{}]*"module":"[^"]*"[^{}]*\}\s*(?=\{)/, "");
  msg = msg.replace(/^\[(?:WARN|INFO|ERROR|DEBUG)\]\s*/, "");
  return msg;
}

function wrapText(text: string, indent: number, color: string): string {
  const termWidth = getTermWidth();
  const visible = stripAnsi(text);
  const maxWidth = Math.max(40, termWidth - indent);
  if (visible.length <= maxWidth) {
    return text;
  }

  // Simple word wrap on visible text
  const words = visible.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length + 1 > maxWidth && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) {
    lines.push(current);
  }

  const pad = " ".repeat(indent);
  return lines
    .map((line, i) => (i === 0 ? `${color}${line}${RST}` : `${pad}${color}${line}${RST}`))
    .join("\n");
}

function tryParseJson(s: string): Record<string, unknown> | null {
  const trimmed = s.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // msg may have trailing text after the JSON blob (e.g. "{ ... } auto-reply sent (text)")
    // Try to extract just the JSON object portion by finding the last closing brace
    const lastBrace = trimmed.lastIndexOf("}");
    if (lastBrace > 0) {
      try {
        return JSON.parse(trimmed.slice(0, lastBrace + 1)) as Record<string, unknown>;
      } catch {
        // fall through
      }
    }
    return null;
  }
}

function formatMessageBody(msg: string, hcolor: string, ccolor: string, indent: number): string {
  const obj = tryParseJson(msg);
  if (!obj) {
    return phoneAlias(compactIds(msg));
  }

  const stringify = (v: unknown): string => {
    if (v == null) {
      return "";
    }
    if (typeof v === "object") {
      return JSON.stringify(v);
    }
    if (typeof v === "string") {
      return v;
    }
    return `${v as number | boolean}`;
  };
  const body = stringify(obj.body ?? obj.text ?? "");
  const from = phoneAlias(stringify(obj.from));
  const to = phoneAlias(stringify(obj.to));
  const mediaKind = stringify(obj.mediaKind ?? obj.mediaType);
  const duration = obj.durationMs ? `(${stringify(obj.durationMs)}ms)` : "";

  const headerParts: string[] = [];
  if (from && to) {
    headerParts.push(`${from} → ${to}`);
  } else if (from) {
    headerParts.push(`from ${from}`);
  }
  if (mediaKind) {
    headerParts.push(`[${mediaKind}]`);
  }
  if (duration) {
    headerParts.push(duration);
  }

  const header = headerParts.join(" ");

  if (!body) {
    // Show remaining fields
    const skip = new Set([
      "from",
      "to",
      "body",
      "text",
      "mediaUrl",
      "mediaSizeBytes",
      "mediaKind",
      "mediaType",
      "durationMs",
      "connectionId",
      "correlationId",
      "mediaPath",
    ]);
    const extra = Object.entries(obj)
      .filter(([k, v]) => !skip.has(k) && v != null)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(" ");
    return `${hcolor}${header}${extra ? ` ${extra}` : ""}${RST}`;
  }

  const bodyText = phoneAlias(String(body));
  const termWidth = getTermWidth();
  const maxBodyWidth = Math.min(90, Math.max(40, termWidth - indent - 2));

  // Word wrap body
  const words = bodyText.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length + 1 > maxBodyWidth && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) {
    lines.push(current);
  }

  const pad = " ".repeat(indent);
  const bodyLines = lines.map((l) => `${pad}${C_BODY}${l}${RST}`).join("\n");

  return `${hcolor}${header}${RST}\n\n${bodyLines}\n`;
}

function formatJsonBlob(msg: string, ccolor: string): string {
  const obj = tryParseJson(msg);
  if (!obj) {
    return phoneAlias(compactIds(msg));
  }
  // Convert epoch-ms timestamps to human-readable BRT
  for (const key of ["nextAt", "lastMessageAt", "lastAt"]) {
    const val = obj[key];
    if (typeof val === "number" && val > 1e12) {
      try {
        obj[key] = new Date(val).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });
      } catch {
        /* ignore */
      }
    }
  }

  const skip = new Set(["connectionId", "correlationId", "mediaPath", "mediaSizeBytes"]);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (skip.has(k) || v == null) {
      continue;
    }
    let sv = typeof v === "object" ? JSON.stringify(v) : String(v as string | number | boolean);
    // Convert epoch-ms timestamps
    if (typeof v === "number" && v > 1e12) {
      try {
        const dt = new Date(v);
        sv = formatTimeBRT(dt.toISOString());
      } catch {
        /* keep original */
      }
    }
    sv = phoneAlias(sv);
    parts.push(`${DIM}${k}=${RST}${ccolor}${sv}${RST}`);
  }
  return parts.join(" ");
}

// ─── Main entry point ───────────────────────────────────────────

export interface PrettyFormatOptions {
  localTime?: boolean;
}

let prevTimeStr = "";

/** Format session-memory hook lines (action=new, context resolved, reset fallback, etc.) */
function formatSessionLine(msg: string): string | null {
  // Pattern: {json} trailing description
  const m = msg.match(/^(\{.*?\})\s+(.+)$/s);
  if (!m) {
    return null;
  }
  const obj = tryParseJson(m[1]);
  if (!obj) {
    return null;
  }
  const desc = m[2].trim();

  // "Hook triggered for reset/new command"
  if (desc.includes("Hook triggered") && typeof obj.action === "string") {
    const icon = obj.action === "new" ? "🔄" : "♻️";
    return `${icon} ${C_TOOL_NAME}session ${obj.action}${RST}`;
  }

  // "Session context resolved" — sessionId + hasCfg
  if (desc.includes("Session context resolved") && typeof obj.sessionId === "string") {
    const shortId = obj.sessionId.slice(0, 8);
    const cfg = obj.hasCfg ? "✓" : "✗";
    return `${C_TOOL_META}session ${shortId}… cfg=${cfg}${RST}`;
  }

  // "Loaded session content from reset fallback"
  if (desc.includes("reset fallback") && typeof obj.latestResetPath === "string") {
    const resetFile = obj.latestResetPath.split("/").pop() ?? "";
    const tsMatch = resetFile.match(/\.reset\.(.+)$/);
    const ts = tsMatch ? tsMatch[1] : resetFile;
    return `${C_TOOL_META}↩ reset fallback${RST} ${DIM}${ts}${RST}`;
  }

  // "Session content loaded"
  if (desc.includes("Session content loaded") && typeof obj.length === "number") {
    return `${C_TOOL_META}session content ${obj.length} chars${RST}`;
  }

  // "Memory file path resolved"
  if (desc.includes("Memory file path") && typeof obj.path === "string") {
    const shortPath = obj.path.replace(/.*\/memory\//, "memory/");
    return `${C_TOOL_META}→ ${shortPath}${RST}`;
  }

  // "Generated slug" / "Using fallback timestamp slug"
  if (desc.includes("slug") && typeof obj.slug === "string") {
    return `${C_TOOL_META}slug: ${obj.slug}${RST}`;
  }

  // "Calling generateSlugViaLLM..."
  if (desc.includes("generateSlugViaLLM")) {
    return `${C_TOOL_META}generating slug…${RST}`;
  }

  return null;
}

/** Format cron log lines: extracts trailing tag + timestamps. */
function formatCronLine(msg: string, hcolor: string): string | null {
  // Match: {json blob} trailing-tag (e.g. "cron: timer armed", "cron-reaper: ...")
  const m = msg.match(/^(\{.*?\})\s+((?:cron|cron-reaper)[\s:].+)$/s);
  if (!m) {
    return null;
  }
  const obj = tryParseJson(m[1]);
  if (!obj) {
    return null;
  }

  // Normalize tag: strip "cron: " / "cron-reaper: " prefix
  const tag = m[2].replace(/^cron(?:-reaper)?:\s*/, "").trim();
  const parts: string[] = [`${hcolor}CRON${RST}`];

  if (tag) {
    parts.push(`${C_TOOL_META}${tag}${RST}`);
  }

  // Job name if present (e.g. job failed lines)
  const jobName = obj["jobName"];
  if (typeof jobName === "string" && jobName) {
    parts.push(`${C_TOOL_NAME}${jobName}${RST}`);
  }

  // nextAt (timer armed) or nextWakeAtMs (cron: started)
  const tsField = (obj["nextAt"] ?? obj["nextWakeAtMs"]) as number | undefined;
  if (typeof tsField === "number" && tsField > 1e12) {
    try {
      const time = new Date(tsField).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });
      parts.push(`${hcolor}→ ${time}${RST}`);
    } catch {
      /* ignore */
    }
  }

  // Compute real time-until-fire from nextAt, not the internal delayMs (polling interval)
  if (typeof tsField === "number" && tsField > 1e12) {
    const diffMs = tsField - Date.now();
    if (diffMs > 0) {
      const secs = diffMs / 1000;
      const label = secs < 90 ? `${Math.round(secs)}s` : `${Math.round(secs / 60)}m`;
      parts.push(`${C_TOOL_META}(in ${label})${RST}`);
    }
  }

  // Job count for "cron: started"
  const jobs = obj["jobs"];
  if (typeof jobs === "number") {
    parts.push(`${C_TOOL_META}${jobs} jobs${RST}`);
  }

  return parts.join(" ");
}
export function resetPrettyState(): void {
  prevTimeStr = "";
}

export function formatPrettyHeader(): string {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const dateStr = brt.toISOString().slice(0, 10);
  const termWidth = getTermWidth();
  const sep = "━".repeat(Math.min(termWidth, 80));
  return `\n${BOLD}🦞 openclaw logs${RST} ${DIM}BRT • ${dateStr}${RST}\n${C_SEP}${sep}${RST}\n`;
}

export function formatPrettyLine(rawLine: string, _opts?: PrettyFormatOptions): string | null {
  const parsed = parseLogLine(rawLine);
  if (!parsed) {
    return null;
  }

  const time = parsed.time ?? "";
  const timeStr = formatTimeBRT(time);
  const level = (parsed.level ?? "info").toLowerCase();
  const subsystem = parsed.subsystem ?? parsed.module ?? "";
  let msg = parsed.message || parsed.raw;

  const ls = LEVEL_STYLES[level] ?? LEVEL_STYLES.info;
  const cat = categorize(subsystem, msg);

  // Time gap separator
  let separator = "";
  if (prevTimeStr && timeStr !== "??:??:??" && prevTimeStr !== "??:??:??") {
    try {
      const prevS =
        parseInt(prevTimeStr.slice(6, 8)) +
        parseInt(prevTimeStr.slice(3, 5)) * 60 +
        parseInt(prevTimeStr.slice(0, 2)) * 3600;
      const currS =
        parseInt(timeStr.slice(6, 8)) +
        parseInt(timeStr.slice(3, 5)) * 60 +
        parseInt(timeStr.slice(0, 2)) * 3600;
      if (currS - prevS > 2) {
        const termWidth = getTermWidth();
        separator = `${C_SEP}${"─".repeat(Math.min(termWidth, 80))}${RST}\n`;
      }
    } catch {
      /* ignore */
    }
  }
  prevTimeStr = timeStr;

  // Build prefix: HH:MM:SS badge icon
  const prefix = `${C_TIME}${timeStr}${RST} ${ls.color}${ls.badge}${RST} ${cat.headerColor}${cat.icon}${RST} `;
  const indent = 15; // ~HH:MM:SS + badge + icon + spaces

  // Format message content
  msg = stripSubsystemPrefix(msg);
  const trimmed = msg.trim();
  let content: string;

  // ── Fix A: Suppress plugin startup table ──────────────────────
  // The gateway logs a full plugin table on every startup via console.log.
  // It's noisy in the pretty formatter — run `openclaw plugins list` instead.
  // The table is logged as a single multi-line string (one console.log call),
  // so we only need to match the first line (starts with ┌) plus the
  // surrounding metadata lines logged as separate calls.
  if (
    /^Plugins \(\d+\/\d+ loaded\)/.test(trimmed) ||
    trimmed === "Source roots:" ||
    /^\s*(stock|workspace|global):\s/.test(trimmed) ||
    // Full plugin table (renderTable output — single multi-line log entry)
    (trimmed.startsWith("┌") && trimmed.includes("┬") && trimmed.includes("Status")) ||
    // Fallback: individual header/footer rows if logged separately
    (trimmed.startsWith("│") && trimmed.includes("Status") && trimmed.includes("Source"))
  ) {
    return null;
  }

  // Session-memory hook formatting
  if (subsystem.includes("session-memory")) {
    const sessFmt = formatSessionLine(trimmed);
    if (sessFmt !== null) {
      if (sessFmt === "") {
        return null;
      }
      return `${separator}${prefix}${sessFmt}`;
    }
  }

  // Cron line formatting
  if (subsystem.includes("cron")) {
    const cronFmt = formatCronLine(trimmed, cat.headerColor);
    if (cronFmt) {
      return `${separator}${prefix}${cronFmt}`;
    }
  }

  // Agent run lifecycle + tool call formatting (highest priority)
  const runFmt = formatRunLine(trimmed);
  if (runFmt !== null) {
    if (runFmt === "") {
      return null;
    } // suppress
    return `${separator}${prefix}${wrapText(`${cat.headerColor}${runFmt}${RST}`, indent, cat.headerColor)}`;
  }
  const toolFmt = formatToolLine(trimmed, timeStr);
  if (toolFmt !== null) {
    if (toolFmt === "") {
      return null;
    } // suppress
    return `${separator}${prefix}${wrapText(`${cat.headerColor}${toolFmt}${RST}`, indent, cat.headerColor)}`;
  }

  // ── Fix B: Multi-line content (tables, tool output, etc.) ───────
  // When a single log entry contains embedded newlines (e.g. ASCII tables
  // from `console.log(renderTable(...))`), render each line with proper
  // indentation instead of collapsing everything into one mangled line.
  if (trimmed.includes("\n")) {
    const lines = trimmed.split("\n");
    const pad = " ".repeat(indent);
    const renderedLines = lines
      .filter((_, i) => i > 0 || lines[0].trim() !== "") // skip leading blank
      .map((line, i) =>
        i === 0 ? `${cat.contentColor}${line}${RST}` : `${pad}${cat.contentColor}${line}${RST}`,
      )
      .join("\n");
    // Trim trailing blank lines
    return `${separator}${prefix}${renderedLines.trimEnd()}`;
  }

  if (trimmed.startsWith("{")) {
    const obj = tryParseJson(trimmed);
    if (obj && ("body" in obj || "text" in obj)) {
      content = formatMessageBody(trimmed, cat.headerColor, cat.contentColor, indent);
    } else if (obj) {
      content = wrapText(formatJsonBlob(trimmed, cat.contentColor), indent, cat.contentColor);
    } else {
      content = wrapText(
        `${cat.contentColor}${phoneAlias(compactIds(msg))}${RST}`,
        indent,
        cat.contentColor,
      );
    }
  } else {
    content = wrapText(
      `${cat.contentColor}${phoneAlias(compactIds(msg))}${RST}`,
      indent,
      cat.contentColor,
    );
  }

  return `${separator}${prefix}${content}`;
}
