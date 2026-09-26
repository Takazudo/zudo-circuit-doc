#!/usr/bin/env node
// Diffs the command list documented in doc/src/content/docs/reference/cli.mdx against the real
// `zudo-circuit-doc --help` output, so the reference page can never silently drift from the CLI
// it describes (#30). Every command the CLI lists must have its own `## `command`` heading on
// the page, and every such heading must name a real command — nothing else is checked here (flag
// wording, exit-code prose, etc. are read by a human reviewer, not diffed mechanically).
//
// Requires `packages/circuit-doc` to be built first (`pnpm build`): this runs the real CLI
// binary, never a mock.
//
// Usage: node scripts/check-docs-cli.mjs

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CLI_BIN = path.join(REPO_ROOT, "packages/circuit-doc/bin/zudo-circuit-doc.js");
// `bin/` is committed and only imports the gitignored build output, so probe that.
const CLI_BUILT = path.join(REPO_ROOT, "packages/circuit-doc/lib/cli/main.js");
const CLI_REFERENCE_PAGE = path.join(REPO_ROOT, "doc/src/content/docs/reference/cli.mdx");

if (!existsSync(CLI_BUILT)) {
  console.error(`missing ${path.relative(REPO_ROOT, CLI_BUILT)} — run \`pnpm build\` first`);
  process.exit(1);
}
if (!existsSync(CLI_REFERENCE_PAGE)) {
  console.error(`missing ${path.relative(REPO_ROOT, CLI_REFERENCE_PAGE)}`);
  process.exit(1);
}

const helpResult = spawnSync(process.execPath, [CLI_BIN, "--help"], { encoding: "utf8" });
if (helpResult.status !== 0) {
  console.error(`FAIL: \`zudo-circuit-doc --help\` exited ${helpResult.status}`);
  console.error(helpResult.stderr || helpResult.stdout);
  process.exit(1);
}

// The root help's "Commands:" block lists one `  <name>  <summary>` line per command, until the
// next blank line.
const helpLines = helpResult.stdout.split("\n");
const commandsStart = helpLines.findIndex((line) => line.trim() === "Commands:");
if (commandsStart === -1) {
  console.error("FAIL: could not find a \"Commands:\" section in `zudo-circuit-doc --help` output");
  process.exit(1);
}
const helpCommands = [];
for (const line of helpLines.slice(commandsStart + 1)) {
  if (line.trim() === "") break;
  const match = /^\s{2}(\S+)/u.exec(line);
  if (match) helpCommands.push(match[1]);
}

// The reference page's `## \`name\`` headings, one per documented command.
const page = readFileSync(CLI_REFERENCE_PAGE, "utf8");
const docCommands = [...page.matchAll(/^## `([a-z-]+)`$/gmu)].map((match) => match[1]);

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`PASS: ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL: ${label}`);
  if (detail) console.log(detail.replace(/^/gm, "  "));
}

check(
  "every CLI command has a reference heading",
  helpCommands.every((name) => docCommands.includes(name)),
  `--help commands: ${helpCommands.join(", ")}\ndocumented headings: ${docCommands.join(", ")}\nmissing: ${helpCommands.filter((name) => !docCommands.includes(name)).join(", ") || "(none)"}`,
);
check(
  "no documented heading names a command the CLI doesn't have",
  docCommands.every((name) => helpCommands.includes(name)),
  `stale headings: ${docCommands.filter((name) => !helpCommands.includes(name)).join(", ") || "(none)"}`,
);
check("the CLI lists at least one command", helpCommands.length > 0);

// Every documented command's own `--help` must still exit 0 and mention the summary line from
// the root help, catching a page that names a real command but describes a stale usage line.
for (const name of helpCommands) {
  const commandHelp = spawnSync(process.execPath, [CLI_BIN, name, "--help"], { encoding: "utf8" });
  check(`\`${name} --help\` exits 0`, commandHelp.status === 0, commandHelp.stderr || commandHelp.stdout);
}

console.log(failures === 0 ? `\nPASS: check-docs-cli (${helpCommands.length} commands)` : `\nFAIL: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
