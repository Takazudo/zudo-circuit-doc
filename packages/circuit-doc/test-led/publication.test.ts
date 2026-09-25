/**
 * The committed LED instance selection (#26), ported from upstream
 * `publication.test.ts:129-143` (`194d8a297e3545588197342130c3111a66c10973`).
 *
 * The generic `PublicationPolicy` gates and the deterministic-report case
 * already live in `test/provider/publication.test.ts` against a synthetic
 * fixture (#11). What is LED-bound is the committed selection itself:
 * `fixtures/led/circuit/selection.json` is a hand-reviewed allowlist, and
 * these two properties — no duplicate, and record/source counts matching its
 * own declared `expect` — are exactly what a stale edit to that file would
 * break silently otherwise.
 */

import assert from "node:assert/strict";
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

describe("committed LED selection", () => {
  it("keeps the instance selection free of duplicates", () => {
    assert.equal(
      new Set(project.selection.recordIds).size,
      project.selection.recordIds.length,
    );
    assert.equal(
      new Set(project.selection.sourceIds).size,
      project.selection.sourceIds.length,
    );
  });

  it("matches the asserted corpus size", () => {
    assert.equal(project.selection.recordIds.length, project.selection.expect.records);
    assert.equal(project.selection.sourceIds.length, project.selection.expect.sources);
  });
});
