#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const PACKAGE_CONFIG = {
  runtime: {
    selector: "@takazudo/zudo-circuit-doc",
    manifest: "packages/circuit-doc/package.json",
    tag: (version) => `v${version}`,
    tagPattern: /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u,
  },
  initializer: {
    selector: "create-zudo-circuit-doc",
    manifest: "packages/create-zudo-circuit-doc/package.json",
    tag: (version) => `create-zudo-circuit-doc-v${version}`,
    tagPattern: /^create-zudo-circuit-doc-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u,
  },
};

const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

/**
 * Validate that a workflow ref is the stable release tag for one package.
 * This function is intentionally pure so its full decision table can be
 * tested without invoking GitHub Actions or reading the workspace.
 */
export function assertReleaseTag({ packageName, refType, refName, version }) {
  const config = PACKAGE_CONFIG[packageName];
  if (!config) {
    throw new Error(`Unknown release package ${JSON.stringify(packageName)}; expected runtime or initializer.`);
  }

  if (refType !== "tag") {
    throw new Error(`Release ref must be a tag; received ${JSON.stringify(refType)}.`);
  }

  if (typeof version !== "string" || !STABLE_VERSION_PATTERN.test(version)) {
    throw new Error(`Manifest version ${JSON.stringify(version)} is not a stable X.Y.Z version.`);
  }

  if (typeof refName !== "string" || !config.tagPattern.test(refName)) {
    throw new Error(`Tag ${JSON.stringify(refName)} does not use the ${packageName} release namespace.`);
  }

  const expectedTag = config.tag(version);
  if (refName !== expectedTag) {
    throw new Error(`Tag ${JSON.stringify(refName)} does not match ${config.selector}@${version} (expected ${JSON.stringify(expectedTag)}).`);
  }

  return { packageName, package: config.selector, version, tag: refName };
}

async function main() {
  const [packageName, ...extraArgs] = process.argv.slice(2);
  if (!PACKAGE_CONFIG[packageName] || extraArgs.length > 0) {
    throw new Error("Usage: node scripts/lib/release-guard.mjs <runtime|initializer>");
  }

  const config = PACKAGE_CONFIG[packageName];
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
