import crypto from "node:crypto";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { parseCliArgs } from "./args.ts";
import { CliError, CliUsageError } from "./errors.ts";
import { defaultRunGit, type GitRunner } from "./git.ts";
import { HELP_TEXT, USAGE_LINE } from "./help.ts";
import { defaultRunInstall, type InstallRunner } from "./install.ts";
import { formatNextSteps } from "./next-steps.ts";
import { formatPlan, resolvePlan } from "./plan.ts";
import { promptForDestination } from "./prompt.ts";
import { checkDestinationCollision, composeProject } from "./scaffold.ts";
import { shellQuote } from "./shell-quote.ts";
import { readPackageVersion } from "./version.ts";

interface WritableLike {
  write(chunk: string): unknown;
}

/**
 * Every external effect the CLI performs is injectable here, so tests can
 * run the real orchestration logic against a fixture template, a fake
 * installer/git runner, and captured streams instead of the real world.
 */
export interface CliOverrides {
  cwd?: string;
  stdout?: WritableLike;
  stderr?: WritableLike;
  stdin?: Readable;
  isTTY?: boolean;
  templateDir?: URL | string;
  runInstall?: InstallRunner;
  runGit?: GitRunner;
  randomSuffix?: () => string;
  /** Test-only seam: called before each template file is copied. */
  beforeCopyFile?: (relPath: string) => void;
}

function println(stream: WritableLike, text: string): void {
  stream.write(text.endsWith("\n") ? text : `${text}\n`);
}

/** Entry point. `argv` is the CLI's own arguments only (no `node`/script path). */
export async function main(argv: string[], overrides: CliOverrides = {}): Promise<number> {
  const cwd = overrides.cwd ?? process.cwd();
  const stdout: WritableLike = overrides.stdout ?? process.stdout;
  const stderr: WritableLike = overrides.stderr ?? process.stderr;
  const stdin = overrides.stdin ?? process.stdin;
  const isTTY =
    overrides.isTTY ??
    Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const templateDir = overrides.templateDir ?? new URL("../templates/default/", import.meta.url);
  const runInstall = overrides.runInstall ?? defaultRunInstall;
  const runGit = overrides.runGit ?? defaultRunGit;
  const randomSuffix = overrides.randomSuffix ?? (() => crypto.randomBytes(6).toString("hex"));

  try {
    const parsed = parseCliArgs(argv);

    if (parsed.help) {
      println(stdout, HELP_TEXT);
      return 0;
    }
    if (parsed.version) {
      println(stdout, readPackageVersion(import.meta.url));
      return 0;
    }

    let destinationRaw = parsed.destination;
    if (destinationRaw === undefined) {
      if (parsed.yes || !isTTY) {
        throw new CliUsageError(
          "A destination directory is required (pass one, or run on an interactive terminal without --yes to be prompted).",
        );
      }
      destinationRaw = await promptForDestination(stdin, stdout as unknown as Writable);
      if (destinationRaw.length === 0) {
        throw new CliUsageError("A destination directory is required.");
      }
    }

    const plan = resolvePlan(parsed, destinationRaw, cwd);
    const displayDestination = path.relative(cwd, plan.destinationPath) || ".";

    checkDestinationCollision(plan.destinationPath);

    println(stdout, formatPlan(plan));

    composeProject({
      plan,
      templateDir,
      randomSuffix,
      beforeCopyFile: overrides.beforeCopyFile,
    });

    let installRan = false;
    if (plan.install) {
      try {
        await runInstall(plan.destinationPath);
        installRan = true;
      } catch (error) {
        println(
          stderr,
          `Error: ${(error as Error).message} The generated files are left in place — they form a valid project.`,
        );
        println(
          stdout,
          ["Recovery:", "", "```", `cd ${shellQuote(displayDestination)}`, "pnpm install", "```"].join(
            "\n",
          ),
        );
        return 1;
      }
    }

    if (plan.git) {
      const outcome = await runGit(plan.destinationPath);
      if (outcome.note) println(stdout, outcome.note);
    }

    println(stdout, `Created ${plan.destinationPath}`);
    println(stdout, "");
    println(stdout, formatNextSteps({ displayDestination, installRan }));

    return 0;
  } catch (error) {
    if (error instanceof CliUsageError) {
      println(stderr, `Error: ${error.message}`);
      println(stderr, USAGE_LINE);
      return 2;
    }
    if (error instanceof CliError) {
      println(stderr, `Error: ${error.message}`);
      return 1;
    }
    println(stderr, `Error: ${(error as Error).message}`);
    return 1;
  }
}
