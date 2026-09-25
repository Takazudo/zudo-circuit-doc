/**
 * `zudo-circuit-doc new-component <suffix> [--dry-run]`: copies the packaged
 * component-skill template to `<bundlesRoot>/<ownerPrefix><suffix>` and names
 * it. The copy still carries the template's demo values on purpose — the
 * validator's placeholder-leak check fails until every one is replaced.
 */

import { cp, lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { packagedTemplateDir } from "../../validate/resolved-config.ts";
import { UsageError } from "../args.ts";
import { EXIT, flag, type CommandContext, type CommandModule } from "../command.ts";
import { PROJECT_COMMANDS } from "../project.ts";
import { reportFailure } from "../run.ts";

const SUFFIX_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const command: CommandModule = {
  meta: {
    name: "new-component",
    summary: "start a component evidence bundle from the packaged template",
    positionals: [
      {
        name: "suffix",
        description: "bundle name after the owner prefix, e.g. `tmp1075` -> component-tmp1075 (lowercase, digits, dashes)",
        required: true,
      },
    ],
    flags: [{ name: "--dry-run", description: "print what would be created; write nothing" }],
    exitCodes: [
      { code: EXIT.PASS, meaning: "bundle created (or dry run printed)" },
      { code: EXIT.USAGE, meaning: "usage/config error, invalid suffix, or the directory already exists" },
    ],
  },
  run,
};

async function run(context: CommandContext): Promise<number> {
  const { io } = context;
  const suffix = context.args.positionals[0] as string;
  const dryRun = flag(context.args, "--dry-run");
  try {
    if (!SUFFIX_PATTERN.test(suffix)) {
      throw new UsageError(`<suffix> must be lowercase letters, digits and single dashes (got ${JSON.stringify(suffix)})`);
    }
    const project = await context.loadProject();
    const { ownerPrefix, auditSkill, integrationSkill } = project.config.evidence;
    const name = `${ownerPrefix}${suffix}`;
    if (name === auditSkill || name === integrationSkill) {
      throw new UsageError(`${name} is a reserved skill directory`);
    }
    const target = join(project.paths.bundlesRoot, name);
    const label = project.label(target);
    if ((await lstat(target).catch(() => null)) !== null) {
      throw new UsageError(`${label} already exists; refusing to overwrite it`);
    }

    const template = packagedTemplateDir();
    const files = (await readdir(template)).sort();
    if (dryRun) {
      io.stdout.write(`would create ${label}/ from the packaged template:\n`);
      for (const file of files) io.stdout.write(`  ${label}/${file}\n`);
    } else {
      await cp(template, target, { recursive: true, errorOnExist: true, force: false });
      const skillPath = join(target, "SKILL.md");
      await writeFile(skillPath, renameSkill(await readFile(skillPath, "utf8"), name), "utf8");
      io.stdout.write(`created ${label}/ (${files.length} files)\n`);
    }
    io.stdout.write(nextSteps(label, project.label(project.paths.inventoryFile), project.label(project.config.publication.selection)));
    return EXIT.PASS;
  } catch (error) {
    return reportFailure(error, io.stderr);
  }
}

/** Replace the frontmatter `name:` line; the template's `component-example` must not survive. */
export function renameSkill(contents: string, name: string): string {
  const renamed = contents.replace(/^(---\r?\n(?:.*\r?\n)*?)name:[^\r\n]*/u, `$1name: ${name}`);
  if (renamed === contents) throw new Error("template SKILL.md has no frontmatter `name:` line");
  return renamed;
}

function nextSteps(bundle: string, inventory: string, selection: string): string {
  return [
    "",
    "Next steps:",
    `  1. Replace EVERY example value in ${bundle}/ (EXAMPLE-MPN, C000000, example.invalid, zero hashes, the`,
    "     description and body of SKILL.md) with real, sourced evidence. Unknown stays unknown — never invent values.",
    `  2. Add the part's line to ${inventory}.`,
    `  3. Select the record, its sources and its document in ${selection} and update its expect counts.`,
    `  4. Run \`${PROJECT_COMMANDS.check}\` until it passes.`,
    "",
  ].join("\n");
}
