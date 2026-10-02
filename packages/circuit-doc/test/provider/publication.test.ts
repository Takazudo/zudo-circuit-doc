import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ComponentDocsError } from "../../src/core/errors.ts";
import {
  FIELD_KEYS,
  PublicationPolicy,
  type InstanceSelection,
  type PublicationMatrix,
} from "../../src/core/publication.ts";
import { VIEW_MODEL_VERSION } from "../../src/core/view-model.ts";
import { CIRCUIT_PUBLICATION_MATRIX } from "../../src/provider/v1/matrix.ts";
import { FIXTURE_SELECTION } from "../fixtures/provider-fixtures.ts";

const selection: InstanceSelection = {
  recordIds: ["rec-a"],
  sourceIds: ["src-a"],
  linkableSourceIds: ["src-a"],
  documentSelections: [{ recordId: "rec-a", sourceId: "src-a", documentKind: "datasheet" }],
  expect: { records: 1, sources: 1, integrationRules: 0 },
};

function matrixOf(overrides: Partial<PublicationMatrix> = {}): PublicationMatrix {
  const base = Object.fromEntries(FIELD_KEYS.map((key) => [key, "DENY"])) as PublicationMatrix;
  return { ...base, ...overrides };
}

describe("PublicationPolicy gates", () => {
  it("withholds a denied field's value entirely", () => {
    const policy = new PublicationPolicy(matrixOf(), selection);
    assert.equal(policy.publish("fact.value", 42), undefined);
  });

  it("passes a published field through untouched", () => {
    const policy = new PublicationPolicy(matrixOf({ "fact.value": "PUBLISH" }), selection);
    assert.equal(policy.publish("fact.value", 42), 42);
  });

  it("treats a denied but structurally required field as fatal", () => {
    const policy = new PublicationPolicy(matrixOf(), selection);
    assert.throws(
      () => policy.publishRequired("record.mpn", "AL8860MP-13"),
      (error: unknown) =>
        error instanceof ComponentDocsError && error.code === "PUBLICATION_POLICY",
    );
  });

  it("rejects a linkable source that is not itself selected", () => {
    assert.throws(
      () =>
        new PublicationPolicy(matrixOf(), {
          ...selection,
          linkableSourceIds: ["src-unselected"],
        }),
      (error: unknown) =>
        error instanceof ComponentDocsError && error.code === "PUBLICATION_POLICY",
    );
  });

  it("selects nothing by default — an unlisted instance is unpublished", () => {
    const policy = new PublicationPolicy(matrixOf(), selection);
    assert.equal(policy.isRecordSelected("rec-a"), true);
    assert.equal(policy.isRecordSelected("rec-not-listed"), false);
    assert.equal(policy.isSourceSelected("src-not-listed"), false);
  });

  it("accepts a document selection and exception as the complete selected-record partition", () => {
    const policy = new PublicationPolicy(matrixOf(), {
      ...selection,
      recordIds: ["rec-a", "rec-b"],
      documentExceptions: [{ recordId: "rec-b", reason: "No public document exists." }],
    });
    assert.equal(policy.isRecordSelected("rec-b"), true);
  });

  it("rejects an exception for an unselected record", () => {
    assert.throws(
      () =>
        new PublicationPolicy(matrixOf(), {
          ...selection,
          documentExceptions: [{ recordId: "rec-outside", reason: "No public document exists." }],
        }),
      (error: unknown) =>
        error instanceof ComponentDocsError &&
        error.code === "PUBLICATION_POLICY" &&
        /document exception for record rec-outside is outside selected records/u.test(error.message),
    );
  });

  it("rejects a duplicate document exception", () => {
    assert.throws(
      () =>
        new PublicationPolicy(matrixOf(), {
          ...selection,
          documentSelections: [],
          documentExceptions: [
            { recordId: "rec-a", reason: "No public document exists." },
            { recordId: "rec-a", reason: "Reviewed again." },
          ],
        }),
      (error: unknown) =>
        error instanceof ComponentDocsError &&
        error.code === "PUBLICATION_POLICY" &&
        /record rec-a has multiple document exceptions/u.test(error.message),
    );
  });

  it("rejects a record present in both document lists", () => {
    assert.throws(
      () =>
        new PublicationPolicy(matrixOf(), {
          ...selection,
          documentExceptions: [{ recordId: "rec-a", reason: "No public document exists." }],
        }),
      (error: unknown) =>
        error instanceof ComponentDocsError &&
        error.code === "PUBLICATION_POLICY" &&
        /record rec-a has both a document selection and exception/u.test(error.message),
    );
  });

  it("rejects whitespace-only and control-character exception reasons", () => {
    for (const reason of [" \t ", "reason\u0007 unsafe", "reason\u200e unsafe", `a${"a".repeat(1000)}`]) {
      assert.throws(
        () =>
          new PublicationPolicy(matrixOf(), {
            ...selection,
            documentSelections: [],
            documentExceptions: [{ recordId: "rec-a", reason }],
          }),
        (error: unknown) =>
          error instanceof ComponentDocsError &&
          error.code === "PUBLICATION_POLICY" &&
          /document exception for record rec-a has an unsafe reason/u.test(error.message),
      );
    }
  });

  it("requires every selected record to have exactly one document selection or exception", () => {
    assert.throws(
      () => new PublicationPolicy(matrixOf(), { ...selection, documentSelections: [] }),
      (error: unknown) =>
        error instanceof ComponentDocsError &&
        error.code === "PUBLICATION_POLICY" &&
        error.message.includes("every selected record must have exactly one document selection or document exception") &&
        Array.isArray(error.detail.recordsWithoutDocument) &&
        error.detail.recordsWithoutDocument.includes("rec-a"),
    );
  });

  it("keeps an omitted documentExceptions key equivalent to an empty list", () => {
    const policy = new PublicationPolicy(matrixOf(), selection);
    assert.equal(policy.isRecordSelected("rec-a"), true);
  });

  it("accepts a safe exception reason at the 1000-character limit", () => {
    const policy = new PublicationPolicy(matrixOf(), {
      ...selection,
      documentSelections: [],
      documentExceptions: [{ recordId: "rec-a", reason: "a".repeat(1000) }],
    });
    assert.equal(policy.isRecordSelected("rec-a"), true);
  });
});

