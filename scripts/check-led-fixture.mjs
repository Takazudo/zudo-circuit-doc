#!/usr/bin/env node
// The LED regression harness (#21, M2 acceptance).
//
// Drives the packaged engine, through the BUILT `zudo-circuit-doc` CLI and
// only via fixtures/led/circuit.config.ts, against the pinned
// fixtures/led/upstream corpus, and proves the output reproduces the pinned
// goldens byte for byte — except the one deliberate difference recorded in
// fixtures/led/expected/ (see EXPECTED-CHANGES.md).
//
// Requires `pnpm build` to have already run (reads packages/circuit-doc/lib)
// and STEP to be materialized (`pnpm fixtures:led:materialize`).
//
// Also available as `pnpm test:led` (chained with the LED-corpus TS suite, #26).
//
// Steps:
//   1. assert STEP is materialized (actionable error otherwise)
//   2. assert circuit/selection.json and circuit/document-verification.json
//      are faithful ports of the pinned upstream selection.ts literal
//   3. assert expected/doc/component-docs/preflight.json differs from
//      upstream/doc/component-docs/preflight.json in exactly viewModelVersion
//   4. copy fixtures/led/ into a mkdtemp scratch dir, then run the built CLI
//      there: validate -> generate (+ byte-compare against the goldens) ->
//      check -> models --check -> footprints check
//   5. assert the real fixture tree was not touched

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { checkFixture } from "./sync-led-fixture.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const FIXTURE_DIR = path.join(REPO_ROOT, "fixtures/led");
const BIN_ENTRY = path.join(REPO_ROOT, "packages/circuit-doc/bin/zudo-circuit-doc.js");
// `bin/` is committed and only imports the gitignored build output, so probe that.
const CLI_BUILT = path.join(REPO_ROOT, "packages/circuit-doc/lib/cli/main.js");
const GENERATED_REL = "doc/src/content/docs/components";
const PREFLIGHT_REL = "doc/component-docs/preflight.json";

const EXIT = { PASS: 0, FAILED: 1 };

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

// ---- 1. STEP materialization -----------------------------------------------

function assertStepMaterialized() {
  const result = checkFixture({ fixtureDir: FIXTURE_DIR });
  if (!result.ok) {
    throw new Error(`fixtures/led lock check failed:\n${result.problems.map((p) => `  ${p}`).join("\n")}`);
  }
  if (result.materializedCount < result.materializedTotal) {
    throw new Error(
      `STEP is not materialized (${result.materializedCount}/${result.materializedTotal} files); ` +
        "run `pnpm fixtures:led:materialize` (optionally --from-git $HOME/repos/circuits/zudo-led-lamp) first",
    );
  }
}

// ---- 2. selection.json / document-verification.json port check ------------

async function assertSelectionPortsAreFaithful() {
  const tsPath = path.join(FIXTURE_DIR, "upstream/doc/component-docs/adapters/circuit/selection.ts");
  const mod = await import(pathToFileURL(tsPath).href);
  const selection = mod.CIRCUIT_SELECTION;

  assert.deepStrictEqual(
    readJson(path.join(FIXTURE_DIR, "circuit/selection.json")),
    {
      schema_version: 1,
      recordIds: selection.recordIds,
      sourceIds: selection.sourceIds,
      linkableSourceIds: selection.linkableSourceIds,
      documentSelections: selection.documentSelections,
      // The pinned .ts literal predates ADR-012's `expect.packages` lock; #20
      // fixed the reviewed LED package count at 25.
      expect: { ...selection.expect, packages: 25 },
    },
    "fixtures/led/circuit/selection.json has drifted from the pinned upstream selection.ts literal",
  );

  const verification = mod.CIRCUIT_DOCUMENT_VERIFICATION;
  assert.deepStrictEqual(
    readJson(path.join(FIXTURE_DIR, "circuit/document-verification.json")),
    {
      schema_version: 1,
      checkedOn: verification.checkedOn,
      expectedContent: verification.expectedContent,
      downloadedPdfSourceIds: verification.downloadedPdfSourceIds,
      officialPdfContentSourceIds: verification.officialPdfContentSourceIds,
    },
    "fixtures/led/circuit/document-verification.json has drifted from the pinned CIRCUIT_DOCUMENT_VERIFICATION literal",
  );
}

// ---- 3. expected preflight diff is exactly viewModelVersion ----------------

function assertExpectedPreflightDiffIsOnlyViewModelVersion() {
  const upstream = readJson(path.join(FIXTURE_DIR, "upstream", PREFLIGHT_REL));
  const expected = readJson(path.join(FIXTURE_DIR, "expected", PREFLIGHT_REL));
  assert.deepStrictEqual(
    Object.keys(expected),
    Object.keys(upstream),
    "expected/doc/component-docs/preflight.json must have the same key set as upstream",
  );
  const differing = Object.keys(upstream).filter(
    (key) => JSON.stringify(upstream[key]) !== JSON.stringify(expected[key]),
  );
  assert.deepStrictEqual(
    differing,
    ["viewModelVersion"],
    `expected/doc/component-docs/preflight.json must differ from upstream only in viewModelVersion (found: ${differing.join(", ") || "none"})`,
  );
  assert.equal(upstream.viewModelVersion, 1, "upstream preflight.json viewModelVersion must still read 1");
  assert.equal(expected.viewModelVersion, 2, "expected preflight.json viewModelVersion must read 2 (ADR-011/#18)");
}

