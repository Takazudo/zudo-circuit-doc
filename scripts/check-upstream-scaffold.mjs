#!/usr/bin/env node
// Upstream-scaffold parity check (ADR-002): proves the doc host files vendored
// into examples/empty/doc are still what the pinned root devDependency
// `create-zudo-doc` actually generates, catching silent drift the day that
// pin is bumped.
//
// How it works: `createZudoDoc()` is called programmatically in a scratch
// directory with a plain default project (no circuit-doc-specific options),
// producing a fresh copy of the upstream scaffold. The upstream-owned files
// this project vendors are then diffed against it, allowing only the
// documented one-line additions (ADR-015, ADR-016) this project layers on
// top. Everything else must be byte-identical.
//
// This never writes to examples/empty — it only reports. It is also run as
// a CI job (ci-template.yml).
//
// Refreshing the scaffold after a create-zudo-doc version bump:
//   1. Bump the `create-zudo-doc` devDependency pin in the root package.json
//      and run `pnpm install`.
//   2. Run `pnpm check:upstream-scaffold`. Every reported line names a file
//      and, for package.json, a dependency; update examples/empty/doc to
//      match, re-applying the ADR-015/ADR-016 additions on top.
//   3. Update ZUDO_DEPS_PINS.md's create-zudo-doc entry (pinned commit,
//      updated date) — `/dev-bump-zudo-deps` does this and the parity check
//      the same way.
//   4. Re-run `pnpm sync:template` so packages/create-zudo-circuit-doc's
//      template picks up the refreshed fixture.

import { realpathSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = resolve(SCRIPT_DIR, "..");
export const EXAMPLE_DOC_DIR = join(ROOT_DIR, "examples", "empty", "doc");

// The 11 features create-zudo-doc@5.27.0 enables by default (constants.ts
// FEATURES.filter(f => f.default)), in that order. `create-zudo-doc`'s
// package.json `exports` only publishes "." (dist/api.js), so this list
// cannot be imported from the package itself and must be kept in sync by
// hand against the pinned version — the same constraint recorded in
// epic #1 planning note planning/explore/zudo-doc-host.md (removed from the tree
// in #34; in git history).
export const DEFAULT_FEATURES = [
  "search",
  "sidebarFilter",
  "sidebarResizer",
  "sidebarToggle",
  "tocToggle",
  "docHistory",
  "llmsTxt",
  "imageEnlarge",
  "assetViewer",
  "dynamicPageTransition",
  "footerCopyright",
];

// ADR-016: this project's docs route stub adds one static islands import,
// immediately after the upstream stub's own last import line, so the
// islands module's side-effecting registrations run before the page renders.
const ISLANDS_IMPORT_LINE = 'import "../lib/_circuit-doc-islands";\n';

// ADR-015: this project's global.css imports the runtime package's
// unlayered styles right after the upstream `features.css` import.
const PACKAGE_CSS_BLOCK =
  '\n/* ADR-015: the package\'s unlayered styles, imported after the zudo-doc CSS. */\n' +
  '@import "@takazudo/zudo-circuit-doc/styles.css";\n';

// Dependencies whose *version* is intentionally not diffed: ADR-003 pins
// this project's own zfb/zudo-doc/zudo-doc-history-server family exactly
// (CLAUDE.md's version table), independent of whatever version the pinned
// create-zudo-doc happens to scaffold with. Presence is still required.
const VERSION_EXEMPT_DEPENDENCIES = new Set([
  "@takazudo/zfb",
  "@takazudo/zfb-runtime",
  "@takazudo/zfb-md-wasm",
  "@takazudo/zudo-doc",
  "@takazudo/zudo-doc-history-server",
]);

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies"];

// Files diffed byte-for-byte with no allowed differences.
const EXACT_FILES = ["pages/index.tsx", "tsconfig.json", "scripts/check-links.js"];

/**
 * Generate a fresh copy of the upstream scaffold in a scratch directory by
 * calling the pinned `create-zudo-doc` package's programmatic API.
 *
 * `createZudoDoc` resolves its target directory from `process.cwd()`
 * (upstream `utils.ts`), so this chdirs into the scratch root for the
 * duration of the call and always restores the original cwd, even on
 * failure. That makes this function process-global-unsafe to call
 * concurrently with itself — fine here, since nothing else in this repo's
 * scripts touches `process.cwd()`.
 *
 * @param {{scratchRoot: string, projectName?: string}} options
 * @returns {Promise<string>} absolute path to the generated project
 */
export async function generateUpstreamScaffold({
  scratchRoot,
  projectName = "upstream-scaffold-probe",
}) {
  const { createZudoDoc } = await import("create-zudo-doc");
  const originalCwd = process.cwd();
  process.chdir(scratchRoot);
  try {
    return await createZudoDoc({
      projectName,
      defaultLang: "en",
      features: DEFAULT_FEATURES,
      packageManager: "pnpm",
    });
  } finally {
    process.chdir(originalCwd);
  }
}

/**
 * @param {string} label
 * @param {Buffer} expected upstream content
 * @param {Buffer} actual examples/empty/doc content
 * @returns {string[]} drift messages (empty when they match)
 */
function diffExact(label, expected, actual) {
  if (expected.equals(actual)) return [];
  return [`${label}: content differs from the upstream scaffold.`];
}

/**
 * Diff a file that this project is allowed to extend with one documented,
 * literal addition. The addition is stripped from `actual` before comparing;
 * if it isn't present exactly once, that itself is reported as drift so an
 * accidentally-removed (or duplicated) addition is never silently accepted.
 *
 * @param {string} label
 * @param {Buffer} expected
 * @param {Buffer} actual
 * @param {string} allowedAddition
 * @returns {string[]}
 */
function diffWithAllowedAddition(label, expected, actual, allowedAddition) {
  const actualText = actual.toString("utf8");
  const occurrences = actualText.split(allowedAddition).length - 1;
  if (occurrences !== 1) {
    return [
      `${label}: expected exactly one occurrence of the documented addition ` +
        `${JSON.stringify(allowedAddition)}; found ${occurrences}.`,
    ];
  }
  const reconstructed = Buffer.from(actualText.replace(allowedAddition, ""));
  return diffExact(label, expected, reconstructed);
}

/**
 * @param {Buffer} upstreamPackageJsonText
 * @param {Buffer} examplePackageJsonText
 * @returns {string[]}
 */
function diffDependencyPins(upstreamPackageJsonText, examplePackageJsonText) {
  const upstream = JSON.parse(upstreamPackageJsonText.toString("utf8"));
  const example = JSON.parse(examplePackageJsonText.toString("utf8"));
  const messages = [];

  for (const field of DEPENDENCY_FIELDS) {
    const upstreamDeps = upstream[field] ?? {};
    const exampleDeps = example[field] ?? {};
    for (const [name, upstreamSpec] of Object.entries(upstreamDeps)) {
      const exampleSpec = exampleDeps[name];
      if (exampleSpec === undefined) {
        messages.push(`doc/package.json: missing ${field}.${name} (upstream pins ${upstreamSpec}).`);
        continue;
      }
      if (VERSION_EXEMPT_DEPENDENCIES.has(name)) continue; // ADR-003 owns this pin.
      if (exampleSpec !== upstreamSpec) {
        messages.push(
          `doc/package.json: ${field}.${name} is ${exampleSpec}, upstream pins ${upstreamSpec}.`,
        );
      }
    }
  }
  return messages;
}

/**
 * @param {{upstreamDir: string, exampleDocDir?: string}} options
 * @returns {Promise<{drift: string[], notes: string[]}>}
 */
export async function checkUpstreamScaffold({ upstreamDir, exampleDocDir = EXAMPLE_DOC_DIR }) {
  const drift = [];

  for (const relativePath of EXACT_FILES) {
    const [upstreamContent, exampleContent] = await Promise.all([
      readFile(join(upstreamDir, relativePath)),
      readFile(join(exampleDocDir, relativePath)),
    ]);
    drift.push(...diffExact(relativePath, upstreamContent, exampleContent));
  }

  {
    const relativePath = "pages/docs/[[...slug]].tsx";
    const [upstreamContent, exampleContent] = await Promise.all([
      readFile(join(upstreamDir, relativePath)),
      readFile(join(exampleDocDir, relativePath)),
    ]);
    drift.push(
      ...diffWithAllowedAddition(relativePath, upstreamContent, exampleContent, ISLANDS_IMPORT_LINE),
    );
  }

  {
    const relativePath = "src/styles/global.css";
    const [upstreamContent, exampleContent] = await Promise.all([
      readFile(join(upstreamDir, relativePath)),
      readFile(join(exampleDocDir, relativePath)),
    ]);
    drift.push(
      ...diffWithAllowedAddition(relativePath, upstreamContent, exampleContent, PACKAGE_CSS_BLOCK),
    );
  }

  {
    const [upstreamContent, exampleContent] = await Promise.all([
      readFile(join(upstreamDir, "package.json")),
      readFile(join(exampleDocDir, "package.json")),
    ]);
    drift.push(...diffDependencyPins(upstreamContent, exampleContent));
  }

  const notes = [];
  for (const relativePath of [".npmrc", "pnpm-workspace.yaml"]) {
    const content = await readFile(join(upstreamDir, relativePath), "utf8").catch(() => null);
    if (content !== null) {
      notes.push(
        `${relativePath}: not vendored — its settings moved to the root pnpm-workspace.yaml (ADR-003).`,
      );
    }
  }

  return { drift, notes };
}

export async function main() {
  const scratchRoot = await mkdtemp(join(tmpdir(), "check-upstream-scaffold-"));
  try {
    const upstreamDir = await generateUpstreamScaffold({ scratchRoot });
    const { drift, notes } = await checkUpstreamScaffold({ upstreamDir });

    for (const note of notes) console.log(note);

    if (drift.length > 0) {
      console.error("Upstream scaffold drift detected:");
      for (const line of drift) console.error(`  ${line}`);
      console.error(
        "Update examples/empty/doc to match (see this script's header for the refresh procedure).",
      );
      return 1;
    }

    console.log("OK — examples/empty/doc matches the pinned create-zudo-doc scaffold.");
    return 0;
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
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
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
