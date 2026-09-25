/**
 * The committed LED integration page (#26), ported from upstream
 * `integration.test.ts:488` (`194d8a297e3545588197342130c3111a66c10973`).
 *
 * Every other case in the upstream file exercises the rule-projection and
 * rendering code against a synthetic fixture, and already lives in
 * `test/provider/integration.test.ts` (#11). What is LED-bound is this one
 * case: the real cross-component ruleset carries five evidence-chain stages
 * with no fact recorded against them at all, and the committed page must
 * still render each one as an explicit, barren OPEN row rather than as a
 * bare or silently-dropped cell.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

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

describe("evidence-chain stages with nothing recorded against them", () => {
  it("marks every barren stage on the committed page for the real corpus", async () => {
    // The committed page is deterministic and `pipeline.test.ts` (plus
    // `check:components`/`pnpm test:led`'s CLI harness) proves it is fresh, so
    // asserting on it directly here is cheap and does not require re-running
    // the pipeline.
    const committed = await readFile(
      join(project.paths.generatedRoot, "integration", "index.mdx"),
      "utf8",
    );
    for (const stage of ["pcb-orientation", "bom-cpl", "as-built", "programmed", "bench"]) {
      assert.ok(
        // Leading whitespace tolerated: the chain table sits inside an
        // `<EvidenceTable>` scroll container, so its rows are indented.
        new RegExp(
          `^\\s*\\| ${stage}\\s+\\| OPEN\\s+\\| no fact is recorded at this stage`,
          "mu",
        ).test(committed),
        `${stage} does not render as an explicitly-empty OPEN stage`,
      );
    }
    assert.equal(committed.split("no fact is recorded at this stage").length - 1, 5);
  });
});
