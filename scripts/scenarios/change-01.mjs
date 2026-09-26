#!/usr/bin/env node
// CHANGE-01: a component's evidence, source or footprint changes, and the
// project's checks catch every downstream effect:
//   (a) a raw fact used by a calculated fact goes stale -> validate FAILs;
//   (b) a source whose declared bytes no longer match what a refresh fetches
//       -> validate --refresh-source FAILs naming the mismatch;
//   (c) a footprint edit -> footprints check FAILs (reuses CAD-03's
//       scripts/check-cad-freshness.mjs unchanged, never duplicated here);
//   (d) generate after a legitimate evidence edit changes only the owned
//       generated tree and the preflight report, nothing else.
//
// Every case runs on a throwaway copy of examples/minimal (or, for (c), lets
// check-cad-freshness.mjs make its own copy); the committed fixture is never
// touched. Requires `packages/circuit-doc` to be built first (`pnpm build`).
//
// Usage: node scripts/scenarios/change-01.mjs <project-dir>

import { createHash } from "node:crypto";
import { spawn as spawnAsync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CLI_BIN = path.join(REPO_ROOT, "packages/circuit-doc/bin/zudo-circuit-doc.js");
const CAD_FRESHNESS_SCRIPT = path.join(REPO_ROOT, "scripts/check-cad-freshness.mjs");
const COPY_EXCLUDE = new Set(["node_modules", ".git", "dist", ".zfb", ".zfb-build", ".zudo-doc", ".circuit-cache"]);
const RECORD_ID = "rec-tmp1075dr";
const OWNER_SKILL = "component-ti-tmp1075dr";
const GENERATED_PREFIX = "doc/src/content/docs/components/";
const PREFLIGHT_PATH = "circuit/generated/preflight.json";

function usage(message) {
  console.error(`usage: node scripts/scenarios/change-01.mjs <project-dir>\n${message ?? ""}`.trim());
  process.exit(2);
}

const positionals = process.argv.slice(2);
if (positionals.length !== 1) usage("expected exactly one project directory");
const sourceProject = path.resolve(positionals[0]);
if (!existsSync(sourceProject)) usage(`not a directory: ${positionals[0]}`);
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

function freshProject(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  scratchDirs.push(dir);
  const dest = path.join(dir, "project");
  cpSync(sourceProject, dest, { recursive: true, filter: (src) => !COPY_EXCLUDE.has(path.basename(src)) });
  return dest;
}

/** Strips proxy env vars so a case's local stand-in server is never routed through one. */
function cliEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(https?|all)_proxy$/i.test(key)) delete env[key];
  }
  env.PYTHONDONTWRITEBYTECODE = "1";
  env.NO_PROXY = "*";
  env.no_proxy = "*";
  return env;
}

function runCli(projectDir, args) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], { cwd: projectDir, encoding: "utf8", env: cliEnv() });
  if (result.error) throw result.error;
  return result;
}

/**
 * Same as `runCli`, but non-blocking: needed whenever a case's own Node
 * process must keep serving requests (e.g. a local stand-in HTTP server)
 * while the CLI runs — `spawnSync` would starve that event loop and the
 * request would time out.
 */
function runCliAsync(projectDir, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawnAsync(process.execPath, [CLI_BIN, ...args], { cwd: projectDir, env: cliEnv() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });
}

