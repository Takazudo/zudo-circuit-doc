#!/usr/bin/env node
// Negative-path checks for a generated circuit project (examples/empty, and
// the initializer template #24 syncs from it — #32 reuses this script
// unchanged). Every case mutates a throwaway copy of the project and asserts
// the CLI fails the way the epic promises: a clear, honest error naming the
// problem, never a silent pass, a stack trace, or a hang.
//
// Requires `packages/circuit-doc` to be built first (`pnpm build`): every
// case runs the real CLI binary (`packages/circuit-doc/bin/zudo-circuit-doc.js`)
// against the scratch copy, never a mock.
//
// Usage: node scripts/check-example-negatives.mjs <project-dir>

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CLI_BIN = path.join(REPO_ROOT, "packages/circuit-doc/bin/zudo-circuit-doc.js");
const TEMPLATE_BUNDLE_DIR = path.join(REPO_ROOT, "packages/circuit-doc/templates/component-skill-template");

// Never copied into a scratch project: build output, caches and VCS metadata
// that a fresh CLI run neither needs nor should be allowed to mutate.
const COPY_EXCLUDE = new Set(["node_modules", ".git", "dist", ".zfb", ".zfb-build", ".zudo-doc", ".circuit-cache"]);

function usage(message) {
  console.error(`usage: node scripts/check-example-negatives.mjs <project-dir>\n${message ?? ""}`.trim());
  process.exit(2);
}

const projectArg = process.argv[2];
if (!projectArg || process.argv.length > 3) usage("expected exactly one project directory");
const sourceProject = path.resolve(projectArg);
if (!existsSync(sourceProject)) usage(`not a directory: ${projectArg}`);
if (!existsSync(CLI_BIN)) {
  console.error(`missing ${path.relative(REPO_ROOT, CLI_BIN)} — run \`pnpm build\` first`);
  process.exit(1);
}

let failures = 0;
const scratchDirs = [];

function check(label, condition, detail) {
  if (condition) {
    console.log(`PASS: ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL: ${label}`);
  if (detail) console.log(detail.replace(/^/gm, "  "));
}

/** A fresh, isolated copy of the project, for one case to mutate freely. */
function freshProject() {
  const dir = mkdtempSync(path.join(tmpdir(), "circuit-neg-"));
  scratchDirs.push(dir);
  const dest = path.join(dir, "project");
  cpSync(sourceProject, dest, {
    recursive: true,
    filter: (src) => !COPY_EXCLUDE.has(path.basename(src)),
  });
  return dest;
}

function runCli(projectDir, args) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: projectDir,
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  if (result.error) throw result.error;
  return result;
}

function writeJson(file, data) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

// --- case 1: a malformed circuit.config.ts fails as a usage/config error (exit 2) ------------

function caseMalformedConfig() {
  const project = freshProject();
  writeFileSync(path.join(project, "circuit.config.ts"), "export default { this is not valid TypeScript (((\n");
  const result = runCli(project, ["generate"]);
  check(
    "malformed circuit.config.ts exits 2",
    result.status === 2,
    `exit ${result.status}\nstderr:\n${result.stderr}`,
  );
}

// --- case 2: a deleted declared file fails, naming its configured path -----------------------

function caseMissingInventory() {
  const project = freshProject();
  const inventoryPath = ".claude/skills/component-spec-audit/references/inventory.json";
  rmSync(path.join(project, inventoryPath));
  const result = runCli(project, ["generate"]);
  check(
    "deleted inventory.json fails naming its configured path",
    result.status === 1 && result.stderr.includes(inventoryPath),
    `exit ${result.status}\nstderr:\n${result.stderr}`,
  );
}

// --- case 3: a selection naming an unknown record is STALE_SELECTION -------------------------

function caseStaleSelection() {
  const project = freshProject();
  const selectionPath = path.join(project, "circuit/publication/selection.json");
  writeJson(selectionPath, {
    schema_version: 1,
    recordIds: ["rec-ghost"],
    sourceIds: ["src-ghost"],
    linkableSourceIds: ["src-ghost"],
    documentSelections: [{ recordId: "rec-ghost", sourceId: "src-ghost", documentKind: "datasheet" }],
    expect: { records: 1, sources: 1, integrationRules: 0, packages: 0 },
  });
  const result = runCli(project, ["generate"]);
  check(
    "selection naming an unknown record fails STALE_SELECTION",
    result.status === 1 && result.stderr.includes("STALE_SELECTION"),
    `exit ${result.status}\nstderr:\n${result.stderr}`,
  );
}

// --- case 4: a malformed owner-bundle JSON file fails cleanly (FAIL, no traceback) ------------

function caseMalformedBundleJson() {
  const project = freshProject();
  const ownerSkill = "component-neg-json";
  const ownerDir = path.join(project, ".claude/skills", ownerSkill);
  cpSync(TEMPLATE_BUNDLE_DIR, ownerDir, { recursive: true });
  // Corrupt one bundle file's JSON syntax — the failure must surface before
  // any of its (still-placeholder) content is ever inspected.
  writeFileSync(path.join(ownerDir, "manifest.json"), "{ not valid json ");

  const inventoryPath = path.join(project, ".claude/skills/component-spec-audit/references/inventory.json");
  writeJson(inventoryPath, {
    schema_version: 1,
    generator_specs: [],
    assertions: { orderable_lines: 1, fitted_lines: 1, dnp_or_hand_fit_lines: 0 },
    exclusions: [],
    lines: [
      {
        line_id: "line-neg-json",
        mpn: "NEG-TEST-PART",
        manufacturer: "Neg Test",
        lcsc: "",
        package: "TEST-PKG",
        dnp: false,
        owner_skill: ownerSkill,
        identity_state: "UNRESOLVED",
        source_state: "SOURCE UNAVAILABLE",
        function: "check-example-negatives fixture",
        placements: [],
      },
    ],
  });

  const result = runCli(project, ["validate"]);
  check(
    "malformed owner-bundle JSON FAILs cleanly (no traceback)",
    result.status === 1 && !/Traceback/.test(result.stdout + result.stderr),
    `exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

// --- case 5: a hand-authored file inside the generated components tree is an ownership conflict

function caseHandAuthoredInGeneratedTree() {
  const project = freshProject();
  const generatedRoot = path.join(project, "doc/src/content/docs/components");
  mkdirSync(generatedRoot, { recursive: true });
  writeFileSync(
    path.join(generatedRoot, "rogue.mdx"),
    "---\ntitle: Rogue\n---\n\nHand-authored content that the generator does not own.\n",
  );
  const result = runCli(project, ["generate"]);
  check(
    "hand-authored file inside the generated tree is PATH_CONTAINMENT",
    result.status === 1 && result.stderr.includes("PATH_CONTAINMENT"),
    `exit ${result.status}\nstderr:\n${result.stderr}`,
  );
}

function main() {
  try {
    caseMalformedConfig();
    caseMissingInventory();
    caseStaleSelection();
    caseMalformedBundleJson();
    caseHandAuthoredInGeneratedTree();
  } finally {
    for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.log(`FAIL: check-example-negatives; ${failures} case(s) failed`);
    process.exit(1);
  }
  console.log(`PASS: check-example-negatives; 5 case(s) checked against ${path.relative(process.cwd(), sourceProject) || "."}`);
}

main();
