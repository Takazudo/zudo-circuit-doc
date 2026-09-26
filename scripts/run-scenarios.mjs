#!/usr/bin/env node
// `pnpm test:scenarios` (#32): runs every automated acceptance-scenario check
// in one place, in a sensible order — unit -> integration -> packed consumer
// (opt-in via --with-pack, because it needs the LED fixture materialized and
// drives full packed-tarball builds) — and prints one table mapping each of
// the epic's 31 scenario IDs (design/07-validation-acceptance.md) to its
// result and evidence. See doc/src/content/docs/release/scenario-matrix.mdx
// for the full narrative matrix this table summarizes.
//
// This script does not reimplement any check: it runs the existing test
// suites and reused scripts (scripts/check-cad-freshness.mjs,
// scripts/verify-pack.mjs, pnpm test:led) plus #32's own additions
// (packages/circuit-doc/test/scenarios/**, python/tests/test_scenarios.py,
// scripts/scenarios/change-01.mjs) and reports what they said.
//
// Usage: node scripts/run-scenarios.mjs [--with-pack]
//
// Exit 0: every scenario that ran passed. Exit 1: at least one FAILed.
// AGENT-01 and BENCH-01 never count as passed — see the registry below.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const withPack = process.argv.includes("--with-pack");

function run(command, args, options = {}) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: REPO_ROOT, encoding: "utf8", ...options });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);
  return { ok: result.status === 0, status: result.status, output };
}

const pnpm = (args) => run("corepack", ["pnpm", ...args]);
const node = (args) => run(process.execPath, args);

// ---- run the tiers -----------------------------------------------------------------------

console.log("== unit tier: pnpm test:ts, pnpm test:python (includes #32's new scenario tests) ==");
const tsUnit = pnpm(["test:ts"]);
const pyUnit = pnpm(["test:python"]);

console.log("\n== integration tier: build, then the scripted project-level scenario checks ==");
// Always rebuild: `bin/` is committed but only re-exports the gitignored `lib/`,
// so a stale or missing `lib/` would otherwise go unnoticed.
const built = pnpm(["build"]);
const cad03 = built.ok ? node(["scripts/check-cad-freshness.mjs", "examples/minimal"]) : { ok: false, output: "" };
const change01 = built.ok ? node(["scripts/scenarios/change-01.mjs", "examples/minimal"]) : { ok: false, output: "" };

// Not one of the 31 scenario IDs, but a pre-existing gap this issue's handoff
// flagged as unwired from any CI workflow or package script — cheap and safe
// to close here, since `pnpm test:scenarios` already aggregates checks.
const authoredEmpty = node(["scripts/check-authored-content.mjs", "examples/empty"]);
const authoredMinimal = node(["scripts/check-authored-content.mjs", "examples/minimal"]);

let packed = null;
if (withPack) {
  console.log("\n== packed-consumer tier (--with-pack): LED fixture + verify:pack, all fixtures ==");
  pnpm(["fixtures:led:materialize"]);
  const testLed = pnpm(["test:led"]);
  const packEmpty = pnpm(["verify:pack", "--fixture", "empty"]);
  const packMinimal = pnpm(["verify:pack", "--fixture", "minimal"]);
  const packLed = pnpm(["verify:pack", "--fixture", "led"]);
  packed = { testLed, packEmpty, packMinimal, packLed };
} else {
  console.log("\n== packed-consumer tier: SKIPPED (pass --with-pack to run it; see the epic's Tests to run) ==");
}

// ---- the 31-ID registry -------------------------------------------------------------------
//
// `unit` entries resolve against the aggregate ts/python unit result (the
// suites are not run scenario-by-scenario). `tagged` entries additionally
// search a specific tier's captured output for a `PASS:`/`FAIL:` line
// carrying that exact ID, falling back to the tier's own exit code when the
// tier did not run (e.g. --with-pack was not given).

function taggedStatus(output, id, fallbackOk) {
  if (output) {
    const pass = new RegExp(`^PASS: ${id}\\b`, "mu");
    const fail = new RegExp(`^FAIL: ${id}\\b`, "mu");
    if (fail.test(output)) return "FAIL";
    if (pass.test(output)) return "PASS";
  }
  return fallbackOk === null ? "SKIP (needs --with-pack)" : fallbackOk ? "PASS" : "FAIL";
}

const packEmptyOutput = packed?.packEmpty.output ?? null;
const packMinimalOutput = packed?.packMinimal.output ?? null;
const testLedOk = packed ? packed.testLed.ok : null;

