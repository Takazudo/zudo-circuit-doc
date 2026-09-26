#!/usr/bin/env node
// Keep packages/create-zudo-circuit-doc/templates/default in lockstep with the
// tested examples/empty fixture. The fixture is the executable source of
// truth: this script only applies the few changes needed to turn a concrete,
// buildable example into a starter a user's `create-zudo-circuit-doc` run can
// install and rename (adapted from zudo-sg's
// scripts/sync-create-zudo-sg-template.mjs @ b9b36ce).
//
// Usage:
//   pnpm sync:template
//   pnpm check:template
//
// `--check` never writes. It compares the generated tree with the committed
// template and reports every missing, extra, or changed path.

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = resolve(SCRIPT_DIR, "..");
export const SOURCE_DIR = join(ROOT_DIR, "examples", "empty");
export const TARGET_DIR = join(
  ROOT_DIR,
  "packages",
  "create-zudo-circuit-doc",
  "templates",
  "default",
);
export const RUNTIME_PACKAGE_PATH = join(ROOT_DIR, "packages", "circuit-doc", "package.json");

const EXACT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

const SKIPPED_NAMES = new Set([
  "node_modules",
  "dist",
  ".zfb",
  ".zfb-build",
  ".zudo-doc",
  ".circuit-cache",
  "pnpm-lock.yaml",
  ".git",
]);
const SKIPPED_FILE_PATTERNS = [
  /^\.zfb-esbuild-entry-.*\.tsx$/u,
  /^\.zfb-islands-tsconfig-.*\.json$/u,
  /^\.zfb-virtual-.*\.mjs$/u,
];

// Files carrying these extensions are binary (or, for .svg, text but never
// carrying a sentinel) and are copied byte-for-byte, skipping sentinel scans
// entirely. Kept identical to create-zudo-circuit-doc's own scaffold.ts
// BINARY_EXTENSIONS so a file that the CLI would copy raw is never scanned
// here either.
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

// Sentinel -> placeholder, longest token first. Ordering matters: a shorter
// token that is a textual prefix of a longer one (e.g. "example-empty-circuit"
// is a prefix of "example-empty-circuit-lib") must be replaced only after the
// longer token has already been swapped out, or the shorter pass would mangle
// it into "__PROJECT_NAME__-lib" instead of "__LIBRARY_NAME__".
//
// `expectedFiles` is the exact allowlist of source-relative paths the
// sentinel is known to live in (from the fixture as it stands today). A
// sentinel missing from one of these files, or found in a file outside this
// list, fails the sync loudly instead of silently drifting.
const SENTINELS = [
  {
    token: "example-empty-circuit-doc",
    replacement: "__PROJECT_NAME__-doc",
    expectedFiles: ["doc/package.json"],
  },
  {
    token: "example-empty-circuit-lib",
    replacement: "__LIBRARY_NAME__",
    expectedFiles: ["circuit.config.ts"],
  },
  {
    token: "example-empty-circuit",
    replacement: "__PROJECT_NAME__",
    expectedFiles: ["package.json", "circuit.config.ts"],
  },
  {
    token: "Example Empty Circuit",
    replacement: "__SITE_TITLE__",
    expectedFiles: ["circuit.config.ts", "doc/zfb.config.ts"],
  },
];

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

// There is no pnpm-workspace.yaml in examples/empty: the example is a nested
// workspace member of this monorepo's own root pnpm-workspace.yaml, but a
// generated project stands alone and needs its own. Per ADR-003 every pnpm
// setting lives here and the template ships no .npmrc.
//
// create-zudo-doc 5.27.0's own scaffold also ships a .npmrc with
// `trust-policy-exclude[]=undici-types@6.21.0`. Verified with a real `pnpm
// install` of this exact dependency set under pnpm 11.5.2: pnpm's
// `trustPolicy` is off by default and this template never turns it on, so
// the exclusion has nothing to attach to and is intentionally omitted here —
// add a `trustPolicyExclude` entry if a future template opts into
// `trustPolicy`.
const GENERATED_WORKSPACE_YAML = `packages: ["doc"]
# pnpm 11 defaults minimumReleaseAge to 1440min. The exclude matcher can't
# match a fresh install's peer-nested lockfile keys (upstream pnpm bug), the
# same reason create-zudo-doc 5.27.0's own scaffold disables the gate
# outright instead of excluding specific packages. Revisit once that's fixed
# and this project is ready to publish.
minimumReleaseAge: 0
allowBuilds:
  esbuild: true
`;

/** @typedef {Map<string, Buffer>} TemplateTree */

/**
 * Read the examples/empty fixture and apply the starter-only transforms in
 * memory: sentinel-to-placeholder substitution, package.json version/
 * workspace-spec rewrites, and the synthesized pnpm-workspace.yaml.
 *
 * @param {{sourceDir?: string, runtimePackagePath?: string}} [options]
 * @returns {Promise<TemplateTree>}
 */
