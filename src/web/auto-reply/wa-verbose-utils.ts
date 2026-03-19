import { whatsappOutboundLog } from "./loggers.js";

/**
 * wa-verbose-utils.ts — Butley custom patch: Verbose Light
 *
 * Extracted from process-message.ts to avoid upstream merge conflicts.
 * Upstream will never touch this file. Add all verbose-narration helpers here.
 * Includes: formatToolNarration, logToolNarrationDelivered.
 */

/**
 * Reformat upstream verbose tool narration into clean one-liners for WhatsApp.
 * Strips emoji prefixes, shortens paths, collapses verbose exec chains.
 */
export function formatToolNarration(raw: string): string {
  // Take first line only (upstream may include code blocks after).
  const firstLine = raw.split("\n\n")[0].split("\n")[0].trim();

  // Strip surrounding backticks/code fences if present.
  let text = firstLine.replace(/^`+|`+$/g, "").trim();

  // Strip upstream emoji prefix and tool label (e.g. "🛠️ Exec: ..." → "...")
  // Common patterns: "🛠️ Exec: cmd", "📖 Read: path", "✍️ Write: path", "📝 Edit: path"
  const prefixMatch = text.match(/^[\p{Emoji}\p{Emoji_Presentation}\uFE0F\s]+(?:[A-Za-z_]+:\s*)?/u);
  let toolType = "";
  if (prefixMatch) {
    // Extract tool type from prefix (e.g. "Exec", "Read", "Edit")
    const typeMatch = prefixMatch[0].match(/([A-Za-z_]+):/);
    toolType = typeMatch ? typeMatch[1].toLowerCase() : "";
    text = text.slice(prefixMatch[0].length).trim();
  }

  // Remove trailing "(in ~/...)" location hints.
  text = text.replace(/\s*\(in [^)]+\)\s*$/, "");

  // Shorten home paths: ~/Projects/openclaw/src/web/foo.ts → foo.ts
  text = text.replace(/~\/[A-Za-z0-9_./-]+/g, (match) => {
    const parts = match.split("/");
    if (parts.length <= 3) {
      return match;
    }
    const last = parts[parts.length - 1];
    if (last.includes(".")) {
      return last;
    }
    return parts.slice(-2).join("/");
  });

  // Collapse verbose exec chains
  text = text
    .replace(/\bprint text(?:\s*→\s*)?/g, "")
    .replace(/\brun\s+/g, "")
    .replace(/\bshow last \d+ lines?/g, "")
    .replace(/\bshow first \d+ lines?/g, "")
    .replace(/\bview\s+/gi, "")
    .replace(/→\s*→/g, "→")
    .replace(/^\s*→\s*/, "")
    .replace(/\s*→\s*$/, "")
    .trim();

  // Pick emoji based on tool type and command content
  let emoji = "🧩";
  if (toolType === "exec" || toolType === "bash") {
    if (/\bgit\b/.test(text)) {
      emoji = "📦";
    } else if (/\bnpm|build|make\b/.test(text)) {
      emoji = "🔨";
    } else if (/\bgrep|search|find\b/.test(text)) {
      emoji = "🔍";
    } else if (/\bpython|node|bun\b/.test(text)) {
      emoji = "🐍";
    } else if (/\blaunchctl|systemctl|restart|kill\b/.test(text)) {
      emoji = "⚙️";
    } else if (/\bcat|head|tail|sed|awk\b/.test(text)) {
      emoji = "📄";
    } else {
      emoji = "🛠️";
    }
  } else if (toolType === "read") {
    emoji = "📂";
  } else if (toolType === "write") {
    emoji = "✏️";
  } else if (toolType === "edit") {
    emoji = "✏️";
  } else if (toolType === "web_search") {
    emoji = "🌐";
  } else if (toolType === "web_fetch") {
    emoji = "🌐";
  } else if (toolType === "memory_search") {
    emoji = "🧠";
  } else if (toolType === "image") {
    emoji = "🖼️";
  } else if (toolType === "message") {
    emoji = "💬";
  }

  // Truncate to 80 chars
  if (text.length > 80) {
    text = text.slice(0, 77) + "...";
  }

  return text ? `${emoji} ${text}` : firstLine.slice(0, 80);
}

/**
 * Log tool narration delivery at DEBUG level.
 * Tool narrations are side-channel messages — logging them at INFO
 * creates noise indistinguishable from final reply delivery.
 * Tool execution is already tracked via the native tool start/end logs.
 */
export function logToolNarrationDelivered(fromDisplay: string, hasMedia: boolean): void {
  whatsappOutboundLog.debug(`[narration-delivered] to=${fromDisplay}${hasMedia ? " (media)" : ""}`);
}