const registry = [
  { id: "INIT-01", type: "packed consumer", evidence: 'scripts/verify-pack.mjs --fixture empty, scenario "INIT-01"', status: taggedStatus(packEmptyOutput, "INIT-01", null) },
  { id: "INIT-02", type: "packed consumer", evidence: 'scripts/verify-pack.mjs --fixture empty, scenario "INIT-02"', status: taggedStatus(packEmptyOutput, "INIT-02", null) },
  { id: "INIT-03", type: "packed consumer", evidence: 'scripts/verify-pack.mjs --fixture empty, scenario "NEG-INIT-03" (destination collision)', status: taggedStatus(packEmptyOutput, "NEG-INIT-03", null) },
  { id: "INIT-04", type: "packed consumer", evidence: 'scripts/verify-pack.mjs --fixture empty, scenario "INIT-04" (run outside the monorepo)', status: taggedStatus(packEmptyOutput, "INIT-04", null) },
  { id: "INIT-05", type: "automated unit + packed consumer", evidence: "packages/create-zudo-circuit-doc/test/{args,scaffold}.test.ts; verify-pack.mjs \"INIT-05\"", status: taggedStatus(packEmptyOutput, "INIT-05", tsUnit.ok) },
  { id: "PART-01", type: "automated integration", evidence: "pnpm test:led (LED fixture: 35 LCSC-linked records, identity/sources/facts/inventory/references/docs)", status: testLedOk === null ? "SKIP (needs --with-pack)" : testLedOk ? "PASS" : "FAIL" },
  { id: "PART-02", type: "automated unit + packed consumer", evidence: 'python/tests/test_inventory_manual.py::test_part_02_...; verify-pack.mjs --fixture minimal "PART-02"', status: taggedStatus(packMinimalOutput, "PART-02", pyUnit.ok) },
  { id: "PART-03", type: "automated unit", evidence: "python/tests/test_inventory_manual.py::test_part_03_empty_placements_pass_with_scope", status: pyUnit.ok ? "PASS" : "FAIL" },
  { id: "PART-04", type: "automated unit", evidence: "python/tests/test_inventory_manual.py::test_part_04_...; test_contract.py::test_same_mpn_resolves_only_with_its_manufacturer", status: pyUnit.ok ? "PASS" : "FAIL" },
  { id: "PART-05", type: "automated unit", evidence: "python/tests/test_inventory_manual.py::test_part_05_one_line_with_several_placements", status: pyUnit.ok ? "PASS" : "FAIL" },
  { id: "SRC-01", type: "automated unit", evidence: "python/tests/test_scenarios.py::Src01Tests (local http.server: HTML body, error page, WORKFLOW.md Workflow C lint)", status: pyUnit.ok ? "PASS" : "FAIL" },
  { id: "SRC-02", type: "automated unit", evidence: "python/tests/test_contract.py (zero-hash sentinel + explicit SOURCE UNAVAILABLE state tests)", status: pyUnit.ok ? "PASS" : "FAIL" },
  { id: "SRC-03", type: "automated unit", evidence: "python/tests/test_contract.py::test_stale_online_hash_fails_and_removes_download; test_cli.py::test_online_stale_hash_fails", status: pyUnit.ok ? "PASS" : "FAIL" },
  { id: "FACT-01", type: "automated unit", evidence: "test/core/render-options.test.ts, describe(\"FACT-01 ...\")", status: tsUnit.ok ? "PASS" : "FAIL" },
  { id: "FACT-02", type: "automated unit", evidence: "test/core/render-options.test.ts, describe(\"FACT-02 ...\"); test_contract.py::test_primary_and_calculated_pass_require_available_primary_leaves", status: tsUnit.ok && pyUnit.ok ? "PASS" : "FAIL" },
  { id: "FACT-03", type: "automated (limit) + agent/engineering review (documented)", evidence: "python/tests/test_scenarios.py::Fact03Tests (unit-mismatch limit test; no-dimensional-claim source scan; WORKFLOW.md Workflow E lint)", status: pyUnit.ok ? "PASS (limit test)" : "FAIL" },
  { id: "FACT-04", type: "automated unit", evidence: "test/core/render-options.test.ts, describe(\"FACT-04 ...\")", status: tsUnit.ok ? "PASS" : "FAIL" },
  { id: "CAD-01", type: "automated unit + packed consumer", evidence: 'test/scenarios/cad-01.test.ts; verify-pack.mjs --fixture minimal "CAD-01"', status: taggedStatus(packMinimalOutput, "CAD-01", tsUnit.ok) },
  { id: "CAD-02", type: "source inspection + automated receipt check", evidence: "test/scenarios/cad-02.test.ts (README/receipt inspection + `derive.mjs --check`)", status: tsUnit.ok ? "PASS" : "FAIL" },
  { id: "CAD-03", type: "automated unit + automated integration", evidence: "test/footprint-previews/check.test.ts; scripts/check-cad-freshness.mjs", status: tsUnit.ok && cad03.ok ? "PASS" : "FAIL" },
  { id: "CAD-04", type: "automated unit", evidence: "test/provider/model-assets.test.ts, test/provider/references.test.ts, test/footprint-previews/transforms.test.ts", status: tsUnit.ok ? "PASS" : "FAIL" },
  { id: "CAD-05", type: "automated unit + packed consumer", evidence: 'test/provider/references.test.ts, test/provider/model-assets.test.ts; verify-pack.mjs "CAD-05"', status: taggedStatus(packEmptyOutput, "CAD-05", tsUnit.ok) },
  { id: "PUB-01", type: "automated unit", evidence: 'test/provider/publication.test.ts, "selects nothing by default — an unlisted instance is unpublished"', status: tsUnit.ok ? "PASS" : "FAIL" },
  { id: "PUB-02", type: "automated unit", evidence: 'test/provider/publication.test.ts, describe("selection freshness") (STALE_SELECTION)', status: tsUnit.ok ? "PASS" : "FAIL" },
  { id: "PUB-03", type: "automated unit", evidence: "test/scan/public-scope.test.ts, test/cli/scan-check-built.test.ts, test/provider/model-assets.test.ts", status: tsUnit.ok ? "PASS" : "FAIL" },
  { id: "OUT-01", type: "automated unit", evidence: 'test/core/emit.test.ts, "OUT-01 ..."', status: tsUnit.ok ? "PASS" : "FAIL" },
  { id: "OUT-02", type: "automated unit", evidence: 'test/core/emit.test.ts, "OUT-02 ..."', status: tsUnit.ok ? "PASS" : "FAIL" },
  { id: "OUT-03", type: "automated unit", evidence: 'test/core/emit.test.ts, "OUT-03 ..."', status: tsUnit.ok ? "PASS" : "FAIL" },
  { id: "AGENT-01", type: "agent-run", evidence: "agent run (a Claude session hands off to a fresh agent session over committed evidence alone): Claude Code variant run, Continue PASS / Query FAIL, Codex variant not run; recorded in doc/src/content/docs/release/agent-01-transcript-summary.mdx; structural scaffold only here (verify-pack.mjs --fixture empty, scenario \"AGENT-VARIANTS\")", status: "NOT PASSED (agent run; see summary)" },
  { id: "CHANGE-01", type: "automated integration", evidence: "scripts/scenarios/change-01.mjs (a-d); (c) reuses scripts/check-cad-freshness.mjs unchanged", status: change01.ok ? "PASS" : "FAIL" },
  { id: "BENCH-01", type: "manual", evidence: "not run: requires physical hardware; Workflow F (circuit/WORKFLOW.md) and circuit/templates/project-docs/verification/bring-up.mdx reviewed", status: "NOT RUN (manual)" },
];

