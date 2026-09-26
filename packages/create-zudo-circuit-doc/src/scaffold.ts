import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "./errors.ts";
import type { Plan } from "./plan.ts";

// Files carrying these extensions are copied byte-for-byte: they are either
// binary (previews, 3D models, fonts) or, in the case of .svg, listed
// explicitly by the spec as skipped even though it is text (spec #6).
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".svg",
  ".wrl",
  ".step",
  ".stp",
  ".pdf",
  ".zip",
  ".gz",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
]);

const PLACEHOLDER_TOKENS = [
  "__PROJECT_NAME__",
  "__SITE_TITLE__",
  "__LIBRARY_NAME__",
] as const;

export interface PlaceholderValues {
  __PROJECT_NAME__: string;
  __SITE_TITLE__: string;
  __LIBRARY_NAME__: string;
}

export function placeholdersFromPlan(plan: Plan): PlaceholderValues {
  return {
    __PROJECT_NAME__: plan.name,
    __SITE_TITLE__: plan.title,
    __LIBRARY_NAME__: plan.library,
  };
}

/** Throws a CliError, unchanged, if the destination exists and is not empty (spec #4). There is no force flag. */
export function checkDestinationCollision(destinationPath: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(destinationPath);
  } catch {
    return; // Missing destination is fine.
  }
  if (!stat.isDirectory()) {
    throw new CliError(
      `Cannot create project: "${destinationPath}" already exists and is not a directory.`,
    );
  }
  const entries = fs.readdirSync(destinationPath);
  if (entries.length > 0) {
    throw new CliError(
      `Cannot create project: "${destinationPath}" already exists and is not empty.`,
    );
  }
}

function resolveTemplateDirPath(templateDir: URL | string): string {
  return typeof templateDir === "string" ? templateDir : fileURLToPath(templateDir);
}

function substitutePlaceholders(text: string, values: PlaceholderValues): string {
  let result = text;
  for (const token of PLACEHOLDER_TOKENS) {
    result = result.replaceAll(token, values[token]);
  }
  return result;
}

function copyTemplateTree(
  sourceDir: string,
  targetDir: string,
  values: PlaceholderValues,
  beforeCopyFile: ((relPath: string) => void) | undefined,
  relPath: string,
): void {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const entryRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;
    const sourcePath = path.join(sourceDir, entry.name);
    const targetName = entry.name === "_gitignore" ? ".gitignore" : entry.name;
    const targetPath = path.join(targetDir, targetName);

    if (entry.isDirectory()) {
      copyTemplateTree(sourcePath, targetPath, values, beforeCopyFile, entryRelPath);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported template entry (not a file or directory): ${entryRelPath}`);
    }

    beforeCopyFile?.(entryRelPath);

    const stat = fs.statSync(sourcePath);
    const ext = path.extname(entry.name).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      fs.copyFileSync(sourcePath, targetPath);
    } else {
      const contents = fs.readFileSync(sourcePath, "utf8");
      fs.writeFileSync(targetPath, substitutePlaceholders(contents, values), "utf8");
    }
    fs.chmodSync(targetPath, stat.mode);
  }
}

function assertNoPlaceholdersRemain(dir: string, relPath = ""): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      assertNoPlaceholdersRemain(entryPath, entryRelPath);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) continue;
    const contents = fs.readFileSync(entryPath, "utf8");
    for (const token of PLACEHOLDER_TOKENS) {
      if (contents.includes(token)) {
        throw new Error(`Placeholder ${token} was not replaced in generated file: ${entryRelPath}`);
      }
    }
  }
}

/** claude removes AGENTS.md, codex removes CLAUDE.md, none removes both, both removes neither (spec #6). `.claude/skills/**` is never touched here, so it always stays. */
function applyAgentFilter(dir: string, agent: Plan["agent"]): void {
  const removeIfExists = (name: string): void => {
    const target = path.join(dir, name);
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  };
  if (agent === "claude") removeIfExists("AGENTS.md");
  else if (agent === "codex") removeIfExists("CLAUDE.md");
  else if (agent === "none") {
    removeIfExists("AGENTS.md");
    removeIfExists("CLAUDE.md");
  }
}

export interface ComposeParams {
  plan: Plan;
  templateDir: URL | string;
  randomSuffix: () => string;
  /** Test-only seam: called before each file is copied; throwing simulates a mid-copy failure. */
  beforeCopyFile?: (relPath: string) => void;
}

/**
 * Composes the project into a sibling staging directory, then renames it
 * onto the destination in one atomic step (spec #6). On any failure the
 * staging directory is removed and the destination is left untouched.
 */
export function composeProject(params: ComposeParams): void {
  const { plan, templateDir, randomSuffix, beforeCopyFile } = params;
  const sourceDir = resolveTemplateDirPath(templateDir);
  // An existing (empty) destination is filled in place: renaming over it would
  // swap the directory inode out from under a shell whose cwd is that directory.
  const destinationExists = fs.existsSync(plan.destinationPath);
  const stagingDir = path.join(
    destinationExists ? plan.destinationPath : path.dirname(plan.destinationPath),
    `.create-zudo-circuit-doc-staging-${randomSuffix()}`,
  );

  try {
    copyTemplateTree(sourceDir, stagingDir, placeholdersFromPlan(plan), beforeCopyFile, "");
    assertNoPlaceholdersRemain(stagingDir);
    applyAgentFilter(stagingDir, plan.agent);
    if (destinationExists) {
      for (const entry of fs.readdirSync(stagingDir)) {
        fs.renameSync(path.join(stagingDir, entry), path.join(plan.destinationPath, entry));
      }
      fs.rmdirSync(stagingDir);
    } else {
      fs.renameSync(stagingDir, plan.destinationPath);
    }
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw new CliError(
      `Failed to create project at "${plan.destinationPath}": ${(error as Error).message}`,
    );
  }
}
