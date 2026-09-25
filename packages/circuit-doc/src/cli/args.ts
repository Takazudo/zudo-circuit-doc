/** Argv parsing driven entirely by a command's `meta` (flags and positionals). */

import type { CommandMeta, FlagSpec, ParsedArgs } from "./command.ts";

/** A usage mistake; the dispatcher prints it with the command's help and exits 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export type GlobalArgs = {
  readonly configPath: string | undefined;
  readonly help: boolean;
  readonly version: boolean;
  /** Everything that is not a global option, in order. */
  readonly rest: readonly string[];
};

/** Pull the global options (`--config`, `--help`/`-h`, `--version`) out of argv, wherever they appear. */
export function parseGlobalArgs(argv: readonly string[]): GlobalArgs {
  let configPath: string | undefined;
  let help = false;
  let version = false;
  const rest: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (token === "--") {
      rest.push(...argv.slice(index));
      break;
    }
    if (token === "--help" || token === "-h") help = true;
    else if (token === "--version") version = true;
    else if (token === "--config" || token.startsWith("--config=")) {
      const value = token === "--config" ? argv[(index += 1)] : token.slice("--config=".length);
      if (value === undefined || value === "" || value.startsWith("-")) {
        throw new UsageError("--config requires a path");
      }
      if (configPath !== undefined) throw new UsageError("--config given more than once");
      configPath = value;
    } else rest.push(token);
  }
  return { configPath, help, version, rest };
}

export function parseCommandArgs(meta: CommandMeta, argv: readonly string[]): ParsedArgs {
  const specs = new Map<string, FlagSpec>((meta.flags ?? []).map((spec) => [spec.name, spec]));
  const flags = new Map<string, true | string | string[]>();
  const positionals: string[] = [];
  let onlyPositionals = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (onlyPositionals || !token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      onlyPositionals = true;
      continue;
    }
    const [name, inline] = splitInline(token);
    const spec = specs.get(name);
    if (spec === undefined) throw new UsageError(`unknown option ${name} for \`${meta.name}\``);
    const kind = spec.kind ?? "boolean";

    if (kind === "boolean") {
      if (inline !== undefined) throw new UsageError(`${name} takes no value`);
      flags.set(name, true);
      continue;
    }

    const values: string[] = [];
    if (inline !== undefined) values.push(inline);
    else {
      // `values` consumes every following non-option token; `value` exactly one.
      while (index + 1 < argv.length && !(argv[index + 1] as string).startsWith("-")) {
        values.push(argv[(index += 1)] as string);
        if (kind === "value") break;
      }
    }
    if (values.length === 0 || values.some((value) => value === "")) {
      throw new UsageError(`${name} requires ${spec.valueName ?? "a value"}`);
    }
    if (kind === "value") {
      if (flags.has(name)) throw new UsageError(`${name} given more than once`);
      flags.set(name, values[0] as string);
    } else {
      const previous = flags.get(name);
      flags.set(name, [...(Array.isArray(previous) ? previous : []), ...values]);
    }
  }

  const specsPositional = meta.positionals ?? [];
  if (positionals.length > specsPositional.length) {
    throw new UsageError(`unexpected argument ${JSON.stringify(positionals[specsPositional.length])} for \`${meta.name}\``);
  }
  specsPositional.forEach((spec, index) => {
    const value = positionals[index];
    if (value === undefined) {
      if (spec.required === true) throw new UsageError(`\`${meta.name}\` requires <${spec.name}>`);
      return;
    }
    if (spec.choices !== undefined && !spec.choices.includes(value)) {
      throw new UsageError(`<${spec.name}> must be one of ${spec.choices.join(", ")} (got ${JSON.stringify(value)})`);
    }
  });

  return { positionals, flags };
}

function splitInline(token: string): [string, string | undefined] {
  const at = token.indexOf("=");
  return at === -1 ? [token, undefined] : [token.slice(0, at), token.slice(at + 1)];
}