// ---- 4. drive the built CLI against a scratch copy -------------------------

function runCli(cwd, args) {
  const result = spawnSync(process.execPath, [BIN_ENTRY, "--config", "circuit.config.ts", ...args], {
    cwd,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return { code: result.status ?? EXIT.FAILED, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function assertPass(name, result) {
  if (result.code !== EXIT.PASS) {
    throw new Error(`\`${name}\` failed (exit ${result.code}):\n${result.stdout}${result.stderr}`);
  }
}

function walkFiles(root) {
  const out = [];
  const stack = [""];
  while (stack.length > 0) {
    const rel = stack.pop();
    for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) stack.push(childRel);
      else out.push(childRel);
    }
  }
  return out.sort();
}

function goldenPathFor(relFromUpstream) {
  const overridden = path.join(FIXTURE_DIR, "expected", relFromUpstream);
  return existsSync(overridden) ? overridden : path.join(FIXTURE_DIR, "upstream", relFromUpstream);
}

function unifiedDiff(goldenPath, actualPath) {
  const result = spawnSync("diff", ["-u", goldenPath, actualPath], { encoding: "utf8" });
  return result.stdout || result.stderr || `(diff produced no textual output; exit ${result.status})`;
}

function compareGeneratedOutput(copyDir) {
  const actualRoot = path.join(copyDir, "upstream", GENERATED_REL);
  const goldenRoot = path.join(FIXTURE_DIR, "upstream", GENERATED_REL);
  const actualFiles = walkFiles(actualRoot).map((rel) => `${GENERATED_REL}/${rel}`);
  const goldenFiles = walkFiles(goldenRoot).map((rel) => `${GENERATED_REL}/${rel}`);
  assert.deepStrictEqual(actualFiles, goldenFiles, "generated page set differs from the pinned upstream set");

  const relPaths = [...actualFiles, PREFLIGHT_REL];
  const mismatches = [];
  for (const rel of relPaths) {
    const actualPath = path.join(copyDir, "upstream", rel);
    const goldenPath = goldenPathFor(rel);
    if (!readFileSync(actualPath).equals(readFileSync(goldenPath))) {
      mismatches.push({ rel, goldenPath, actualPath });
    }
  }
  if (mismatches.length > 0) {
    for (const { rel, goldenPath, actualPath } of mismatches) {
      console.error(`--- MISMATCH: ${rel} ---`);
      console.error(unifiedDiff(goldenPath, actualPath));
    }
    throw new Error(`${mismatches.length} generated file(s) differ from the pinned goldens (diffs printed above)`);
  }
  console.log(`ok  generated output: ${actualFiles.length} pages + preflight.json byte-identical to the pinned goldens`);
}

function gitStatusOfFixture() {
  return execFileSync("git", ["status", "--porcelain", "--", "fixtures/led"], { cwd: REPO_ROOT, encoding: "utf8" });
}

async function runHarness() {
  const copyDir = mkdtempSync(path.join(tmpdir(), "led-fixture-check-"));
  try {
    cpSync(FIXTURE_DIR, copyDir, { recursive: true });

    const validateResult = runCli(copyDir, ["validate"]);
    assertPass("validate", validateResult);
    assert.match(
      validateResult.stdout,
      /PASS: component-spec contract; 35 lines/,
      `validate: expected the 35-line PASS report, got:\n${validateResult.stdout}`,
    );
    console.log("ok  validate: PASS, 35 lines");

    const generateResult = runCli(copyDir, ["generate"]);
    assertPass("generate", generateResult);
    compareGeneratedOutput(copyDir);

    const checkResult = runCli(copyDir, ["check"]);
    assertPass("check", checkResult);
    console.log("ok  check: clean");

    const modelsResult = runCli(copyDir, ["models", "--check"]);
    assertPass("models --check", modelsResult);
    assert.match(
      modelsResult.stdout,
      /25 selected; 0 written, 25 unchanged/,
      `models --check: expected 25 unchanged, got:\n${modelsResult.stdout}`,
    );
    console.log("ok  models --check: 25 unchanged");

    const footprintsResult = runCli(copyDir, ["footprints", "check"]);
    assertPass("footprints check", footprintsResult);
    assert.match(
      footprintsResult.stdout,
      /25 committed footprint previews are current and safe/,
      `footprints check: expected 25 current, got:\n${footprintsResult.stdout}`,
    );
    console.log("ok  footprints check: 25 current");
  } finally {
    rmSync(copyDir, { recursive: true, force: true });
  }
}

async function main() {
  if (!existsSync(CLI_BUILT)) {
    throw new Error(`${path.relative(REPO_ROOT, CLI_BUILT)} is missing; run \`pnpm build\` first`);
  }
  assertStepMaterialized();
  await assertSelectionPortsAreFaithful();
  assertExpectedPreflightDiffIsOnlyViewModelVersion();

  const statusBefore = gitStatusOfFixture();
  await runHarness();
  const statusAfter = gitStatusOfFixture();
  assert.equal(statusAfter, statusBefore, "fixtures/led changed on disk while running the regression harness");

  console.log("fixtures/led regression: PASS");
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export {
  assertExpectedPreflightDiffIsOnlyViewModelVersion,
  assertSelectionPortsAreFaithful,
  assertStepMaterialized,
};
