#!/usr/bin/env node
// The fixture site build harness (#23).
//
// Proves the packaged UI, islands, CSS, scanner and built-reference checker at
// LED scale (35 records, 25 footprint SVGs, 25 WRLs, long tables) in a real
// zfb build, against `@takazudo/zudo-circuit-doc` consumed the same way a real
// generated project would (a packed tarball by default) — never through this
// monorepo's own workspace linking. See scripts/lib/fixture-site.mjs for the
// full flow.
//
// Usage:
//   node scripts/build-fixture-site.mjs --fixture led|minimal [--out <dir>]
//     [--mode pack|file-dir] [--tarballs <dir>] [--keep]
//
// Requires `pnpm build` (packages/circuit-doc/lib) and, for the `led`
// fixture, `pnpm fixtures:led:materialize` to have already run.
//
// Also available as `pnpm build:led-site`.

import { pathToFileURL } from "node:url";

import { buildFixtureSite } from "./lib/fixture-site.mjs";

const USAGE = `Usage: node scripts/build-fixture-site.mjs --fixture led|minimal [options]

Options:
  --fixture <name>    Required. "led" (implemented) or "minimal" (reserved for #25/#31).
  --out <dir>         Build in this directory instead of a temp dir (must not exist or be empty).
  --mode <mode>       "pack" (default, a packed tarball) or "file-dir" (the built package
                       directory, injected by pnpm so peers resolve from the consumer).
  --tarballs <dir>    Reuse a prebuilt @takazudo/zudo-circuit-doc tarball from this directory
                       instead of packing one (#31); implies the dependency is a file: tarball.
  --keep              Do not remove --out (or the generated temp dir) when done.
  -h, --help          Show this help.`;

function parseArgs(argv) {
  const args = { fixture: null, out: null, mode: "pack", tarballsDir: null, keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--fixture") {
      args.fixture = argv[(i += 1)];
    } else if (arg === "--out") {
      args.out = argv[(i += 1)];
    } else if (arg === "--mode") {
      args.mode = argv[(i += 1)];
    } else if (arg === "--tarballs") {
      args.tarballsDir = argv[(i += 1)];
    } else if (arg === "--keep") {
      args.keep = true;
    } else {
      console.error(`unknown argument: ${arg}\n\n${USAGE}`);
      process.exit(2);
    }
  }
  if (args.fixture === null) {
    console.error(`missing required --fixture <led|minimal>\n\n${USAGE}`);
    process.exit(2);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildFixtureSite({ ...args, log: (line) => console.log(`[build-fixture-site] ${line}`) });
  console.log("");
  console.log(report.buildOutput.trim());
  console.log("");
  console.log(report.checkSiteOutput.trim());
  console.log("");
  console.log(
    report.kept
      ? `fixture site build: PASS (kept at ${report.outDir})`
      : "fixture site build: PASS",
  );
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export { parseArgs };