describe("selection freshness", () => {
  it("fails when the selection names a record the provider lost", () => {
    const policy = new PublicationPolicy(matrixOf(), selection);
    assert.throws(
      () => policy.assertSelectionFresh(["rec-other"], ["src-a"], 0),
      (error: unknown) =>
        error instanceof ComponentDocsError && error.code === "STALE_SELECTION",
    );
  });

  it("fails when the corpus grew", () => {
    const policy = new PublicationPolicy(matrixOf(), selection);
    assert.throws(
      () => policy.assertSelectionFresh(["rec-a", "rec-new"], ["src-a"], 0),
      (error: unknown) =>
        error instanceof ComponentDocsError && error.code === "STALE_SELECTION",
    );
  });

  it("fails when the integration ruleset changed size", () => {
    const policy = new PublicationPolicy(matrixOf(), selection);
    assert.throws(
      () => policy.assertSelectionFresh(["rec-a"], ["src-a"], 1),
      (error: unknown) =>
        error instanceof ComponentDocsError && error.code === "STALE_SELECTION",
    );
  });

  it("records that the check ran", () => {
    const policy = new PublicationPolicy(matrixOf(), selection);
    assert.equal(policy.selectionChecked, false);
    policy.assertSelectionFresh(["rec-a"], ["src-a"], 0);
    assert.equal(policy.selectionChecked, true);
  });
});

describe("committed circuit policy", () => {
  it("records a decision for every field", () => {
    for (const key of FIELD_KEYS) {
      assert.ok(
        CIRCUIT_PUBLICATION_MATRIX[key] === "PUBLISH" ||
          CIRCUIT_PUBLICATION_MATRIX[key] === "DENY",
        `no decision for ${key}`,
      );
    }
  });

  it("denies every field the epic names as opt-in-only", () => {
    for (const key of [
      "source.sha256",
      "source.evidenceExtract",
      "source.alternateAuthoritativeUrl",
      "source.physicalPdfPageIndex",
      "routing.positivePrompts",
      "routing.negativePrompts",
      "pinMap.reviewedBy",
      "asset.binary",
    ] as const) {
      assert.equal(CIRCUIT_PUBLICATION_MATRIX[key], "DENY", `${key} must stay denied in V1`);
    }
  });

  it("produces a deterministic report", () => {
    const policy = new PublicationPolicy(CIRCUIT_PUBLICATION_MATRIX, FIXTURE_SELECTION);
    const build = (): string =>
      JSON.stringify(
        policy.buildReport({
          viewModelVersion: VIEW_MODEL_VERSION,
          providerId: "circuit-component-spec",
          providerContractVersion: 1,
          availableRecords: 32,
          availableSources: 81,
          selectedSlugs: ["b", "a"],
          counts: { z: 1, a: 2 },
        }),
      );
    assert.equal(build(), build());
    assert.match(build(), /"slugs":\["a","b"\]/u);
    assert.match(build(), /"counts":\{"a":2,"z":1\}/u);
  });
});
