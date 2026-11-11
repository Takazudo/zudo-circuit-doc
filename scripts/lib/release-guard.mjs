#!/usr/bin/env node
// Static tag/namespace/version guard used by `pnpm release:dry-run`.
// The publish workflows use the stronger `scripts/release.mjs admit`, which
// also proves the tag exists on origin and binds its peeled commit.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PACKAGES, assertReleaseTag } from "./release-core.mjs";

export { assertReleaseTag };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  const [packageName, ...extraArgs] = process.argv.slice(2);
  if (!PACKAGES[packageName] || extraArgs.length > 0) {
    throw new Error("Usage: node scripts/lib/release-guard.mjs <runtime|initializer>");
  }

  const config = PACKAGES[packageName];
  const manifest = JSON.parse(await readFile(path.join(ROOT, config.manifest), "utf8"));
  const release = assertReleaseTag({
    packageName,
    refType: process.env.GITHUB_REF_TYPE,
    refName: process.env.GITHUB_REF_NAME,
    version: manifest.version,
  });

  console.log(`Release guard passed: ${release.package}@${release.version} from ${release.tag}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Release guard failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
