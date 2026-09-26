/**
 * Correctness gates on the real LED corpus (#26): the parts of upstream
 * `gates.test.ts` (`194d8a297e3545588197342130c3111a66c10973`) that are bound
 * to the real corpus figures and to the committed denial matrix.
 *
 * The rendering-heavy assertions in the upstream file (every record's page
 * carrying its facts/sources/coverage, the catalog, per-page rendering) are
 * NOT ported here: they exercise the generic renderers against whatever
 * corpus is projected, which the generic `test/provider` and `test/core`
 * suites (#5/#13) already cover with a synthetic fixture. What is LED-bound
 * and irreplaceable is the exact split the epic states — open=68,
 * barren(no fact, no blocker)=24, open-without-blocker=31 — and the mapping
 * from the eight denied `FieldKey`s to the provider keys the canary harvest
 * must walk.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { FIELD_KEYS, PublicationPolicy, type FieldKey } from "../src/core/publication.ts";
import { readEvidenceIndex, projectIndex } from "../src/provider/v1/index.ts";
import { DENIED_PROVIDER_KEYS } from "../src/provider/v1/canaries.ts";
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

describe("open coverage never reads as safety", () => {
  it("still finds the corpus split the epic states", () => {
    const open = model.records.flatMap((record) =>
      record.coverage.filter((entry) => entry.status === "OPEN"),
    );
    assert.equal(open.length, 68);
    // The hard case: open because NOTHING addresses the domain, so there is no
    // fact to show and no blocker to blame.
    const barren = open.filter(
      (entry) => entry.factIds.length === 0 && entry.blockingFactIds.length === 0,
    );
    assert.equal(barren.length, 24);
    assert.equal(open.filter((entry) => entry.blockingFactIds.length === 0).length, 31);
  });
});

describe("the canary set cannot quietly become empty", () => {
  /**
   * Every provider key name a denied `FieldKey` reads from. Written out rather
   * than derived, because the mapping from a view-model leaf to the provider
   * key that feeds it lives in the adapter's projection code and nowhere
   * else — so the day a decision flips, this table is what fails.
   */
  const PROVIDER_KEY_FOR_DENIED_FIELD: Readonly<Record<string, string>> = {
    "source.sha256": "sha256",
    "source.evidenceExtract": "evidence_extract",
    "source.alternateAuthoritativeUrl": "alternate_authoritative_url",
    "source.physicalPdfPageIndex": "physical_pdf_page_index",
    "routing.positivePrompts": "positive",
    "routing.negativePrompts": "negative",
    "pinMap.reviewedBy": "reviewed_by",
    // No provider key: V1 reads no assets at all, so there is nothing to canary.
    "asset.binary": "",
  };

  it("covers every denied field in the committed matrix", () => {
    const denied = FIELD_KEYS.filter((key) => project.matrix[key] === "DENY");
    assert.equal(denied.length, 8, "the number of denied fields moved without review");

    for (const key of denied) {
      const providerKey = PROVIDER_KEY_FOR_DENIED_FIELD[key];
      assert.ok(
        providerKey !== undefined,
        `${key} is denied but no provider key is mapped for the canary scan`,
      );
      if (providerKey === "") continue;
      assert.ok(
        DENIED_PROVIDER_KEYS.includes(providerKey),
        `${key} reads ${providerKey}, which the canary harvest does not walk`,
      );
    }
  });

  it("maps no provider key to a field the matrix publishes", () => {
    // The converse of the test above: this table going stale in the other
    // direction would leave a canary walking a key whose field is now public,
    // and the scan would fail on a correct build.
    for (const key of Object.keys(PROVIDER_KEY_FOR_DENIED_FIELD)) {
      assert.equal(
        project.matrix[key as FieldKey],
        "DENY",
        `${key} is mapped as denied here but published by the matrix`,
      );
    }
  });
});
