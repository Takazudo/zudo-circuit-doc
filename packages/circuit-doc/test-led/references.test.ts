/**
 * The LED document/package reference contract (#26), ported from upstream
 * `references.test.ts:25-98` (`194d8a297e3545588197342130c3111a66c10973`).
 *
 * The pure preview-asset/VRML safety checks (upstream lines 100-136) are
 * already carried into `test/provider/references.test.ts` (#15) — the same
 * code path, exercised without a real corpus. What is LED-bound is the
 * reviewed document selection itself: which source each record's PDF link
 * comes from, and the one-time live-verification record
 * (`fixtures/led/circuit/document-verification.json`, ported verbatim from
 * `CIRCUIT_DOCUMENT_VERIFICATION`).
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { PublicationPolicy } from "../src/core/publication.ts";
import { readEvidenceIndex, projectIndex } from "../src/provider/v1/index.ts";
import type { PublicViewModel } from "../src/core/view-model.ts";
import type { LoadedProject } from "../src/cli/project.ts";
import { setUpLedProject, type LedScratch } from "./support/led-project.ts";

type DocumentVerification = {
  readonly schema_version: 1;
  readonly checkedOn: string;
  readonly expectedContent: string;
  readonly downloadedPdfSourceIds: readonly string[];
  readonly officialPdfContentSourceIds: readonly string[];
};

let scratch: LedScratch;
let project: LoadedProject;
let model: PublicViewModel;
let documentVerification: DocumentVerification;

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
  documentVerification = JSON.parse(
    await readFile(join(scratch.dir, "circuit/document-verification.json"), "utf8"),
  ) as DocumentVerification;
});

after(() => {
  scratch?.cleanup();
});

describe("reviewed document shortcuts", () => {
  it("selects exactly one explicit PDF-representing document for all 35 records", () => {
    assert.equal(project.selection.documentSelections.length, 35);
    assert.equal(new Set(project.selection.documentSelections.map((entry) => entry.recordId)).size, 35);
    assert.equal(model.records.length, 35);
    for (const record of model.records) {
      assert.match(record.reference.document!.url, /^https?:\/\//u);
      assert.ok(["Datasheet PDF", "Specification PDF", "Mechanical drawing PDF"].includes(record.reference.document!.label));
      assert.equal(record.reference.document!.sourceId.length > 0, true);
      assert.equal(record.reference.document!.documentTitle.length > 0, true);
      assert.equal(record.reference.document!.authorityClass.length > 0, true);
      assert.equal(record.reference.document!.availability.length > 0, true);
    }
  });

  it("locks one content-based live-verification result for every selected source", () => {
    const verified = [
      ...documentVerification.downloadedPdfSourceIds,
      ...documentVerification.officialPdfContentSourceIds,
    ];
    assert.equal(documentVerification.checkedOn, "2026-08-23");
    assert.equal(documentVerification.expectedContent, "PDF");
    assert.equal(verified.length, 35);
    assert.equal(new Set(verified).size, 35);
    assert.deepEqual(
      [...verified].sort(),
      project.selection.documentSelections.map((entry) => entry.sourceId).sort(),
    );
  });

  it("does not infer kind from suffix or source order", () => {
    const queryDownload = model.records.find((record) => record.identity.recordId === "rec-c13585");
    assert.ok(queryDownload);
    assert.equal(queryDownload.reference.document!.documentKind, "specification");
    assert.match(queryDownload.reference.document!.url, /download\.do\?/u);
    const drawing = model.records.find((record) => record.identity.recordId === "rec-c492404");
    assert.equal(drawing?.reference.document!.label, "Mechanical drawing PDF");
  });

  it("uses the public exact-part PDF for TYPE-C instead of the referer-gated manufacturer asset", () => {
    const typeC = model.records.find((record) => record.identity.recordId === "rec-type-c-31-m-17");
    assert.equal(typeC?.reference.document!.sourceId, "src-type-c-c283540");
    assert.equal(typeC?.reference.document!.documentKind, "drawing");
    assert.equal(typeC?.reference.document!.label, "Mechanical drawing PDF");
    assert.equal(
      typeC?.reference.document!.url,
      "https://datasheet.lcsc.com/datasheet/pdf/26d9c5bff410f020782d77a1fd4062b2.pdf?productCode=C283540",
    );
    assert.doesNotMatch(typeC?.reference.document!.url ?? "", /thefastfile\.com/u);
  });

  it("retains STM32's audited availability without inventing an exception label", () => {
    const stm = model.records.find((record) => record.identity.recordId === "rec-c529334");
    assert.equal(stm?.reference.document!.sourceId, "src-c529334-ds");
    assert.equal(stm?.reference.document!.availability, "SOURCE UNAVAILABLE");
    assert.equal(stm?.reference.document!.label, "Datasheet PDF");
  });
});

describe("KiCad preview manifest", () => {
  it("maps every record to one descriptor and collapses it to exactly 25 packages", () => {
    assert.equal(
      model.records.filter((record) => record.reference.footprint?.modelPath?.endsWith(".wrl")).length,
      35,
    );
    assert.equal(model.packagePreviews.length, 25);
    assert.equal(new Set(model.packagePreviews.map((entry) => entry.packageId)).size, 25);
    assert.equal(model.packagePreviews.flatMap((entry) => entry.recordIds).length, 35);
  });

  it("preserves non-zero Z rotations from the footprint", () => {
    const fnr = model.packagePreviews.find((entry) => entry.footprintName === "IND-SMD_L4.0-W4.0_FNR40XXS");
    const r0603 = model.packagePreviews.find((entry) => entry.footprintName === "R0603");
    assert.equal(fnr?.rotation?.z, 90);
    assert.equal(r0603?.rotation?.z, 270);
  });
});
