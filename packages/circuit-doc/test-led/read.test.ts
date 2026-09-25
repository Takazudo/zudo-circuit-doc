/**
 * Path containment and inventory reads against the real LED corpus (#26).
 *
 * Ported from upstream `read.test.ts:65-68,142-143`
 * (`194d8a297e3545588197342130c3111a66c10973`). Symlink refusal and the other
 * containment cases are pure-function tests already carried into
 * `test/provider/read.test.ts` against a synthetic project (#11); what is
 * LED-bound is running the same two checks against the real, materialized
 * corpus tree instead of a scratch one.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ComponentDocsError } from "../src/core/errors.ts";
import { assertContainedUnder } from "../src/provider/v1/read.ts";
import { readInventory } from "../src/provider/v1/evidence.ts";
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

describe("containment", () => {
  it("applies the same rule to the real skills root", () => {
    const { bundlesRoot, inventoryFile } = project.paths;
    rejectsContainment(() =>
      assertContainedUnder(bundlesRoot, `${bundlesRoot}/../../package.json`),
    );
    rejectsContainment(() => assertContainedUnder(bundlesRoot, "/etc/passwd"));
    assert.equal(assertContainedUnder(bundlesRoot, inventoryFile), inventoryFile);
  });
});

describe("the real inventory", () => {
  it("still reads the real inventory", async () => {
    const inventory = await readInventory(project.paths.bundlesRoot, project.paths.inventoryFile);
    assert.equal(inventory.schema_version, 1);
    // The real LED corpus figure the epic states (see corpus.test.ts).
    assert.equal(inventory.lines.length, 35);
    assert.equal(inventory.assertions.orderable_lines, 35);
    assert.equal(inventory.assertions.fitted_lines, 31);
    assert.equal(inventory.assertions.dnp_or_hand_fit_lines, 4);
  });
});

function rejectsContainment(run: () => unknown): void {
  assert.throws(
    run,
    (error: unknown) => error instanceof ComponentDocsError && error.code === "PATH_CONTAINMENT",
  );
}
