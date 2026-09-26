import { shellQuote } from "./shell-quote.ts";

export interface NextStepsInput {
  /** Path to print in the `cd` command — relative to the caller's cwd when possible. */
  displayDestination: string;
  /** Whether `pnpm install` already ran, so the manual step can be omitted. */
  installRan: boolean;
  /** The `--runtime-spec` value applied to package.json/doc/package.json, if any (spec #58). */
  runtimeSpec?: string;
}

// #28 (pack-and-install verifier) parses this block back out and runs it
// verbatim, so the header text and indentation are load-bearing, not
// cosmetic — keep them exact. No literal ``` fences: some terminals/agents
// render them as literal text instead of a code block (spec #58 "no fences").
const HEADER = "Next steps:";
const HINT = "Open circuit/WORKFLOW.md → Workflow A";
const COMMAND_INDENT = "  ";

/** Builds the exact, machine-extractable "Next steps:" block (spec #8). */
export function formatNextSteps(input: NextStepsInput): string {
  const commands = [`cd ${shellQuote(input.displayDestination)}`];
  if (!input.installRan) commands.push("pnpm install");
  commands.push("pnpm circuit:doctor", "pnpm dev");

  const lines = [HEADER, "", ...commands.map((command) => `${COMMAND_INDENT}${command}`)];

  // Only surfaced when install did not already run: that is the one case
  // where the user (or a resumed `pnpm install`) still needs to know the
  // dependency spec in package.json/doc/package.json was overridden.
  if (!input.installRan && input.runtimeSpec !== undefined) {
    lines.push(
      "",
      `Applied --runtime-spec ${JSON.stringify(input.runtimeSpec)} to package.json and doc/package.json.`,
    );
  }

  lines.push("", HINT);
  return lines.join("\n");
}
