/**
 * The real LED corpus collapses 35 records onto 25 distinct package models
 * (#26), ported from upstream `model-viewer.test.ts:49-58`
 * (`194d8a297e3545588197342130c3111a66c10973`).
 *
 * The descriptor encode/decode round-trip, the on-disk model-asset sync, and
 * the viewer runtime helpers (camera fit, transform, invalidator, fallback
 * copy) are UI-package concerns exercised against synthetic fixtures
 * elsewhere (#13); this file only proves the LED-specific package count and
 * that at least one real footprint carries a non-zero rotation.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PublicationPolicy } from "../src/core/publication.ts";
import { readEvidenceIndex, projectIndex } from "../src/provider/v1/index.ts";
import type { PublicViewModel } from "../src/core/view-model.ts";
import type { LoadedProject } from "../src/cli/project.ts";
import { setUpLedProject, type LedScratch } from "./support/led-project.ts";

let scratch: LedScratch;
let project: LoadedProject;
let model: PublicViewModel;

before(async () => {
  const led = await setUpLedProject();
  scratch = led;
  project = led.project;
  const index = await readEvidenceIndex({
    paths: project.paths,
    selection: project.selection,
    reference: project.reference,
  });
  model = projectIndex(
    index,
    new PublicationPolicy(project.matrix, project.selection),
    { integrationOwnerSkill: project.integrationOwnerSkill },
  );
});

after(() => {
  scratch?.cleanup();
});

describe("model viewer package projection", () => {
  it("projects 35 records onto 25 safe local package models and preserves rotations", () => {
    assert.equal(model.records.length, 35);
    assert.equal(model.packagePreviews.length, 25);
    assert.equal(
      new Set(
        model.records.flatMap((record) =>
          record.reference.footprint ? [record.reference.footprint.packageId] : [],
        ),
      ).size,
      25,
    );
    assert.ok(
      model.records.some((record) =>
        Object.values(record.reference.footprint?.rotation ?? {}).some((value) => value !== 0),
      ),
    );
  });
});
