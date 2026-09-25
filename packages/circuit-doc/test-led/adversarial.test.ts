/**
 * Invalid input must fail before the generated tree is replaced, proven
 * against the real LED corpus (#26), ported from upstream
 * `adversarial.test.ts:290-322` (`194d8a297e3545588197342130c3111a66c10973`).
 *
 * The generic half of this case — a synthetic `mkdtemp` project, a stub
 * validator that fails on the second call — already lives in
 * `test/provider/adapter.test.ts` as "leaves the previous output
 * byte-identical when validation fails" (#11). What only the real corpus adds
 * is running the real `createCircuitAdapter` over the real evidence once
 * successfully, then swapping in a Python script that fails, and proving the
 * previously-written pages are untouched byte for byte.
 */

import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { ComponentDocsError } from "../src/core/errors.ts";
import { runPipeline } from "../src/core/pipeline.ts";
import { createCircuitAdapter } from "../src/provider/v1/index.ts";
import { createPythonValidator } from "../src/provider/v1/validate.ts";
import { createProjectValidator } from "../src/config/map.ts";
import type { LoadedProject } from "../src/cli/project.ts";
import { setUpLedProject, type LedScratch } from "./support/led-project.ts";

let scratch: LedScratch;
let project: LoadedProject;

before(async () => {
  const led = await setUpLedProject();
  scratch = led;
  project = led.project;
});

after(() => {
  scratch?.cleanup();
});

describe("invalid input fails before the generated tree is replaced", () => {
  it("leaves the previous output byte-identical when validation fails", async () => {
    const generatedRoot = join(scratch.dir, "atomic", "generated");
    const goodAdapter = createCircuitAdapter({
      paths: project.paths,
      selection: project.selection,
      matrix: project.matrix,
      validator: createProjectValidator(project, process.env),
      integrationOwnerSkill: project.integrationOwnerSkill,
      reference: project.reference,
    });
    await runPipeline(goodAdapter, { generatedRoot, dryRun: false, render: project.render });

    const before = new Map<string, string>();
    for (const name of await readdir(generatedRoot)) {
      const path = join(generatedRoot, name);
      if (name.endsWith(".mdx")) before.set(name, await readFile(path, "utf8"));
    }
    assert.ok(before.size > 0, "the first run produced nothing to protect");

    const failing = join(scratch.dir, "reject.py");
    await writeFile(failing, 'import sys\nsys.stderr.write("FAIL: seeded\\n")\nsys.exit(4)\n');
    const failingAdapter = {
      ...goodAdapter,
      validate: createPythonValidator({ scriptPath: failing, cwd: project.paths.projectRoot }),
    };

    await assert.rejects(
      runPipeline(failingAdapter, { generatedRoot, dryRun: false, render: project.render }),
      (error: unknown) => error instanceof ComponentDocsError && error.code === "VALIDATION_FAILED",
    );

    for (const [name, contents] of before) {
      assert.equal(
        await readFile(join(generatedRoot, name), "utf8"),
        contents,
        `${name} changed during a failed run`,
      );
    }
  });
});
