import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { Command } from "commander";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { defaultRuntime } from "../runtime.js";
import { formatHelpExamples } from "./help-format.js";

/**
 * Extract `--agent <id>` from argv, returning the agent id and the remaining
 * args that should be forwarded to qmd.  We do this manually so we don't need
 * commander's passThroughOptions (which requires enablePositionalOptions on the
 * parent) and so unknown qmd flags aren't swallowed.
 */
function extractAgentArg(argv: string[]): { agentId: string | null; rest: string[] } {
  const rest: string[] = [];
  let agentId: string | null = null;
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if ((arg === "--agent" || arg === "-a") && i + 1 < argv.length) {
      agentId = argv[i + 1];
      i += 2;
    } else if (arg?.startsWith("--agent=")) {
      agentId = arg.slice("--agent=".length);
      i += 1;
    } else {
      rest.push(arg as string);
      i += 1;
    }
  }
  return { agentId, rest };
}

function resolveAgent(agentId: string | null): string {
  if (agentId) {
    return agentId.trim();
  }
  try {
    const cfg = loadConfig();
    return resolveDefaultAgentId(cfg);
  } catch {
    return "main";
  }
}

function resolveXdgCacheHome(agentId: string): string {
  const stateDir = resolveStateDir(process.env, os.homedir);
  return path.join(stateDir, "agents", agentId, "qmd", "xdg-cache");
}

function findQmdBinary(): string {
  if (process.env.OPENCLAW_QMD_BIN) {
    return process.env.OPENCLAW_QMD_BIN;
  }
  return "qmd";
}

export function registerQmdCli(program: Command) {
  program
    .command("qmd")
    .description("Proxy qmd commands with agent-scoped XDG_CACHE_HOME")
    .addHelpText(
      "after",
      () =>
        `\n${formatHelpExamples([
          ["openclaw qmd status --index index", "Show qmd index status."],
          ['openclaw qmd query "search term"', "Run a semantic query."],
          ["openclaw qmd embed --index index", "Re-embed the index."],
          ["openclaw qmd --agent work status --index index", "Use a different agent's index."],
        ])}\n`,
    )
    .option("--agent <id>", "Agent ID whose qmd index to use (default: default agent)")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(() => {
      // Manually slice process.argv to get everything after the "qmd" subcommand token.
      // This avoids the passThroughOptions requirement and keeps all qmd flags intact.
      const argv = process.argv;
      const qmdIdx = argv.findIndex((arg, i) => i >= 2 && arg === "qmd");
      const rawAfterQmd = qmdIdx >= 0 ? argv.slice(qmdIdx + 1) : [];

      const { agentId: parsedAgent, rest: qmdArgs } = extractAgentArg(rawAfterQmd);
      const agentId = resolveAgent(parsedAgent);
      const xdgCacheHome = resolveXdgCacheHome(agentId);
      const qmdBin = findQmdBinary();

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        XDG_CACHE_HOME: xdgCacheHome,
      };

      const result = spawnSync(qmdBin, qmdArgs, {
        env,
        stdio: "inherit",
        shell: false,
      });

      if (result.error) {
        defaultRuntime.error(
          `qmd: failed to spawn '${qmdBin}': ${result.error.message}\n` +
            `Make sure qmd is installed and available in PATH.`,
        );
        defaultRuntime.exit(1);
        return;
      }

      const code = result.status ?? 1;
      if (code !== 0) {
        defaultRuntime.exit(code);
      }
    });
}
