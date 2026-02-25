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
