#!/usr/bin/env node
// Re-hashes packages/circuit-doc/src/core/** and diffs it against the
// upstream sha256 values recorded in src/core/PROVENANCE.md (#5). A file may
// legitimately drift from its recorded hash once a later issue (#10, #14,
// #15) starts changing it deliberately -- such a file must be listed in
// src/core/provenance-allowed/<issue-slug>.txt (see that directory's
// README), or this check fails.
//
// Usage: node packages/circuit-doc/scripts/check-core-provenance.mjs

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(scriptDir, "..");
const coreDir = join(packageRoot, "src", "core");
const provenancePath = join(coreDir, "PROVENANCE.md");
const allowedDir = join(coreDir, "provenance-allowed");

/** @typedef {{ path: string, sha256: string }} ProvenanceEntry */

/** @returns {Promise<ProvenanceEntry[]>} */
async function readProvenanceTable() {
  const markdown = await readFile(provenancePath, "utf8");
  const rowPattern = /^\|\s*`([^`]+)`\s*\|\s*`[^`]+`\s*\|\s*`([0-9a-f]{64})`\s*\|$/gmu;
  const entries = [];
  for (const match of markdown.matchAll(rowPattern)) {
    entries.push({ path: match[1], sha256: match[2] });
  }
  if (entries.length === 0) {
    throw new Error(`no provenance rows found in ${provenancePath}`);
  }
  return entries;
}

/** @returns {Promise<Set<string>>} paths (relative to src/core/) allowed to have drifted */
async function readAllowedPaths() {
  const allowed = new Set();
  let names;
  try {
    names = await readdir(allowedDir);
  } catch (error) {
    if (error.code === "ENOENT") return allowed;
    throw error;
  }
  for (const name of names) {
    if (!name.endsWith(".txt")) continue;
    const content = await readFile(join(allowedDir, name), "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      allowed.add(trimmed);
    }
  }
  return allowed;
}

async function sha256File(path) {
  const contents = await readFile(path);
  return createHash("sha256").update(contents).digest("hex");
}

async function main() {
  const [entries, allowedPaths] = await Promise.all([readProvenanceTable(), readAllowedPaths()]);

  const mismatches = [];
  const missing = [];

  for (const entry of entries) {
    const absolutePath = join(coreDir, entry.path);
    let actualHash;
    try {
      actualHash = await sha256File(absolutePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        missing.push(entry.path);
        continue;
      }
      throw error;
    }
    if (actualHash !== entry.sha256) {
      if (allowedPaths.has(entry.path)) continue;
      mismatches.push({ path: entry.path, expected: entry.sha256, actual: actualHash });
    }
  }

  if (missing.length > 0 || mismatches.length > 0) {
    if (missing.length > 0) {
      console.error("Missing provenance-tracked files:");
      for (const path of missing) console.error(`  - ${path}`);
    }
    if (mismatches.length > 0) {
      console.error("Byte-for-byte drift from recorded upstream hashes (not in an allowlist):");
      for (const { path, expected, actual } of mismatches) {
        console.error(`  - ${path}`);
        console.error(`      expected: ${expected}`);
        console.error(`      actual:   ${actual}`);
      }
      console.error(
        "\nIf this file is being changed deliberately by an owning issue, add its path to " +
          "src/core/provenance-allowed/<issue-slug>.txt (see that directory's README).",
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(`PASS: ${entries.length} core files match recorded upstream provenance.`);
}

await main();
