/**
 * Docker-free footprint preview drift check against the real, committed LED
 * previews (#26), ported from upstream `footprint-previews.test.ts:64-136`
 * (`194d8a297e3545588197342130c3111a66c10973`).
 *
 * The pure SVG/footprint-text transform tests and the synthetic
 * generate-then-check round trip are already covered against a scratch
 * fixture in `test/footprint-previews/*.test.ts` (#20). What is LED-bound is
 * proving the real corpus resolves to the "committed 25-package, 35-record"
 * set the epic states, and that the committed SVGs are still current and
 * safe — exactly what `footprints check` (the CLI command) runs, called here
 * the same way `checkFootprintsStep` does.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { checkFootprintPreviews } from "../src/footprint-previews/check.ts";
import { footprintSelectionsFromIndex } from "../src/footprint-previews/selection.ts";
import { readEvidenceIndex } from "../src/provider/v1/index.ts";
import type { FootprintSelection } from "../src/footprint-previews/manifest.ts";
import type { LoadedProject } from "../src/cli/project.ts";
import { setUpLedProject, type LedScratch } from "./support/led-project.ts";

let scratch: LedScratch;
let project: LoadedProject;
let selections: readonly FootprintSelection[];

before(async () => {
  const led = await setUpLedProject();
  scratch = led;
  project = led.project;
  const index = await readEvidenceIndex({
    paths: project.paths,
    selection: project.selection,
    reference: project.reference,
  });
  selections = footprintSelectionsFromIndex(index, project.selection);
});

after(() => {
  scratch?.cleanup();
});

describe("footprint preview no-KiCad drift check", () => {
  it("accepts the committed 25-package, 35-record alias set", async () => {
    assert.equal(selections.length, 25);
    assert.equal(new Set(selections.flatMap((entry) => entry.recordIds)).size, 35);
    await checkFootprintPreviews({
      selections,
      footprintMasterRoot: project.paths.footprintMasterRoot,
      footprintLibraryRoot: project.paths.footprintLibraryRoot,
      previewRoot: project.paths.footprintPreviewRoot,
      renderer: project.config.cad.enabled ? project.config.cad.previewRenderer : undefined,
    });
  });
});
