import { shellQuote } from "./shell-quote.ts";

export interface NextStepsInput {
  /** Path to print in the `cd` command — relative to the caller's cwd when possible. */
  displayDestination: string;
  /** Whether `pnpm install` already ran, so the manual step can be omitted. */
  installRan: boolean;
}

// #28 (pack-and-install verifier) parses this block back out and runs it
// verbatim, so the header text and fence markers are load-bearing, not
// cosmetic — keep them exact.
const HEADER = "Next steps:";
const HINT = "Open circuit/WORKFLOW.md → Workflow A";

/** Builds the exact, machine-extractable "Next steps:" block (spec #8). */
export function formatNextSteps(input: NextStepsInput): string {
  const commands = [`cd ${shellQuote(input.displayDestination)}`];
  if (!input.installRan) commands.push("pnpm install");
  commands.push("pnpm circuit:doctor", "pnpm dev");

  return [HEADER, "", "```", ...commands, "```", "", HINT].join("\n");
}
