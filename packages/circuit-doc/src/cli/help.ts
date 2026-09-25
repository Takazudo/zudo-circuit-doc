/** `--help` text, built only from each command module's exported `meta`. */

import type { CommandMeta, FlagSpec } from "./command.ts";

export const BIN_NAME = "zudo-circuit-doc";

const GLOBAL_OPTIONS: readonly FlagSpec[] = [
  { name: "--config", kind: "value", valueName: "<path>", description: "config file (default: ./circuit.config.ts)" },
  { name: "--help", description: "show help (also `<command> --help`)" },
  { name: "--version", description: "print the package version" },
];

export function usageLine(meta: CommandMeta): string {
  const positionals = (meta.positionals ?? []).map((spec) => {
    const name = spec.choices === undefined ? `<${spec.name}>` : spec.choices.join("|");
    return spec.required === true ? name : `[${name}]`;
  });
  const flags = (meta.flags ?? []).map((spec) => `[${flagLabel(spec)}]`);
  return [BIN_NAME, meta.name, ...positionals, ...flags, "[--config <path>]"].join(" ");
}

export function renderRootHelp(commands: readonly CommandMeta[], version: string): string {
  const width = Math.max(...commands.map((meta) => meta.name.length)) + 2;
  return [
    `${BIN_NAME} ${version} — component-evidence documentation for circuit projects`,
    "",
    `Usage: ${BIN_NAME} <command> [options] [--config <path>]`,
    "",
    "Commands:",
    ...commands.map((meta) => `  ${meta.name.padEnd(width)}${meta.summary}${stubSuffix(meta)}`),
    "",
    "Options:",
    ...optionLines(GLOBAL_OPTIONS),
    "",
    "Exit codes: 0 pass, 1 check failed, 2 usage/config error, 4 not run (optional tool missing).",
    `Run \`${BIN_NAME} <command> --help\` for a command's options and exit codes.`,
    "",
  ].join("\n");
}

export function renderCommandHelp(meta: CommandMeta): string {
  const lines = [`Usage: ${usageLine(meta)}`, "", `${meta.summary}${stubSuffix(meta)}`];
  if (meta.description !== undefined) lines.push("", meta.description);
  if ((meta.positionals ?? []).length > 0) {
    lines.push("", "Arguments:");
    const width = Math.max(...(meta.positionals ?? []).map((spec) => spec.name.length + 2)) + 2;
    for (const spec of meta.positionals ?? []) {
      lines.push(`  ${`<${spec.name}>`.padEnd(width)}${spec.description}`);
    }
  }
  if ((meta.flags ?? []).length > 0) lines.push("", "Options:", ...optionLines(meta.flags ?? []));
  lines.push("", "Exit codes:", ...meta.exitCodes.map((entry) => `  ${entry.code}  ${entry.meaning}`), "");
  return lines.join("\n");
}

function stubSuffix(meta: CommandMeta): string {
  return meta.trackedIn === undefined ? "" : ` (not implemented yet — #${meta.trackedIn})`;
}

function flagLabel(spec: FlagSpec): string {
  const kind = spec.kind ?? "boolean";
  if (kind === "boolean") return spec.name;
  const value = spec.valueName ?? "<value>";
  return kind === "values" ? `${spec.name} ${value}…` : `${spec.name} ${value}`;
}

function optionLines(flags: readonly FlagSpec[]): string[] {
  const width = Math.max(...flags.map((spec) => flagLabel(spec).length)) + 2;
  return flags.map((spec) => `  ${flagLabel(spec).padEnd(width)}${spec.description}`);
}
