/**
 * `scan` / `check-built` wired end-to-end through the real CLI, on a genuine
 * (if hand-assembled) declared-empty project: `generate` produces the real
 * preflight report and generated MDX, and the site build itself is stood in
 * by a minimal, hand-written `doc/dist` — a full `zfb build` is a heavy run
 * this issue's "Tests to run" does not assign.
 *
 * `packages/circuit-doc/test/scan/*.test.ts` cover the scanning/checking logic
 * itself against synthetic dist trees; this file proves the CLI wiring (config
 * loading, the validator gate, `project.assets`/`project.paths` flowing
 * through) on top of it.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";

import { EXIT } from "../../src/cli/command.ts";
import { runCli, writeEmptyProject } from "./project-fixture.ts";

let scratch = "";
let counter = 0;

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "zcd-cli-scan-"));
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function project(): Promise<string> {
  counter += 1;
  return writeEmptyProject(join(scratch, `p${counter}`));
}

/** The minimal `doc/dist` a declared-empty (0-record) build produces. */
async function writeDeclaredEmptyDist(root: string): Promise<void> {
  const distRoot = join(root, "doc/dist");
  for (const page of [
    "docs/components/index.html",
    "docs/components/catalog/index.html",
    "docs/components/records/index.html",
    "docs/components/integration/index.html",
  ]) {
    await mkdir(dirname(join(distRoot, page)), { recursive: true });
    await writeFile(join(distRoot, page), "<html><body>zero-state</body></html>");
  }
  await writeFile(join(distRoot, "search-index.json"), "[]");
  await writeFile(join(distRoot, "llms.txt"), "");
  await writeFile(join(distRoot, "llms-full.txt"), "");
}

describe("scan on a declared-empty project", () => {
  it("fails with a targeted message when dist has not been built", async () => {
    const root = await project();
    assert.equal((await runCli(root, ["generate"])).code, EXIT.PASS);
    const run = await runCli(root, ["scan"]);
    assert.equal(run.code, EXIT.FAILED);
    assert.match(run.stderr, /dist is empty; run the site build before scanning/u);
  });

  it("passes with SKIP: lines once generate has run and dist is a valid zero-state build", async () => {
    const root = await project();
    assert.equal((await runCli(root, ["generate"])).code, EXIT.PASS);
    await writeDeclaredEmptyDist(root);

    const run = await runCli(root, ["scan"]);
    assert.equal(run.code, EXIT.PASS, run.stderr);
    assert.match(run.stdout, /SKIP:/u);
    assert.match(run.stdout, /no raw evidence\/CAD file is publicly reachable/u);
  });

  it("fails PUB-03 style when a raw evidence file sits under doc/public", async () => {
    const root = await project();
    assert.equal((await runCli(root, ["generate"])).code, EXIT.PASS);
    await writeDeclaredEmptyDist(root);
    await mkdir(join(root, "doc/public"), { recursive: true });
    await writeFile(join(root, "doc/public/leaked-datasheet.pdf"), "%PDF-1.4 fixture");

    const run = await runCli(root, ["scan"]);
    assert.equal(run.code, EXIT.FAILED);
    assert.match(run.stderr, /raw evidence\/CAD file/u);
  });
});

describe("check-built on a declared-empty project", () => {
  it("passes at zero records and zero packages", async () => {
    const root = await project();
    assert.equal((await runCli(root, ["generate"])).code, EXIT.PASS);
    await writeDeclaredEmptyDist(root);

    const run = await runCli(root, ["check-built"]);
    assert.equal(run.code, EXIT.PASS, run.stderr);
    assert.match(run.stdout, /0 record\(s\), 0 footprint SVG\(s\), 0 model\(s\)/u);
  });

  it("fails when the catalog page references live preview UI it should not have", async () => {
    const root = await project();
    assert.equal((await runCli(root, ["generate"])).code, EXIT.PASS);
    await writeDeclaredEmptyDist(root);
    await writeFile(
      join(root, "doc/dist/docs/components/catalog/index.html"),
      "<html><body><canvas></canvas></body></html>",
    );

    const run = await runCli(root, ["check-built"]);
    assert.equal(run.code, EXIT.FAILED);
    assert.match(run.stderr, /must not create or reference live preview UI/u);
  });
});