// ---- print the table and decide the exit code ----------------------------------------------

const widths = { id: 10, type: 46, status: 44 };
const pad = (text, width) => (text.length >= width ? text.slice(0, width - 1) + "…" : text.padEnd(width));
console.log("\n\nScenario traceability:\n");
console.log(pad("ID", widths.id) + pad("Type", widths.type) + pad("Result", widths.status) + "Evidence");
console.log("-".repeat(widths.id + widths.type + widths.status + 8));
for (const row of registry) {
  console.log(pad(row.id, widths.id) + pad(row.type, widths.type) + pad(row.status, widths.status) + row.evidence);
}

const countedFailures = registry.filter((row) => row.status === "FAIL").length;
const notRun = registry.filter((row) => row.status.startsWith("SKIP")).length;
console.log(`\n${registry.length} scenarios; ${countedFailures} FAILed; ${notRun} not run (pass --with-pack for the packed-consumer tier).`);

if (!tsUnit.ok || !pyUnit.ok || !cad03.ok || !change01.ok || !authoredEmpty.ok || !authoredMinimal.ok || countedFailures > 0) {
  console.log("\nFAIL: pnpm test:scenarios");
  process.exit(1);
}
if (withPack && packed && !(packed.testLed.ok && packed.packEmpty.ok && packed.packMinimal.ok && packed.packLed.ok)) {
  console.log("\nFAIL: pnpm test:scenarios --with-pack");
  process.exit(1);
}
console.log("\nPASS: pnpm test:scenarios");