export async function buildTemplate({
  sourceDir = SOURCE_DIR,
  runtimePackagePath = RUNTIME_PACKAGE_PATH,
} = {}) {
  const runtimePackage = JSON.parse(await readFile(runtimePackagePath, "utf8"));
  const runtimeVersion = exactVersion(
    runtimePackage.version,
    `version in ${relative(ROOT_DIR, runtimePackagePath)}`,
  );

  /** @type {TemplateTree} */
  const files = new Map();
  /** @type {Map<string, Set<string>>} */
  const sentinelHits = new Map(SENTINELS.map((sentinel) => [sentinel.token, new Set()]));

  const visible = gitVisibleFiles(sourceDir);
  await collectFiles(files, sourceDir, "", runtimeVersion, sentinelHits, visible);
  checkSentinelCoverage(sentinelHits);

  if (files.has("pnpm-workspace.yaml")) {
    throw new Error(
      "examples/empty already has a pnpm-workspace.yaml; sync-create-template.mjs " +
        "no longer needs to synthesize one — update GENERATED_WORKSPACE_YAML handling.",
    );
  }
  files.set("pnpm-workspace.yaml", Buffer.from(GENERATED_WORKSPACE_YAML));

  return new Map([...files.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * @param {string} version
 * @param {string} description
 * @returns {string}
 */
function exactVersion(version, description) {
  if (typeof version !== "string" || !EXACT_SEMVER.test(version)) {
    throw new Error(`Expected an exact semver for ${description}; received ${String(version)}`);
  }
  return version;
}

/**
 * @param {TemplateTree} files
 * @param {string} directory
 * @param {string} relativeDirectory
 * @param {string} runtimeVersion
 * @param {Map<string, Set<string>>} sentinelHits
 */
/**
 * Files git would track under `directory` (tracked + untracked-not-ignored), so
 * build output the fixture's .gitignore excludes (e.g. zudo-doc's generated
 * doc/src/content/docs/claude*\/ mirror) never leaks into the template.
 * Returns null outside a git work tree (sandboxed tests), meaning "no filter".
 * @param {string} directory
 * @returns {Set<string> | null}
 */
function gitVisibleFiles(directory) {
  try {
    const out = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."],
      { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return new Set(out.split("\0").filter(Boolean));
  } catch {
    return null;
  }
}

async function collectFiles(files, directory, relativeDirectory, runtimeVersion, sentinelHits, visible = null) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (
      SKIPPED_NAMES.has(entry.name) ||
      SKIPPED_FILE_PATTERNS.some((pattern) => pattern.test(entry.name))
    ) {
      continue;
    }

    const sourcePath = join(directory, entry.name);
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;

    if (entry.isSymbolicLink()) {
      throw new Error(`Symlinks are not supported in examples/empty: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      await collectFiles(files, sourcePath, relativePath, runtimeVersion, sentinelHits, visible);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported fixture entry: ${sourcePath}`);
    }
    if (visible && !visible.has(relativePath)) continue;

    const targetPath = relativePath === ".gitignore" ? "_gitignore" : relativePath;
    const source = await readFile(sourcePath);
    files.set(
      targetPath,
      transformFile(relativePath, source, runtimeVersion, sentinelHits),
    );
  }
}

/**
 * @param {string} relativePath
 * @param {Buffer} source
 * @param {string} runtimeVersion
 * @param {Map<string, Set<string>>} sentinelHits
 * @returns {Buffer}
 */
function transformFile(relativePath, source, runtimeVersion, sentinelHits) {
  const ext = relativePath.includes(".")
    ? relativePath.slice(relativePath.lastIndexOf(".")).toLowerCase()
    : "";
  if (BINARY_EXTENSIONS.has(ext)) {
    return source;
  }

  const text = applySentinels(relativePath, source.toString("utf8"), sentinelHits);

  if (relativePath === "package.json" || relativePath === "doc/package.json") {
    return transformPackageJson(relativePath, text, runtimeVersion);
  }

  return Buffer.from(text);
}

/**
 * @param {string} relativePath
 * @param {string} text
 * @param {Map<string, Set<string>>} sentinelHits
 * @returns {string}
 */
function applySentinels(relativePath, text, sentinelHits) {
  let result = text;
  for (const { token, replacement } of SENTINELS) {
    if (result.includes(token)) {
      sentinelHits.get(token).add(relativePath);
      result = result.split(token).join(replacement);
    }
  }
  return result;
}

/**
 * @param {Map<string, Set<string>>} sentinelHits
 */
function checkSentinelCoverage(sentinelHits) {
  for (const sentinel of SENTINELS) {
    const hits = sentinelHits.get(sentinel.token);
    for (const expectedFile of sentinel.expectedFiles) {
      if (!hits.has(expectedFile)) {
        throw new Error(
          `Expected sentinel "${sentinel.token}" in ${expectedFile}, but it was not found.`,
        );
      }
    }
    for (const hitFile of hits) {
      if (!sentinel.expectedFiles.includes(hitFile)) {
        throw new Error(
          `Sentinel "${sentinel.token}" found in unexpected file ${hitFile} ` +
            `(expected only in: ${sentinel.expectedFiles.join(", ")}).`,
        );
      }
    }
  }
}

/**
 * @param {string} relativePath
 * @param {string} text
 * @param {string} runtimeVersion
 * @returns {Buffer}
 */
function transformPackageJson(relativePath, text, runtimeVersion) {
  const packageJson = JSON.parse(text);

  if (relativePath === "package.json") {
    packageJson.version = "0.1.0";
  }

  let sawRuntimeWorkspaceSpec = false;
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = packageJson[field];
    if (!dependencies || typeof dependencies !== "object") continue;
    for (const [name, spec] of Object.entries(dependencies)) {
      if (typeof spec !== "string") continue;
      if (spec.startsWith("file:")) {
        throw new Error(`${relativePath}: unexpected "file:" spec for ${name} (${spec}).`);
      }
      if (!spec.startsWith("workspace:")) continue;
      if (name === "@takazudo/zudo-circuit-doc" && spec === "workspace:*") {
        dependencies[name] = `^${runtimeVersion}`;
        sawRuntimeWorkspaceSpec = true;
        continue;
      }
      throw new Error(
        `${relativePath}: unexpected "workspace:" spec for ${name} (${spec}); only ` +
          '@takazudo/zudo-circuit-doc: "workspace:*" is rewritten.',
      );
    }
  }
  if (relativePath === "package.json" && !sawRuntimeWorkspaceSpec) {
    throw new Error(
      `${relativePath}: missing the expected "@takazudo/zudo-circuit-doc": "workspace:*" dependency.`,
    );
  }

  return Buffer.from(`${JSON.stringify(packageJson, null, 2)}\n`);
}

/**
 * Read a generated/committed tree. A missing directory is represented by an
 * empty map so --check can report every expected path instead of failing on
 * the first missing file.
 *
 * @param {string} directory
 * @returns {Promise<TemplateTree>}
 */
export async function readTemplateTree(directory) {
  /** @type {TemplateTree} */
  const files = new Map();
  try {
    await collectExistingFiles(files, directory, "");
  } catch (error) {
    if (isMissingPathError(error)) return files;
    throw error;
  }
  return new Map([...files.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * @param {TemplateTree} files
 * @param {string} directory
 * @param {string} relativeDirectory
 */
async function collectExistingFiles(files, directory, relativeDirectory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = join(directory, entry.name);
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await collectExistingFiles(files, filePath, relativePath);
    } else if (entry.isFile()) {
      files.set(relativePath, await readFile(filePath));
    } else {
      throw new Error(`Unsupported template entry: ${filePath}`);
    }
  }
}

/**
 * Return changed paths in a deterministic order.
 *
 * @param {TemplateTree} expected
 * @param {TemplateTree} current
 * @returns {string[]}
 */
export function diffTemplateTrees(expected, current) {
  const paths = new Set([...expected.keys(), ...current.keys()]);
  return [...paths]
    .sort()
    .filter((path) => {
      const expectedContent = expected.get(path);
      const currentContent = current.get(path);
      if (!expectedContent || !currentContent) return true;
      return !expectedContent.equals(currentContent);
    });
}

/**
 * @param {TemplateTree} expected
 * @param {string} targetDir
 */
async function writeTemplate(expected, targetDir) {
  // The destination is entirely generated. Replacing it makes stale files
  // disappear and keeps the committed tree exactly equal to the source tree.
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await Promise.all(
    [...expected.entries()].map(async ([relativePath, content]) => {
      const targetPath = join(targetDir, ...relativePath.split("/"));
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content);
    }),
  );
}

function isMissingPathError(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/**
 * @param {{check?: boolean, sourceDir?: string, targetDir?: string, runtimePackagePath?: string}} [options]
 */
export async function syncTemplate({
  check = false,
  sourceDir = SOURCE_DIR,
  targetDir = TARGET_DIR,
  runtimePackagePath = RUNTIME_PACKAGE_PATH,
} = {}) {
  const expected = await buildTemplate({ sourceDir, runtimePackagePath });
  const current = await readTemplateTree(targetDir);
  const driftedPaths = diffTemplateTrees(expected, current);

  if (check) {
    if (driftedPaths.length > 0) {
      console.error("create-zudo-circuit-doc template drift detected:");
      for (const path of driftedPaths) console.error(`  ${path}`);
      console.error("Run `pnpm sync:template` to regenerate it.");
      return 1;
    }
    console.log("OK — template is up to date.");
    return 0;
  }

  if (driftedPaths.length === 0) {
    console.log("create-zudo-circuit-doc template already up to date; no change.");
    return 0;
  }

  await writeTemplate(expected, targetDir);
  console.log(`Wrote create-zudo-circuit-doc template (${expected.size} files).`);
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  const unknown = argv.filter((argument) => argument !== "--check");
  if (unknown.length > 0) {
    throw new Error(`Unknown argument: ${unknown.join(" ")}`);
  }
  return syncTemplate({ check: argv.includes("--check") });
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  main().then(
    (status) => {
      process.exitCode = status;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
