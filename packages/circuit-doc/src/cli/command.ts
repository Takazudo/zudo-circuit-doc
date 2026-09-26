/**
 * The command-module contract of the `zudo-circuit-doc` CLI.
 *
 * Every command lives in its own module under `commands/` and exports
 * `command: CommandModule`. The dispatcher parses argv against the module's
 * own `meta` and builds `--help` from it, so a later issue replaces a command
 * (help text included) by replacing its module — never by editing the
 * dispatcher.
 */

import type { LoadedProject } from "./project.ts";

/** 0 pass, 1 check failed, 2 usage/config error, 4 not run (optional tool missing). */
export const EXIT = {
  PASS: 0,
  FAILED: 1,
  USAGE: 2,
  NOT_RUN: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export type FlagSpec = {
  /** Long form including dashes, e.g. `--watch`. */
  readonly name: string;
  /** `boolean` (default), one `value`, or `values`: one or more, repeatable. */
  readonly kind?: "boolean" | "value" | "values";
  /** Placeholder shown in help for value flags, e.g. `<dir>`. */
  readonly valueName?: string;
  readonly description: string;
};

export type PositionalSpec = {
  readonly name: string;
  readonly description: string;
  readonly required?: boolean;
  /** When set, the value must be one of these. */
  readonly choices?: readonly string[];
};

export type ExitCodeSpec = {
  readonly code: number;
  readonly meaning: string;
};

export type CommandMeta = {
  readonly name: string;
  /** One line, shown in the top-level command list. */
  readonly summary: string;
  /** Longer help paragraph(s); optional. */
  readonly description?: string;
  readonly positionals?: readonly PositionalSpec[];
  readonly flags?: readonly FlagSpec[];
  readonly exitCodes: readonly ExitCodeSpec[];
  /** The sub-issue that implements a stub command, e.g. `19`. */
  readonly trackedIn?: number;
};

export type Writer = { readonly write: (chunk: string) => unknown };

export type CliIo = {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdout: Writer;
  readonly stderr: Writer;
  /** Aborting it stops long-running commands (`generate --watch`). */
  readonly signal?: AbortSignal;
};

export type ParsedArgs = {
  readonly positionals: readonly string[];
  /** Boolean flags map to `true`; value flags to their string(s). */
  readonly flags: ReadonlyMap<string, true | string | readonly string[]>;
};

export type CommandContext = {
  readonly io: CliIo;
  readonly args: ParsedArgs;
  /** The global `--config <path>`, relative to `io.cwd`; `undefined` means `<cwd>/circuit.config.ts`. */
  readonly configPath: string | undefined;
  /** Load, validate, resolve and map the project config. Throws `ConfigError`/`ComponentDocsError`. */
  readonly loadProject: (options?: { readonly fresh?: boolean }) => Promise<LoadedProject>;
};

export type CommandModule = {
  readonly meta: CommandMeta;
  readonly run: (context: CommandContext) => Promise<number>;
};

export function flag(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

export function flagValue(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

export function flagValues(args: ParsedArgs, name: string): readonly string[] {
  const value = args.flags.get(name);
  if (value === undefined || value === true) return [];
  return typeof value === "string" ? [value] : value;
}
