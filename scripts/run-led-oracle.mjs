#!/usr/bin/env node
// Runs the pinned zudo-led-lamp validator, its unit tests and the forward-test checker,
// unmodified, against a scratch copy of fixtures/led/upstream. This is the differential
// oracle: it never reads STEP files, so it needs no materialization (fixtures/led/README.md).
//
// Usage: node scripts/run-led-oracle.mjs

import { spawnSync, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const UPSTREAM_DIR = path.join(REPO_ROOT, "fixtures/led/upstream");
const PYTHON = process.env.CIRCUIT_DOC_PYTHON || "python3";

function run(label, args, cwd) {
  console.log(`> ${label}`);
  const result = spawnSync(PYTHON, ["-B", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  if (result.error) throw result.error;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${label} exited with code ${result.status}`);
  }
  return result.stdout ?? "";
}

function main() {
  if (!existsSync(UPSTREAM_DIR)) {
    console.error("fixtures/led/upstream is missing — run `pnpm fixtures:led:check` first");
    process.exitCode = 1;
    return;
  }

  const scratchRoot = mkdtempSync(path.join(tmpdir(), "led-oracle-"));
  const scratchUpstream = path.join(scratchRoot, "led");
  try {
    cpSync(UPSTREAM_DIR, scratchUpstream, { recursive: true });

    const validateOut = run(
      "validate.py",
      [".claude/skills/component-spec-audit/scripts/validate.py"],
      scratchUpstream,
    );
    if (!validateOut.includes("PASS: component-spec contract")) {
      throw new Error("validate.py did not report PASS: component-spec contract");
    }

    run(
      "unittest discover (component-spec-audit)",
      ["-m", "unittest", "discover", "-s", ".claude/skills/component-spec-audit/scripts", "-p", "test_*.py"],
      scratchUpstream,
    );

    const forwardOut = run(
      "check_forward_tests.py",
      [".claude/skills/circuit-spec-integration/scripts/check_forward_tests.py"],
      scratchUpstream,
    );
    if (!/pass/iu.test(forwardOut)) {
      throw new Error("check_forward_tests.py did not report a pass");
    }
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }

  // The oracle only ever touches the scratch copy — assert the committed fixture tree
  // (and any working-tree drift, e.g. a stray __pycache__) is unchanged.
  const status = execFileSync("git", ["status", "--porcelain", "fixtures/led"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (status.trim() !== "") {
    console.error(status);
    throw new Error("fixtures/led working tree is not clean after running the oracle");
  }

  console.log("oracle: PASS (validate.py, unittest discover, check_forward_tests.py)");
}

main();
