// [FORK-PATCH-8] Status Card Formatter
// Extracted from status.ts to isolate fork-specific formatting from upstream code.
// Upstream changes to status.ts data-gathering won't cause merge conflicts here.

export interface StatusCardData {
  versionLine: string;
  timeLine?: string;
  selectedModelLabel: string;
  modelNote: string;
  providerLabel: string;
  fallbackState: { active: boolean; reason?: string };
  activeModelLabel?: string;
  activeAuthLabelValue?: string;
  selectedAuthLabelValue?: string;
  usageCostLine?: string | null;
  cacheLine?: string | null;
  contextLine: string;
  mediaLine?: string | null;
  sessionKey?: string;
  subagentsLine?: string;
  optionsLine: string;
  voiceLine?: string | null;
  groupActivationValue?: string;
  queueMode: string;
  queueDetails: string;
}

export function formatStatusCard(data: StatusCardData): string {
  const padLabel = (value: string) => value.padEnd(11);

  const rows: string[] = [];
  rows.push(`◈ ${padLabel("Model")}${data.selectedModelLabel}${data.modelNote}`);
  rows.push(`∴ ${padLabel("Key")}${data.providerLabel}`);

  if (data.fallbackState.active) {
    const showFbAuth =
      data.activeAuthLabelValue && data.activeAuthLabelValue !== data.selectedAuthLabelValue;
    rows.push(
      `↩ ${padLabel("Fallback")}${data.activeModelLabel ?? ""}${showFbAuth ? ` · ${data.activeAuthLabelValue}` : ""} (${data.fallbackState.reason ?? "unavailable"})`,
    );
  }

  if (data.usageCostLine) {
    const cleanUsage = data.usageCostLine
      .replace(/🧮\s*Tokens:\s*/u, "")
      .replace(/💵\s*Cost:\s*/u, "cost: ");
    rows.push(`↕ ${padLabel("Tokens")}${cleanUsage}`);
  }

  if (data.cacheLine) {
    const cleanCache = data.cacheLine.replace(/🗄️\s*Cache:\s*/u, "");
    rows.push(`≡ ${padLabel("Cache")}${cleanCache}`);
  }

  const cleanContext = data.contextLine
    .replace(/^Context:\s*/, "")
    .replace(/🧹\s*Compactions/, "compactions");
  rows.push(`▰ ${padLabel("Context")}${cleanContext}`);

  if (data.mediaLine) {
    rows.push(`◇ ${padLabel("Media")}${data.mediaLine.replace(/^[^\w]*/u, "")}`);
  }

  const shortSession = (data.sessionKey ?? "unknown")
    .replace(/^agent:main:/, "")
    .replace(/(group:\d{6})\d+@g\.us/, "$1…");
  rows.push(`► ${padLabel("Session")}${shortSession}`);

  if (data.subagentsLine) {
    rows.push(`⊞ ${padLabel("Subs")}${data.subagentsLine.replace(/^[^\w]*/u, "")}`);
  }

  const cleanOptions = data.optionsLine.replace(/^Runtime:\s*/, "");
  rows.push(`△ ${padLabel("Runtime")}${cleanOptions}`);

  if (data.voiceLine) {
    rows.push(`♫ ${padLabel("Voice")}${data.voiceLine.replace(/🔊\s*Voice:\s*/u, "")}`);
  }

  if (data.groupActivationValue) {
    rows.push(`⊕ ${padLabel("Activation")}${data.groupActivationValue}`);
  }
  rows.push(`⌂ ${padLabel("Queue")}${data.queueMode}${data.queueDetails}`);

  const parts: string[] = [data.versionLine];
  if (data.timeLine) {
    parts.push(data.timeLine.replace(/🕒\s*Time:\s*/u, ""));
  }
  parts.push("```");
  parts.push(...rows);
  parts[parts.length - 1] += "```";
  return parts.join("\n");
}
