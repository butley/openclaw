import { _ as isValidTimeZone, g as formatLocalIsoWithOffset } from "./globals-1g9PhnTZ.js";
import "./paths-dQ_clcF4.js";
import { n as isRich, r as theme, t as colorize } from "./theme-H80Q3Qtv.js";
import { h as clearActiveProgressLine } from "./subsystem-CVaAzJWY.js";
import "./boolean-Cxf2THfz.js";
import { Ws as buildGatewayConnectionDetails } from "./auth-profiles-C_hWnnsG.js";
import { t as formatCliCommand } from "./command-format-xiq-peSB.js";
import "./agent-scope-ciM67gYz.js";
import "./utils-hRMQE3lI.js";
import "./boundary-file-read-BoNLDurR.js";
import "./logger-Dz2ir4Xz.js";
import "./exec-oLHRjz5-.js";
import "./github-copilot-token-BlHBUXZs.js";
import "./registry-BGvHaTSg.js";
import "./skills-WwJ-cgxf.js";
import "./frontmatter-COEYX5xL.js";
import "./env-overrides-eH6HaD80.js";
import "./version-BlUhcaFh.js";
import "./search-manager-OoPMhEwb.js";
import "./plugins-CVp4JUox.js";
import "./query-expansion-BiHEyx7G.js";
import "./redact-BWjgs076.js";
import "./errors-D5INWvGS.js";
import "./fetch-D5SuoyGB.js";
import "./path-alias-guards-BWsWlD0g.js";
import "./cmd-argv-DWNHU-dd.js";
import "./delivery-queue-Dqzoxn1f.js";
import "./paths-DPIeb3JQ.js";
import "./session-cost-usage-hVTPrj3b.js";
import "./prompt-style-BzvcdUK-.js";
import { t as formatDocsLink } from "./links-ee1fYZM6.js";
import "./cli-utils-Cffeb5c8.js";
import { n as callGatewayFromCli, t as addGatewayClientOptions } from "./gateway-rpc-CVTEnL7k.js";
import { t as parseLogLine } from "./parse-log-line-DXsAjSjP.js";
import { setTimeout } from "node:timers/promises";
//#region src/terminal/stream-writer.ts
function isBrokenPipeError(err) {
	const code = err?.code;
	return code === "EPIPE" || code === "EIO";
}
function createSafeStreamWriter(options = {}) {
	let closed = false;
	let notified = false;
	const noteBrokenPipe = (err, stream) => {
		if (notified) return;
		notified = true;
		options.onBrokenPipe?.(err, stream);
	};
	const handleError = (err, stream) => {
		if (!isBrokenPipeError(err)) throw err;
		closed = true;
		noteBrokenPipe(err, stream);
		return false;
	};
	const write = (stream, text) => {
		if (closed) return false;
		try {
			options.beforeWrite?.();
		} catch (err) {
			return handleError(err, process.stderr);
		}
		try {
			stream.write(text);
			return !closed;
		} catch (err) {
			return handleError(err, stream);
		}
	};
	const writeLine = (stream, text) => write(stream, `${text}\n`);
	return {
		write,
		writeLine,
		reset: () => {
			closed = false;
			notified = false;
		},
		isClosed: () => closed
	};
}
//#endregion
//#region src/cli/logs-pretty-formatter.ts
/**
* Rich log formatter for `openclaw logs --pretty`.
* Ported from oc-logs.py — categories, icons, phone aliases, UUID compaction,
* message body extraction, time-gap separators, terminal-aware wrapping.
*/
const RST = "\x1B[0m";
const DIM = "\x1B[2m";
const BOLD = "\x1B[1m";
function fg256(n, bold = false) {
	return bold ? `\x1b[38;5;${n};1m` : `\x1b[38;5;${n}m`;
}
const LEVEL_STYLES = {
	debug: {
		color: fg256(243),
		badge: "dbg"
	},
	trace: {
		color: fg256(243),
		badge: "trc"
	},
	info: {
		color: fg256(252),
		badge: "inf"
	},
	warn: {
		color: fg256(214, true),
		badge: "WRN"
	},
	error: {
		color: fg256(196, true),
		badge: "ERR"
	},
	fatal: {
		color: fg256(196, true),
		badge: "FTL"
	}
};
const CATEGORIES = [
	{
		keywords: ["whatsapp/inbound", "web-inbound"],
		headerColor: fg256(115),
		icon: "←",
		contentColor: fg256(115)
	},
	{
		keywords: ["whatsapp/outbound", "web-auto-reply"],
		headerColor: fg256(75),
		icon: "→",
		contentColor: fg256(75)
	},
	{
		keywords: ["whatsapp", "brazil-jid"],
		headerColor: fg256(115),
		icon: "◆",
		contentColor: fg256(115)
	},
	{
		keywords: ["agent", "embedded"],
		headerColor: fg256(183),
		icon: "▸",
		contentColor: fg256(140)
	},
	{
		keywords: ["cron"],
		headerColor: fg256(222),
		icon: "⏱",
		contentColor: fg256(180)
	},
	{
		keywords: ["memory", "qmd"],
		headerColor: fg256(212),
		icon: "◈",
		contentColor: fg256(175)
	},
	{
		keywords: [
			"ws",
			"websocket",
			"web-heartbeat"
		],
		headerColor: fg256(244),
		icon: "~",
		contentColor: fg256(243)
	},
	{
		keywords: ["diagnostic"],
		headerColor: fg256(241),
		icon: "·",
		contentColor: fg256(240)
	},
	{
		keywords: ["config"],
		headerColor: fg256(252),
		icon: "⚙",
		contentColor: fg256(248)
	}
];
const DEFAULT_CAT = {
	headerColor: fg256(248),
	icon: "•",
	contentColor: fg256(245)
};
const PHONE_ALIASES = {
	"+553196348700": "Luke",
	"+551151942900": "Bob"
};
const CRON_NAMES = {
	"2f867f09": "Scribe",
	"479ae2ac": "Curator",
	c2163640: "Architect",
	"36373c6b": "Digest"
};
const C_TIME = fg256(240);
const C_BODY = fg256(252);
const C_SEP = fg256(236);
const C_TOOL_NAME = fg256(183, true);
const C_TOOL_META = fg256(248);
const C_TOOL_PHASE = fg256(243);
const TOOL_EMOJI = {
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
	agents_list: "👥"
};
const MODEL_SHORT = {
	"claude-opus-4-6": "opus-4.6",
	"claude-opus-4-5": "opus-4.5",
	"claude-sonnet-4-6": "sonnet-4.6",
	"claude-sonnet-4-5": "sonnet-4.5",
	"claude-haiku-4-5": "haiku-4.5"
};
const _runInfo = /* @__PURE__ */ new Map();
const _toolStartTime = /* @__PURE__ */ new Map();
const TOOL_MERGE_THRESHOLD_S = 2;
function parseRunKv(rest) {
	const kv = {};
	for (const m of rest.matchAll(/(\w+)=(\S+)/g)) kv[m[1]] = m[2];
	return kv;
}
/** Format `embedded run *` lifecycle lines. Returns null if not a run line, '' to suppress. */
function formatRunLine(msg) {
	const m = msg.match(/^embedded run (start|prompt start|agent start|agent end|prompt end|done): runId=(\S+)(.*)/);
	if (!m) return null;
	const [, phase, runId, rest] = m;
	const kv = parseRunKv(rest);
	if (phase === "start") {
		const model = MODEL_SHORT[kv.model ?? ""] ?? kv.model ?? "";
		const thinking = kv.thinking ?? "";
		const channel = kv.messageChannel ?? "";
		_runInfo.set(runId, { model });
		const parts = [`${C_TOOL_PHASE}▶${RST} 🤖 ${C_TOOL_NAME}${model}${RST}`];
		if (thinking) parts.push(`${C_TOOL_META}thinking=${thinking}${RST}`);
		if (channel) parts.push(`${C_TOOL_META}(${channel})${RST}`);
		return parts.join(" ");
	}
	if (phase === "prompt start") return "";
	if (phase === "agent start") {
		const model = _runInfo.get(runId)?.model ?? "";
		return ` ${C_TOOL_META}📡 calling API…${RST}${model ? ` ${C_TOOL_NAME}${model}${RST}` : ""}`;
	}
	if (phase === "agent end") {
		if (kv.isError === "true") return ` \x1b[1;31m📡 API error${RST}`;
		return "";
	}
	if (phase === "prompt end") {
		const info = _runInfo.get(runId);
		_runInfo.delete(runId);
		const model = info?.model ?? "";
		const ms = kv.durationMs ? parseFloat(kv.durationMs) : null;
		const durStr = ms !== null ? ` ${C_TOOL_META}${(ms / 1e3).toFixed(1)}s${RST}` : "";
		return `${C_TOOL_PHASE}■${RST} 🤖${model ? ` ${C_TOOL_NAME}${model}${RST}` : ""} done${durStr}`;
	}
	if (phase === "done") return "";
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
function formatToolMeta(toolName, raw) {
	const runParts = raw.replace(/\n[\s\S]*/s, "").trim().replace(/`$/, "").trim().split(/ → run /);
	const command = runParts[0].trim();
	const totalLines = runParts.length - 1 + (command.match(/ -> run /g) ?? []).length;
	let cmd = command.replace(/ [→\->]+ show >.*$/, "").replace(/ -> show.*$/, "").trim();
	if (toolName === "write" || toolName === "edit") cmd = cmd.replace(/\s+EOF\s*$/, "").trim();
	if (cmd.length > MAX_META_CHARS) cmd = cmd.slice(0, MAX_META_CHARS - 1) + "…";
	if (totalLines > 0) return `${cmd} ${DIM}[+${totalLines} lines]${RST}`;
	return cmd;
}
/** Format `embedded run tool start/end` lines. Returns null if not a tool line, '' to suppress. */
function formatToolLine(msg, timeStr) {
	const m = msg.match(/^embedded run tool (start|end): runId=\S+ tool=(\S+) toolCallId=(\S+)(?:\s+meta=(.+))?/s);
	if (!m) return null;
	const [, phase, toolName, toolCallId, metaRaw] = m;
	const rawMeta = (metaRaw ?? "").trim();
	const meta = rawMeta ? formatToolMeta(toolName, rawMeta) : "";
	const core = `${TOOL_EMOJI[toolName] ?? "🧩"} ${C_TOOL_NAME}${toolName}${RST}${meta ? ` ${C_TOOL_META}${meta}${RST}` : ""}`;
	if (phase === "start") {
		_toolStartTime.set(toolCallId, timeStr);
		return `${C_TOOL_PHASE}→${RST} ${core}`;
	}
	const startTime = _toolStartTime.get(toolCallId);
	_toolStartTime.delete(toolCallId);
	let dur = null;
	if (startTime && timeStr) try {
		const toS = (t) => parseInt(t.slice(0, 2)) * 3600 + parseInt(t.slice(3, 5)) * 60 + parseInt(t.slice(6, 8));
		dur = toS(timeStr) - toS(startTime);
	} catch {}
	if (dur !== null && dur < TOOL_MERGE_THRESHOLD_S) return "";
	return `${C_TOOL_PHASE}✓${RST} ${core}${dur !== null ? ` ${C_TOOL_META}(${dur.toFixed(1)}s)${RST}` : ""}`;
}
function getTermWidth() {
	return process.stdout.columns || 120;
}
function stripAnsi(s) {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}
function phoneAlias(text) {
	for (const [phone, alias] of Object.entries(PHONE_ALIASES)) text = text.replaceAll(phone, alias);
	return text;
}
function compactIds(msg) {
	for (const [shortId, name] of Object.entries(CRON_NAMES)) msg = msg.replace(new RegExp(`${shortId}[0-9a-f-]*`, "g"), `${shortId}…(${name})`);
	msg = msg.replace(/([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "$1…");
	return msg;
}
function categorize(subsystem, msg) {
	const text = `${subsystem} ${msg}`.toLowerCase();
	for (const cat of CATEGORIES) for (const kw of cat.keywords) if (text.includes(kw)) return {
		headerColor: cat.headerColor,
		icon: cat.icon,
		contentColor: cat.contentColor
	};
	return DEFAULT_CAT;
}
function formatTimeBRT(ts) {
	if (!ts) return "??:??:??";
	try {
		const d = new Date(ts);
		if (Number.isNaN(d.getTime())) return ts.slice(11, 19) || ts;
		const brt = /* @__PURE__ */ new Date(d.getTime() - 10800 * 1e3);
		return `${String(brt.getUTCHours()).padStart(2, "0")}:${String(brt.getUTCMinutes()).padStart(2, "0")}:${String(brt.getUTCSeconds()).padStart(2, "0")}`;
	} catch {
		return ts.slice(11, 19) || ts;
	}
}
function stripSubsystemPrefix(msg) {
	msg = msg.replace(/^\{"subsystem":"[^"]*"\}\s*/, "");
	msg = msg.replace(/^\{"module":"[^"]*"(?:,"runId":"[^"]*")?\}\s*/, "");
	msg = msg.replace(/^\{[^{}]*"module":"[^"]*"[^{}]*\}\s*(?=\{)/, "");
	msg = msg.replace(/^\[(?:WARN|INFO|ERROR|DEBUG)\]\s*/, "");
	return msg;
}
function wrapText(text, indent, color) {
	const termWidth = getTermWidth();
	const visible = stripAnsi(text);
	const maxWidth = Math.max(40, termWidth - indent);
	if (visible.length <= maxWidth) return text;
	const words = visible.split(/\s+/);
	const lines = [];
	let current = "";
	for (const word of words) if (current.length + word.length + 1 > maxWidth && current.length > 0) {
		lines.push(current);
		current = word;
	} else current = current ? `${current} ${word}` : word;
	if (current) lines.push(current);
	const pad = " ".repeat(indent);
	return lines.map((line, i) => i === 0 ? `${color}${line}${RST}` : `${pad}${color}${line}${RST}`).join("\n");
}
function tryParseJson(s) {
	const trimmed = s.trim();
	if (!trimmed.startsWith("{")) return null;
	try {
		return JSON.parse(trimmed);
	} catch {
		const lastBrace = trimmed.lastIndexOf("}");
		if (lastBrace > 0) try {
			return JSON.parse(trimmed.slice(0, lastBrace + 1));
		} catch {}
		return null;
	}
}
function formatMessageBody(msg, hcolor, ccolor, indent) {
	const obj = tryParseJson(msg);
	if (!obj) return phoneAlias(compactIds(msg));
	const stringify = (v) => {
		if (v == null) return "";
		if (typeof v === "object") return JSON.stringify(v);
		if (typeof v === "string") return v;
		return `${v}`;
	};
	const body = stringify(obj.body ?? obj.text ?? "");
	const from = phoneAlias(stringify(obj.from));
	const to = phoneAlias(stringify(obj.to));
	const mediaKind = stringify(obj.mediaKind ?? obj.mediaType);
	const duration = obj.durationMs ? `(${stringify(obj.durationMs)}ms)` : "";
	const headerParts = [];
	if (from && to) headerParts.push(`${from} → ${to}`);
	else if (from) headerParts.push(`from ${from}`);
	if (mediaKind) headerParts.push(`[${mediaKind}]`);
	if (duration) headerParts.push(duration);
	const header = headerParts.join(" ");
	if (!body) {
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
			"mediaPath"
		]);
		const extra = Object.entries(obj).filter(([k, v]) => !skip.has(k) && v != null).map(([k, v]) => `${k}=${String(v)}`).join(" ");
		return `${hcolor}${header}${extra ? ` ${extra}` : ""}${RST}`;
	}
	const bodyText = phoneAlias(String(body));
	const termWidth = getTermWidth();
	const maxBodyWidth = Math.min(90, Math.max(40, termWidth - indent - 2));
	const words = bodyText.split(/\s+/);
	const lines = [];
	let current = "";
	for (const word of words) if (current.length + word.length + 1 > maxBodyWidth && current.length > 0) {
		lines.push(current);
		current = word;
	} else current = current ? `${current} ${word}` : word;
	if (current) lines.push(current);
	const pad = " ".repeat(indent);
	return `${hcolor}${header}${RST}\n\n${lines.map((l) => `${pad}${C_BODY}${l}${RST}`).join("\n")}\n`;
}
function formatJsonBlob(msg, ccolor) {
	const obj = tryParseJson(msg);
	if (!obj) return phoneAlias(compactIds(msg));
	for (const key of [
		"nextAt",
		"lastMessageAt",
		"lastAt"
	]) {
		const val = obj[key];
		if (typeof val === "number" && val > 0xe8d4a51000) try {
			obj[key] = new Date(val).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });
		} catch {}
	}
	const skip = new Set([
		"connectionId",
		"correlationId",
		"mediaPath",
		"mediaSizeBytes"
	]);
	const parts = [];
	for (const [k, v] of Object.entries(obj)) {
		if (skip.has(k) || v == null) continue;
		let sv = typeof v === "object" ? JSON.stringify(v) : String(v);
		if (typeof v === "number" && v > 0xe8d4a51000) try {
			sv = formatTimeBRT(new Date(v).toISOString());
		} catch {}
		sv = phoneAlias(sv);
		parts.push(`${DIM}${k}=${RST}${ccolor}${sv}${RST}`);
	}
	return parts.join(" ");
}
let prevTimeStr = "";
/** Format session-memory hook lines (action=new, context resolved, reset fallback, etc.) */
function formatSessionLine(msg) {
	const m = msg.match(/^(\{.*?\})\s+(.+)$/s);
	if (!m) return null;
	const obj = tryParseJson(m[1]);
	if (!obj) return null;
	const desc = m[2].trim();
	if (desc.includes("Hook triggered") && typeof obj.action === "string") return `${obj.action === "new" ? "🔄" : "♻️"} ${C_TOOL_NAME}session ${obj.action}${RST}`;
	if (desc.includes("Session context resolved") && typeof obj.sessionId === "string") return `${C_TOOL_META}session ${obj.sessionId.slice(0, 8)}… cfg=${obj.hasCfg ? "✓" : "✗"}${RST}`;
	if (desc.includes("reset fallback") && typeof obj.latestResetPath === "string") {
		const resetFile = obj.latestResetPath.split("/").pop() ?? "";
		const tsMatch = resetFile.match(/\.reset\.(.+)$/);
		return `${C_TOOL_META}↩ reset fallback${RST} ${DIM}${tsMatch ? tsMatch[1] : resetFile}${RST}`;
	}
	if (desc.includes("Session content loaded") && typeof obj.length === "number") return `${C_TOOL_META}session content ${obj.length} chars${RST}`;
	if (desc.includes("Memory file path") && typeof obj.path === "string") return `${C_TOOL_META}→ ${obj.path.replace(/.*\/memory\//, "memory/")}${RST}`;
	if (desc.includes("slug") && typeof obj.slug === "string") return `${C_TOOL_META}slug: ${obj.slug}${RST}`;
	if (desc.includes("generateSlugViaLLM")) return `${C_TOOL_META}generating slug…${RST}`;
	return null;
}
/** Format cron log lines: extracts trailing tag + timestamps. */
function formatCronLine(msg, hcolor) {
	const m = msg.match(/^(\{.*?\})\s+((?:cron|cron-reaper)[\s:].+)$/s);
	if (!m) return null;
	const obj = tryParseJson(m[1]);
	if (!obj) return null;
	const tag = m[2].replace(/^cron(?:-reaper)?:\s*/, "").trim();
	const parts = [`${hcolor}CRON${RST}`];
	if (tag) parts.push(`${C_TOOL_META}${tag}${RST}`);
	const jobName = obj["jobName"];
	if (typeof jobName === "string" && jobName) parts.push(`${C_TOOL_NAME}${jobName}${RST}`);
	const tsField = obj["nextAt"] ?? obj["nextWakeAtMs"];
	if (typeof tsField === "number" && tsField > 0xe8d4a51000) try {
		const time = new Date(tsField).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });
		parts.push(`${hcolor}→ ${time}${RST}`);
	} catch {}
	if (typeof tsField === "number" && tsField > 0xe8d4a51000) {
		const diffMs = tsField - Date.now();
		if (diffMs > 0) {
			const secs = diffMs / 1e3;
			const label = secs < 90 ? `${Math.round(secs)}s` : `${Math.round(secs / 60)}m`;
			parts.push(`${C_TOOL_META}(in ${label})${RST}`);
		}
	}
	const jobs = obj["jobs"];
	if (typeof jobs === "number") parts.push(`${C_TOOL_META}${jobs} jobs${RST}`);
	return parts.join(" ");
}
function resetPrettyState() {
	prevTimeStr = "";
}
function formatPrettyHeader() {
	const now = /* @__PURE__ */ new Date();
	const dateStr = (/* @__PURE__ */ new Date(now.getTime() - 10800 * 1e3)).toISOString().slice(0, 10);
	const termWidth = getTermWidth();
	return `\n${BOLD}🦞 openclaw logs${RST} ${DIM}BRT • ${dateStr}${RST}\n${C_SEP}${"━".repeat(Math.min(termWidth, 80))}${RST}\n`;
}
function formatPrettyLine(rawLine, _opts) {
	const parsed = parseLogLine(rawLine);
	if (!parsed) return null;
	const timeStr = formatTimeBRT(parsed.time ?? "");
	const level = (parsed.level ?? "info").toLowerCase();
	const subsystem = parsed.subsystem ?? parsed.module ?? "";
	let msg = parsed.message || parsed.raw;
	const ls = LEVEL_STYLES[level] ?? LEVEL_STYLES.info;
	const cat = categorize(subsystem, msg);
	let separator = "";
	if (prevTimeStr && timeStr !== "??:??:??" && prevTimeStr !== "??:??:??") try {
		const prevS = parseInt(prevTimeStr.slice(6, 8)) + parseInt(prevTimeStr.slice(3, 5)) * 60 + parseInt(prevTimeStr.slice(0, 2)) * 3600;
		if (parseInt(timeStr.slice(6, 8)) + parseInt(timeStr.slice(3, 5)) * 60 + parseInt(timeStr.slice(0, 2)) * 3600 - prevS > 2) {
			const termWidth = getTermWidth();
			separator = `${C_SEP}${"─".repeat(Math.min(termWidth, 80))}${RST}\n`;
		}
	} catch {}
	prevTimeStr = timeStr;
	const prefix = `${C_TIME}${timeStr}${RST} ${ls.color}${ls.badge}${RST} ${cat.headerColor}${cat.icon}${RST} `;
	const indent = 15;
	msg = stripSubsystemPrefix(msg);
	const trimmed = msg.trim();
	let content;
	if (/^Plugins \(\d+\/\d+ loaded\)/.test(trimmed) || trimmed === "Source roots:" || /^\s*(stock|workspace|global):\s/.test(trimmed) || trimmed.startsWith("┌") && trimmed.includes("┬") && trimmed.includes("Status") || trimmed.startsWith("│") && trimmed.includes("Status") && trimmed.includes("Source")) return null;
	if (subsystem.includes("session-memory")) {
		const sessFmt = formatSessionLine(trimmed);
		if (sessFmt !== null) {
			if (sessFmt === "") return null;
			return `${separator}${prefix}${sessFmt}`;
		}
	}
	if (subsystem.includes("cron")) {
		const cronFmt = formatCronLine(trimmed, cat.headerColor);
		if (cronFmt) return `${separator}${prefix}${cronFmt}`;
	}
	const runFmt = formatRunLine(trimmed);
	if (runFmt !== null) {
		if (runFmt === "") return null;
		return `${separator}${prefix}${wrapText(`${cat.headerColor}${runFmt}${RST}`, indent, cat.headerColor)}`;
	}
	const toolFmt = formatToolLine(trimmed, timeStr);
	if (toolFmt !== null) {
		if (toolFmt === "") return null;
		return `${separator}${prefix}${wrapText(`${cat.headerColor}${toolFmt}${RST}`, indent, cat.headerColor)}`;
	}
	if (trimmed.includes("\n")) {
		const lines = trimmed.split("\n");
		const pad = " ".repeat(indent);
		const renderedLines = lines.filter((_, i) => i > 0 || lines[0].trim() !== "").map((line, i) => i === 0 ? `${cat.contentColor}${line}${RST}` : `${pad}${cat.contentColor}${line}${RST}`).join("\n");
		return `${separator}${prefix}${renderedLines.trimEnd()}`;
	}
	if (trimmed.startsWith("{")) {
		const obj = tryParseJson(trimmed);
		if (obj && ("body" in obj || "text" in obj)) content = formatMessageBody(trimmed, cat.headerColor, cat.contentColor, indent);
		else if (obj) content = wrapText(formatJsonBlob(trimmed, cat.contentColor), indent, cat.contentColor);
		else content = wrapText(`${cat.contentColor}${phoneAlias(compactIds(msg))}${RST}`, indent, cat.contentColor);
	} else content = wrapText(`${cat.contentColor}${phoneAlias(compactIds(msg))}${RST}`, indent, cat.contentColor);
	return `${separator}${prefix}${content}`;
}
//#endregion
//#region src/cli/logs-cli.ts
function parsePositiveInt(value, fallback) {
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
async function fetchLogs(opts, cursor, showProgress) {
	const payload = await callGatewayFromCli("logs.tail", opts, {
		cursor,
		limit: parsePositiveInt(opts.limit, 200),
		maxBytes: parsePositiveInt(opts.maxBytes, 25e4)
	}, { progress: showProgress });
	if (!payload || typeof payload !== "object") throw new Error("Unexpected logs.tail response");
	return payload;
}
function formatLogTimestamp(value, mode = "plain", localTime = false) {
	if (!value) return "";
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return value;
	let timeString;
	if (localTime) timeString = formatLocalIsoWithOffset(parsed);
	else timeString = parsed.toISOString();
	if (mode === "pretty") return timeString.slice(11, 19);
	return timeString;
}
function formatLogLine(raw, opts) {
	const parsed = parseLogLine(raw);
	if (!parsed) return raw;
	const label = parsed.subsystem ?? parsed.module ?? "";
	const time = formatLogTimestamp(parsed.time, opts.pretty ? "pretty" : "plain", opts.localTime);
	const level = parsed.level ?? "";
	const levelLabel = level.padEnd(5).trim();
	const message = parsed.message || parsed.raw;
	if (!opts.pretty) return [
		time,
		level,
		label,
		message
	].filter(Boolean).join(" ").trim();
	const timeLabel = colorize(opts.rich, theme.muted, time);
	const labelValue = colorize(opts.rich, theme.accent, label);
	const levelValue = level === "error" || level === "fatal" ? colorize(opts.rich, theme.error, levelLabel) : level === "warn" ? colorize(opts.rich, theme.warn, levelLabel) : level === "debug" || level === "trace" ? colorize(opts.rich, theme.muted, levelLabel) : colorize(opts.rich, theme.info, levelLabel);
	const messageValue = level === "error" || level === "fatal" ? colorize(opts.rich, theme.error, message) : level === "warn" ? colorize(opts.rich, theme.warn, message) : level === "debug" || level === "trace" ? colorize(opts.rich, theme.muted, message) : colorize(opts.rich, theme.info, message);
	return [[
		timeLabel,
		levelValue,
		labelValue
	].filter(Boolean).join(" "), messageValue].filter(Boolean).join(" ").trim();
}
function createLogWriters() {
	const writer = createSafeStreamWriter({
		beforeWrite: () => clearActiveProgressLine(),
		onBrokenPipe: (err, stream) => {
			const code = err.code ?? "EPIPE";
			const message = `openclaw logs: output ${stream === process.stdout ? "stdout" : "stderr"} closed (${code}). Stopping tail.`;
			try {
				clearActiveProgressLine();
				process.stderr.write(`${message}\n`);
			} catch {}
		}
	});
	return {
		logLine: (text) => writer.writeLine(process.stdout, text),
		errorLine: (text) => writer.writeLine(process.stderr, text),
		emitJsonLine: (payload, toStdErr = false) => writer.write(toStdErr ? process.stderr : process.stdout, `${JSON.stringify(payload)}\n`)
	};
}
function emitGatewayError(err, opts, mode, rich, emitJsonLine, errorLine) {
	const details = buildGatewayConnectionDetails({ url: opts.url });
	const message = "Gateway not reachable. Is it running and accessible?";
	const hint = `Hint: run \`${formatCliCommand("openclaw doctor")}\`.`;
	const errorText = err instanceof Error ? err.message : String(err);
	if (mode === "json") {
		if (!emitJsonLine({
			type: "error",
			message,
			error: errorText,
			details,
			hint
		}, true)) return;
		return;
	}
	if (!errorLine(colorize(rich, theme.error, message))) return;
	if (!errorLine(details.message)) return;
	errorLine(colorize(rich, theme.muted, hint));
}
function registerLogsCli(program) {
	const logs = program.command("logs").description("Tail gateway file logs via RPC").option("--limit <n>", "Max lines to return", "200").option("--max-bytes <n>", "Max bytes to read", "250000").option("--follow", "Follow log output", false).option("--interval <ms>", "Polling interval in ms", "1000").option("--json", "Emit JSON log lines", false).option("--pretty", "Rich formatted output with categories, icons, and colors", false).option("-n [count]", "Show last N lines and exit (default: 200 with --pretty, 100 without)").option("--plain", "Plain text output (no ANSI styling)", false).option("--no-color", "Disable ANSI colors").option("--local-time", "Display timestamps in local timezone", false).addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/logs", "docs.openclaw.ai/cli/logs")}\n`);
	addGatewayClientOptions(logs);
	logs.action(async (opts) => {
		const { logLine, errorLine, emitJsonLine } = createLogWriters();
		const interval = parsePositiveInt(opts.interval, 1e3);
		let cursor;
		let first = true;
		const jsonMode = Boolean(opts.json);
		const usePrettyRich = Boolean(opts.pretty) && !jsonMode && !opts.plain;
		const pretty = !jsonMode && Boolean(process.stdout.isTTY) && !opts.plain;
		const rich = isRich() && opts.color !== false;
		const localTime = Boolean(opts.localTime) || !!process.env.TZ && isValidTimeZone(process.env.TZ);
		if (opts.n !== void 0) {
			const defaultN = usePrettyRich ? 200 : 100;
			const nValue = opts.n === true ? defaultN : parsePositiveInt(String(opts.n), defaultN);
			opts.limit = String(nValue);
			opts.follow = false;
		}
		if (usePrettyRich && opts.n === void 0) opts.follow = true;
		if (usePrettyRich) resetPrettyState();
		while (true) {
			let payload;
			const showProgress = first && !opts.follow;
			try {
				payload = await fetchLogs(opts, cursor, showProgress);
			} catch (err) {
				emitGatewayError(err, opts, jsonMode ? "json" : "text", rich, emitJsonLine, errorLine);
				process.exit(1);
				return;
			}
			const lines = Array.isArray(payload.lines) ? payload.lines : [];
			if (jsonMode) {
				if (first) {
					if (!emitJsonLine({
						type: "meta",
						file: payload.file,
						cursor: payload.cursor,
						size: payload.size
					})) return;
				}
				for (const line of lines) {
					const parsed = parseLogLine(line);
					if (parsed) {
						if (!emitJsonLine({
							type: "log",
							...parsed
						})) return;
					} else if (!emitJsonLine({
						type: "raw",
						raw: line
					})) return;
				}
				if (payload.truncated) {
					if (!emitJsonLine({
						type: "notice",
						message: "Log tail truncated (increase --max-bytes)."
					})) return;
				}
				if (payload.reset) {
					if (!emitJsonLine({
						type: "notice",
						message: "Log cursor reset (file rotated)."
					})) return;
				}
			} else {
				if (first) {
					if (usePrettyRich) {
						if (!logLine(formatPrettyHeader())) return;
					} else if (payload.file) {
						if (!logLine(`${pretty ? colorize(rich, theme.muted, "Log file:") : "Log file:"} ${payload.file}`)) return;
					}
				}
				for (const line of lines) if (usePrettyRich) {
					const formatted = formatPrettyLine(line, { localTime });
					if (formatted !== null && !logLine(formatted)) return;
				} else if (!logLine(formatLogLine(line, {
					pretty,
					rich,
					localTime
				}))) return;
				if (payload.truncated) {
					if (!errorLine("Log tail truncated (increase --max-bytes).")) return;
				}
				if (payload.reset) {
					if (!errorLine("Log cursor reset (file rotated).")) return;
				}
			}
			cursor = typeof payload.cursor === "number" && Number.isFinite(payload.cursor) ? payload.cursor : cursor;
			first = false;
			if (!opts.follow) return;
			await setTimeout(interval);
		}
	});
}
//#endregion
export { registerLogsCli };
