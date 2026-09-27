#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = path.join(ROOT, "scripts/lib/release-guard.mjs");
const PACKAGES = [
  {
    name: "runtime",
    selector: "@takazudo/zudo-circuit-doc",
    manifest: "packages/circuit-doc/package.json",
    tag: (version) => `v${version}`,
  },
  {
    name: "initializer",
    selector: "create-zudo-circuit-doc",
    manifest: "packages/create-zudo-circuit-doc/package.json",
    tag: (version) => `create-zudo-circuit-doc-v${version}`,
  },
];

const REQUIRED_FILES = ["CHANGELOG.md", "README.md", "LICENSE"];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    ...options,
  });

  if (result.error) throw result.error;
  return result;
}

function outputText(result) {
  return [result.stdout, result.stderr].filter(Boolean).join("\n");
}

function extractTarballFiles(output) {
  const contentsStart = output.indexOf("Tarball Contents");
  const detailsStart = output.indexOf("Tarball Details", contentsStart + 1);
  if (contentsStart < 0 || detailsStart < 0) {
    throw new Error("pnpm pack --dry-run did not print a tarball contents list.");
  }

  const contents = output.slice(contentsStart + "Tarball Contents".length, detailsStart);
  const files = [];
  for (const line of contents.split(/\r?\n/u)) {
    let entry = line.replace(/^\s*(?:npm\s+)?notice\s+/iu, "").trim();
    if (!entry) continue;
    // pnpm pack prints bare paths; npm-style pack output prefixes each path
    // with a size. Keep bare paths intact and remove only a known size column.
    const sizedEntry = entry.match(/^\d+(?:\.\d+)?\s*(?:B|kB|MB|GB)\s+(.+)$/u);
    if (sizedEntry) entry = sizedEntry[1].trim();
    files.push(entry);
  }
  return [...new Set(files)];
}

function assertRequiredFiles(packageInfo, files) {
  const missing = REQUIRED_FILES.filter((required) => !files.includes(required));
  if (missing.length > 0) {
    throw new Error(`${packageInfo.selector} tarball is missing required file${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`);
  }
}

async function main() {
  let failed = false;

  for (const packageInfo of PACKAGES) {
    const manifest = JSON.parse(await readFile(path.join(ROOT, packageInfo.manifest), "utf8"));
    const tag = packageInfo.tag(manifest.version);
    console.log(`\nChecking ${packageInfo.selector}@${manifest.version}`);

    const guard = run(process.execPath, [GUARD, packageInfo.name], {
      env: {
        ...process.env,
        GITHUB_REF_TYPE: "tag",
        GITHUB_REF_NAME: tag,
      },
    });
    const guardOutput = outputText(guard);
    if (guardOutput) process.stdout.write(guardOutput.endsWith("\n") ? guardOutput : `${guardOutput}\n`);
    if (guard.status !== 0) {
      failed = true;
      console.error(`Release guard failed for ${packageInfo.selector} (exit ${guard.status ?? "unknown"}).`);
      continue;
    }

    const publish = run(
      "pnpm",
      ["--filter", packageInfo.selector, "publish", "--dry-run", "--no-git-checks", "--tag", "latest", "--access", "public"],
    );
    const publishOutput = outputText(publish);
    if (publishOutput) process.stdout.write(publishOutput.endsWith("\n") ? publishOutput : `${publishOutput}\n`);
    if (publish.status !== 0) {
      failed = true;
      console.error(`pnpm publish --dry-run failed for ${packageInfo.selector} (exit ${publish.status ?? "unknown"}).`);
      continue;
    }

    // pnpm 11's publish --dry-run confirms it would skip publishing but
    // doesn't include the package contents. Ask pnpm pack to show those same
    // files without writing a tarball to disk.
    const pack = run("pnpm", ["--filter", packageInfo.selector, "pack", "--dry-run"]);
    const packOutput = outputText(pack);
    if (pack.status !== 0) {
      failed = true;
      console.error(`pnpm pack --dry-run failed for ${packageInfo.selector} (exit ${pack.status ?? "unknown"}).`);
      continue;
    }

    try {
      const files = extractTarballFiles(packOutput);
      console.log(`Tarball files for ${packageInfo.selector}:`);
      for (const file of files) console.log(`  ${file}`);
      if (files.length === 0) throw new Error("Tarball contents list was empty.");
      assertRequiredFiles(packageInfo, files);
      console.log(`Release dry-run passed for ${packageInfo.selector}.`);
    } catch (error) {
      failed = true;
      console.error(`Release dry-run failed for ${packageInfo.selector}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failed) process.exitCode = 1;
  else console.log("\nRelease dry-run passed for both packages.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