const describeResult = (result) => `exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function ownerFile(projectDir, name) {
  return path.join(projectDir, ".claude/skills", OWNER_SKILL, name);
}

// --- case (a): a raw fact used by a calculated fact goes stale --------------------------------

function caseFactCascade() {
  const project = freshProject("circuit-change01a-");
  const factsPath = ownerFile(project, "facts.json");
  const manifestPath = ownerFile(project, "manifest.json");
  const facts = readJson(factsPath);
  const manifest = readJson(manifestPath);
  const sourceId = facts.facts.find((fact) => fact.record_id === RECORD_ID).source_id;

  // A synthetic raw/calculated pair added to a throwaway copy only — never
  // committed to examples/minimal. The calculated fact is a trivial identity
  // of the raw one, so any change to the raw value must recompute stale.
  const raw = {
    fact_id: "fact-tmp1075-change01-raw", record_id: RECORD_ID, source_id: sourceId,
    class: "PROJECT_STATE", value: 100, unit: "mA", conditions: "synthetic CHANGE-01 fixture",
    locator: `${sourceId}: Table 1, synthetic CHANGE-01 row`, provenance: "UNVERIFIED", verdict: "UNSOURCED",
    depends_on: [], expression: "",
  };
  const calculated = {
    fact_id: "fact-tmp1075-change01-calc", record_id: RECORD_ID, source_id: sourceId,
    class: "PROJECT_STATE", value: 100, unit: "mA", conditions: "synthetic CHANGE-01 fixture",
    locator: "CALCULATED: fact-tmp1075-change01-raw", provenance: "CALCULATED", verdict: "UNSOURCED",
    depends_on: ["fact-tmp1075-change01-raw"], expression: "fact_tmp1075_change01_raw",
  };
  facts.facts.push(raw, calculated);
  writeJson(factsPath, facts);
  const record = manifest.records.find((item) => item.record_id === RECORD_ID);
  record.fact_ids.push(raw.fact_id, calculated.fact_id);
  writeJson(manifestPath, manifest);

  const baseline = runCli(project, ["validate"]);
  check("CHANGE-01(a): baseline with the added raw/calculated fact pair passes", baseline.status === 0, describeResult(baseline));

  const changed = readJson(factsPath);
  changed.facts.find((fact) => fact.fact_id === raw.fact_id).value = 250;
  writeJson(factsPath, changed);
  const stale = runCli(project, ["validate"]);
  check(
    "CHANGE-01(a): editing the raw dependency makes the calculated fact FAIL as stale",
    stale.status === 1 && stale.stderr.includes(`${calculated.fact_id}: derived value is stale`),
    describeResult(stale),
  );
}

// --- case (b): a source whose declared bytes no longer match a refresh ------------------------

function startStandInServer(body) {
  return http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
  });
}

function listen(server) {
  return new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
}

function closeServer(server) {
  return new Promise((resolveClose) => server.close(resolveClose));
}

async function caseSourceRefresh() {
  const project = freshProject("circuit-change01b-");
  // Never the real datasheet URL: a local stand-in, so this never touches
  // the network. Whatever it serves cannot be the bytes the recorded
  // SHA-256 locks, which is exactly the point — a refresh must catch that.
  const server = startStandInServer(Buffer.from("%PDF-1.4 stand-in bytes, never the real datasheet\n"));
  await listen(server);
  try {
    const sourcesPath = ownerFile(project, "sources.json");
    const sources = readJson(sourcesPath);
    const target = sources.sources[0];
    const { port } = server.address();
    target.authoritative_url = `http://127.0.0.1:${port}/datasheet.pdf`;
    writeJson(sourcesPath, sources);

    const result = await runCliAsync(project, ["validate", "--refresh-source", target.source_id]);
    check(
      `CHANGE-01(b): a source whose declared bytes no longer match a refresh FAILs naming ${target.source_id}`,
      result.status === 1 && result.stderr.includes(`${target.source_id}: stale online hash`),
      describeResult(result),
    );
  } finally {
    await closeServer(server);
  }
}

// --- case (c): a footprint edit is caught by CAD-03's freshness check (reused) ----------------

function caseFootprintFreshness() {
  const result = spawnSync(process.execPath, [CAD_FRESHNESS_SCRIPT, sourceProject], { encoding: "utf8" });
  check(
    "CHANGE-01(c): a footprint edit fails footprints check (scripts/check-cad-freshness.mjs, reused unchanged)",
    result.status === 0,
    `${result.stdout}\n${result.stderr}`,
  );
}

// --- case (d): generate after a legitimate evidence edit stays inside owned outputs -----------

function snapshot(root) {
  const files = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (COPY_EXCLUDE.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(root, full).split(path.sep).join("/");
      files.set(relative, createHash("sha256").update(readFileSync(full)).digest("hex"));
    }
  };
  walk(root);
  return files;
}

function diffPaths(before, after) {
  const changed = new Set();
  for (const [file, hash] of after) if (before.get(file) !== hash) changed.add(file);
  for (const file of before.keys()) if (!after.has(file)) changed.add(file);
  return [...changed];
}

function caseGenerateDiffScoped() {
  const project = freshProject("circuit-change01d-");
  const baseline = runCli(project, ["generate"]);
  check("CHANGE-01(d): baseline generate passes", baseline.status === 0, describeResult(baseline));

  // The evidence edit itself is authored input, not generator output — it is
  // expected to change its own file. What matters is what `generate` does
  // *in response* to it, so the snapshot that bounds the generator's own
  // diff is taken after the edit, not before it. A fact's `conditions` field
  // is rendered verbatim on its record page, so editing it is guaranteed to
  // be a legitimate, visible evidence change.
  const factsPath = ownerFile(project, "facts.json");
  const facts = readJson(factsPath);
  const edited = facts.facts.find((fact) => fact.record_id === RECORD_ID);
  edited.conditions = `${edited.conditions} (reviewed 2026-09-26 for CHANGE-01)`;
  writeJson(factsPath, facts);
  const beforeRegenerate = snapshot(project);

  const regenerated = runCli(project, ["generate"]);
  check("CHANGE-01(d): generate after the evidence edit passes", regenerated.status === 0, describeResult(regenerated));

  const afterRegenerate = snapshot(project);
  const changedByGenerate = diffPaths(beforeRegenerate, afterRegenerate);
  const outOfScope = changedByGenerate.filter((file) => !file.startsWith(GENERATED_PREFIX) && file !== PREFLIGHT_PATH);
  check(
    `CHANGE-01(d): generate's own diff, after a legitimate evidence edit, touches only ${GENERATED_PREFIX}** and ${PREFLIGHT_PATH}`,
    changedByGenerate.length > 0 && outOfScope.length === 0,
    `changed by generate:\n${changedByGenerate.join("\n")}\nout of scope:\n${outOfScope.join("\n")}`,
  );
}

async function main() {
  try {
    caseFactCascade();
    await caseSourceRefresh();
    caseFootprintFreshness();
    caseGenerateDiffScoped();
  } finally {
    for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.log(`\nCHANGE-01: ${failures} case(s) failed`);
    process.exit(1);
  }
  console.log("\nCHANGE-01: all cases passed");
}

main();
