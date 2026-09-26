import path from "node:path";
import type { AgentChoice, ParsedOptions } from "./args.ts";
import { CliUsageError } from "./errors.ts";
import {
  titleCaseFromName,
  validateLibrary,
  validateName,
  validateTitle,
} from "./validate.ts";

export interface Plan {
  /** Resolved once; every later step reuses this instead of re-resolving. */
  destinationPath: string;
  name: string;
  title: string;
  library: string;
  agent: AgentChoice;
  install: boolean;
  git: boolean;
}

/** Applies defaults (spec #2) and validates each value separately (spec #3). */
export function resolvePlan(
  options: ParsedOptions,
  destinationRaw: string,
  cwd: string,
): Plan {
  const destinationPath = path.resolve(cwd, destinationRaw);

  const name = options.name ?? path.basename(destinationPath);
  try {
    validateName(name);
  } catch (error) {
    if (options.name === undefined && error instanceof CliUsageError) {
      throw new CliUsageError(
        `Cannot derive a valid package name from "${path.basename(destinationPath)}": ${error.message} Pass --name explicitly.`,
      );
    }
    throw error;
  }

  const title = options.title ?? titleCaseFromName(name);
  validateTitle(title);

  const library = options.library ?? libraryFromName(name);
  try {
    validateLibrary(library);
  } catch (error) {
    if (options.library === undefined && error instanceof CliUsageError) {
      throw new CliUsageError(
        `Cannot derive a valid library name from "${name}": ${error.message} Pass --library explicitly.`,
      );
    }
    throw error;
  }

  return {
    destinationPath,
    name,
    title,
    library,
    agent: options.agent,
    install: options.install,
    git: options.git,
  };
}

/** Renders the plan for the pre-flight printout (spec #5). */
export function formatPlan(plan: Plan): string {
  return [
    "Plan:",
    `  destination: ${plan.destinationPath}`,
    `  name: ${plan.name}`,
    `  title: ${plan.title}`,
    `  library: ${plan.library}`,
    `  agent: ${plan.agent}`,
    `  install: ${plan.install ? "yes" : "no"}`,
    `  git: ${plan.git ? "yes" : "no"}`,
  ].join("\n");
}

/** Package names may be scoped or dotted; KiCad library names may not. */
function libraryFromName(name: string): string {
  return name.replace(/^@[^/]+\//, "").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64);
}
