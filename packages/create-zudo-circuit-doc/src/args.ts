import { parseArgs } from "node:util";
import { CliUsageError } from "./errors.ts";

export const AGENT_CHOICES = ["claude", "codex", "both", "none"] as const;
export type AgentChoice = (typeof AGENT_CHOICES)[number];

export interface ParsedOptions {
  help: boolean;
  version: boolean;
  yes: boolean;
  destination: string | undefined;
  name: string | undefined;
  title: string | undefined;
  library: string | undefined;
  agent: AgentChoice;
  install: boolean;
  git: boolean;
}

/**
 * Parses argv with node:util parseArgs (strict). `--install`/`--no-install`
 * and `--git`/`--no-git` are not natively negatable by parseArgs, so both
 * spellings are declared and the last one seen on the command line wins.
 */
export function parseCliArgs(argv: string[]): ParsedOptions {
  let result;
  try {
    result = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      tokens: true,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        yes: { type: "boolean", short: "y" },
        name: { type: "string" },
        title: { type: "string" },
        library: { type: "string" },
        agent: { type: "string" },
        install: { type: "boolean" },
        "no-install": { type: "boolean" },
        git: { type: "boolean" },
        "no-git": { type: "boolean" },
      },
    });
  } catch (error) {
    throw new CliUsageError((error as Error).message);
  }

  const { values, positionals, tokens } = result;

  if (positionals.length > 1) {
    throw new CliUsageError(
      `Too many arguments: expected at most one destination, got ${positionals.length} (${positionals.join(", ")}).`,
    );
  }

  let install = true;
  let git = true;
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    if (token.name === "install") install = true;
    else if (token.name === "no-install") install = false;
    else if (token.name === "git") git = true;
    else if (token.name === "no-git") git = false;
  }

  const agentRaw = values.agent ?? "both";
  if (!(AGENT_CHOICES as readonly string[]).includes(agentRaw)) {
    throw new CliUsageError(
      `Invalid --agent "${agentRaw}": must be one of ${AGENT_CHOICES.join(", ")}.`,
    );
  }

  return {
    help: values.help ?? false,
    version: values.version ?? false,
    yes: values.yes ?? false,
    destination: positionals[0],
    name: values.name,
    title: values.title,
    library: values.library,
    agent: agentRaw as AgentChoice,
    install,
    git,
  };
}
