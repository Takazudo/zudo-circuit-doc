/**
 * The publication projection, proved against the fixture corpus.
 *
 * Everything here runs without a filesystem, without Python and without the
 * real evidence: `indexEvidence` and `projectIndex` are pure, so a failure
 * mode that the real corpus does not contain (an un-selected source, a
 * non-linkable URL, a denied field full of canaries) can still be exercised.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ComponentDocsError } from "../../src/core/errors.ts";
import { PublicationPolicy, type InstanceSelection } from "../../src/core/publication.ts";
import { indexEvidence as rawIndexEvidence, type InventoryLine } from "../../src/provider/v1/evidence.ts";
import { projectIndex } from "../../src/provider/v1/index.ts";
import { VIEW_MODEL_VERSION, type PublicViewModel } from "../../src/core/view-model.ts";
import {
  ALL_CANARY_STRINGS,
  FIXTURE_MATRIX,
  FIXTURE_SELECTION,
  withFixtureReferences,
  fixtureBundle,
  fixtureIntegrationRules,
  fixtureInventory,
} from "../fixtures/provider-fixtures.ts";

const indexEvidence = (...args: Parameters<typeof rawIndexEvidence>) =>
  withFixtureReferences(rawIndexEvidence(...args));

function project(selection: InstanceSelection = FIXTURE_SELECTION): {
  model: PublicViewModel;
  policy: PublicationPolicy;
} {
  const index = indexEvidence(fixtureInventory(), [fixtureBundle()], fixtureIntegrationRules());
  const policy = new PublicationPolicy(FIXTURE_MATRIX, selection);
  return { model: projectIndex(index, policy), policy };
}

function recordOf(model: PublicViewModel, slug: string) {
  const found = model.records.find((record) => record.identity.slug === slug);
  assert.ok(found, `no record with slug ${slug}`);
  return found;
}

describe("effective placement fit", () => {
  function projectLine(change: (line: InventoryLine) => void): PublicViewModel {
    const inventory = fixtureInventory();
    change(inventory.lines[0]!);
    const index = indexEvidence(inventory, [fixtureBundle()], fixtureIntegrationRules());
    return projectIndex(index, new PublicationPolicy(FIXTURE_MATRIX, FIXTURE_SELECTION));
  }

  it("preserves both bits on a two-board mixed line and rolls up to fitted", () => {
    const model = projectLine((line) => {
      delete line.dnp;
      line.placements = [
        { board: "L", refdes: "U2", dnp: true },
        { board: "P", refdes: "U7", dnp: false },
      ];
    });
    const { identity } = recordOf(model, "driver");
    assert.equal(identity.dnp, false);
    assert.deepEqual(identity.placements, [
      { board: "L", refdes: "U2", dnp: true },
      { board: "P", refdes: "U7", dnp: false },
    ]);
  });

  for (const dnp of [false, true]) {
    it(`inherits line dnp=${dnp}, accepting matching explicit placement bits`, () => {
      const model = projectLine((line) => {
        line.dnp = dnp;
        line.placements = [{ board: "L", refdes: "U2" }, { board: "P", refdes: "U7", dnp }];
      });
      const { identity } = recordOf(model, "driver");
      assert.equal(identity.dnp, dnp);
      assert.deepEqual(identity.placements.map((p) => p.dnp), [dnp, dnp]);
    });

    it(`rolls up uniform explicit placement dnp=${dnp} without a line bit`, () => {
      const model = projectLine((line) => {
        delete line.dnp;
        line.placements = [{ board: "L", refdes: "U2", dnp }, { board: "P", refdes: "U7", dnp }];
      });
      assert.equal(recordOf(model, "driver").identity.dnp, dnp);
    });

    it(`uses line dnp=${dnp} when there are no placements`, () => {
      const model = projectLine((line) => { line.dnp = dnp; line.placements = []; });
      assert.equal(recordOf(model, "driver").identity.dnp, dnp);
      assert.deepEqual(recordOf(model, "driver").identity.placements, []);
    });

    it(`rejects a placement bit conflicting with line dnp=${dnp}`, () => {
      assert.throws(() => projectLine((line) => {
        line.dnp = dnp;
        line.placements[0]!.dnp = !dnp;
      }), (error: unknown) => error instanceof ComponentDocsError &&
        error.code === "ADAPTER_CONTRACT" && /conflicts/u.test(error.message));
    });
  }

  it("rejects a missing fit bit even when another placement has one", () => {
    assert.throws(() => projectLine((line) => {
      delete line.dnp;
      line.placements = [{ board: "L", refdes: "U2", dnp: false }, { board: "P", refdes: "U7" }];
    }), (error: unknown) => error instanceof ComponentDocsError && error.code === "ADAPTER_CONTRACT");
  });

  it("rejects a placement-less line with no fit bit", () => {
    assert.throws(() => projectLine((line) => {
      delete line.dnp;
      line.placements = [];
    }), (error: unknown) => error instanceof ComponentDocsError && error.code === "ADAPTER_CONTRACT");
  });

  for (const invalid of [null, "false", 0]) {
    it(`rejects invalid JSON fit bit ${JSON.stringify(invalid)} at either level`, () => {
      for (const placement of [false, true]) {
        assert.throws(() => projectLine((line) => {
          Object.assign(placement ? line.placements[0]! : line, { dnp: invalid });
        }), (error: unknown) => error instanceof ComponentDocsError && error.code === "ADAPTER_CONTRACT");
      }
    });
  }
});

describe("normalized relationships", () => {
  it("orders records inventory-line first, each standalone followed by its subordinates", () => {
    const { model } = project();
    assert.deepEqual(
      model.records.map((record) => record.identity.slug),
      ["driver", "sense", "handfit"],
    );
  });

  it("keeps a subordinate's owner and parent links visible", () => {
    const { model } = project();
    const sense = recordOf(model, "sense");

    assert.equal(sense.identity.kind, "subordinate");
    assert.equal(sense.identity.parentRecordId, "rec-driver");
    assert.equal(sense.identity.parentSlug, "driver");
    assert.equal(recordOf(model, "driver").identity.kind, "standalone");
    assert.equal(recordOf(model, "driver").identity.parentRecordId, null);
    assert.equal(recordOf(model, "driver").identity.parentSlug, null);
  });

  it("publishes a DNP / hand-fit line as such", () => {
    const { model } = project();
    const handfit = recordOf(model, "handfit");
    assert.equal(handfit.identity.dnp, true);
    assert.equal(recordOf(model, "driver").identity.dnp, false);
    assert.deepEqual(
      handfit.identity.placements.map((placement) => `${placement.board}${placement.refdes}`),
      ["LJ9"],
    );
  });

  it("keeps every pin map when one record has more than one", () => {
    const { model } = project();
    const handfit = recordOf(model, "handfit");
    assert.deepEqual(
      handfit.pinMaps.map((map) => map.pinMapId),
      ["pinmap-handfit-a", "pinmap-handfit-b"],
    );
    assert.deepEqual(
      handfit.pinMaps.map((map) => map.symbol),
      ["FIX-SWD-HDR", "FIX-SWD-HDR-ALT"],
    );
    assert.deepEqual(
      handfit.pinMaps[0]!.pins.map((pin) => pin.symbolPin),
      ["1", "2"],
    );
  });

  it("publishes an unavailable source with its unavailability and its link", () => {
    const { model } = project();
    const gone = recordOf(model, "driver").sources.find(
      (source) => source.sourceId === "src-driver-gone",
    );
    assert.ok(gone);
    assert.equal(gone.availability, "SOURCE UNAVAILABLE");
    assert.equal(gone.url, "https://fixture.example.com/mirror/fix8860-rev-b.pdf");
    assert.equal(gone.authorityClass, "MANUFACTURER_MIRROR");
  });

  it("keeps sources in the order the manifest curated them", () => {
    const { model } = project();
    assert.deepEqual(
      recordOf(model, "driver").sources.map((source) => source.sourceId),
      ["src-driver-primary", "src-driver-gone"],
    );
  });

  it("publishes an open domain with its exact blockers", () => {
    const { model } = project();
    const thermal = recordOf(model, "driver").coverage.find(
      (entry) => entry.coverageId === "cov-driver-thermal",
    );
    assert.ok(thermal);
    assert.equal(thermal.status, "OPEN");
    assert.deepEqual(thermal.blockingFactIds, ["fact-driver-current-min"]);
    assert.match(thermal.reason, /NEEDS BENCH/u);
  });

  it("publishes an open domain that has no applicable blocking fact", () => {
    const { model } = project();
    const fit = recordOf(model, "handfit").coverage.find(
      (entry) => entry.coverageId === "cov-handfit-fit",
    );
    assert.ok(fit);
    assert.equal(fit.status, "OPEN");
    assert.deepEqual(fit.blockingFactIds, []);
    // Empty blockers must not become an empty reason: the page would otherwise
    // show an open domain with nothing said about why.
    assert.notEqual(fit.reason, "");
    assert.deepEqual(fit.factIds, ["fact-handfit-pitch"]);
  });

  it("never synthesises a record-wide verdict", () => {
    const { model } = project();
    const driver = recordOf(model, "driver");
    // Coverage is per domain, and the record itself carries no status field.
    assert.deepEqual(
      driver.coverage.map((entry) => `${entry.domain}=${entry.status}`),
      ["input-ratings=COVERED", "thermal=OPEN"],
    );
    assert.equal("status" in driver.identity, false);
    assert.equal("verdict" in driver.identity, false);
  });

  it("preserves a calculated fact's expression and its cross-record dependency", () => {
    const { model } = project();
    const calculated = recordOf(model, "driver").facts.find(
      (entry) => entry.factId === "fact-driver-current-min",
    );
    assert.ok(calculated);
    assert.equal(calculated.expression, "0.096 / 0.21");
    assert.deepEqual(calculated.dependsOn, ["fact-sense-resistance-max"]);
    assert.equal(calculated.provenance, "CALCULATED");

    // The edge crosses a record boundary, and the target is published.
    const target = recordOf(model, "sense").facts.find(
      (entry) => entry.factId === "fact-sense-resistance-max",
    );
    assert.ok(target);
    assert.equal(target.recordId, "rec-sense");
    assert.notEqual(target.recordId, calculated.recordId);
  });

  it("leaves a raw fact's expression empty rather than inventing one", () => {
    const { model } = project();
    const raw = recordOf(model, "driver").facts.find(
      (entry) => entry.factId === "fact-driver-vin-max",
    );
    assert.ok(raw);
    assert.equal(raw.expression, "");
    assert.deepEqual(raw.dependsOn, []);
  });

  it("publishes aliases for every record", () => {
    const { model } = project();
    assert.deepEqual(recordOf(model, "driver").aliases, {
      mpn: ["FIX8860MP-13"],
      lcsc: ["C900001"],
      manufacturer: ["Fixture Semiconductor"],
      function: ["fixture part"],
    });
  });
});

describe("fact values keep their JSON shape", () => {
  it("keeps an integer an integer and a float a float", () => {
    const { model } = project();
    const facts = recordOf(model, "driver").facts;
    assert.strictEqual(facts.find((f) => f.factId === "fact-driver-vin-max")?.value, 42);
    assert.strictEqual(facts.find((f) => f.factId === "fact-driver-current-min")?.value, 0.457);
  });

  it("keeps a string a string", () => {
    const { model } = project();
    assert.strictEqual(
      recordOf(model, "handfit").facts.find((f) => f.factId === "fact-handfit-pitch")?.value,
      "2.54 mm single row",
    );
  });

  it("keeps a structured value structured, sorted by key", () => {
    const { model } = project();
    const identity = recordOf(model, "driver").facts.find(
      (f) => f.factId === "fact-driver-identity",
    );
    assert.ok(identity);
    assert.ok(Array.isArray(identity.value));
    assert.deepEqual(identity.value, [
      { key: "lcsc", value: "C900001" },
      { key: "manufacturer", value: "Fixture Semiconductor" },
      { key: "mpn", value: "FIX8860MP-13" },
      { key: "variant", value: "exact orderable" },
    ]);
  });

  it("refuses a value shape it has no honest rendering for", () => {
    for (const value of [true, null, ["a", "b"], { nested: { deeper: 1 } }]) {
      const index = indexEvidence(fixtureInventory(), [
        fixtureBundle({
          facts: (facts) =>
            facts.map((entry) =>
              entry.fact_id === "fact-driver-vin-max" ? { ...entry, value } : entry,
            ),
        }),
      ], fixtureIntegrationRules());
      assert.throws(
        () => projectIndex(index, new PublicationPolicy(FIXTURE_MATRIX, FIXTURE_SELECTION)),
        (error: unknown) =>
          error instanceof ComponentDocsError && error.code === "ADAPTER_CONTRACT",
        `value ${JSON.stringify(value)} should not project`,
      );
    }
  });
});

describe("interactions reach every record they name", () => {
  it("attaches a multi-record interaction to each participant", () => {
    const { model } = project();
    for (const slug of ["driver", "sense"]) {
      assert.deepEqual(
        recordOf(model, slug).interactions.map((entry) => entry.interactionId),
        ["int-power-stage"],
        `${slug} is a participant and must carry the interaction`,
      );
    }
    // A record that participates in nothing carries nothing.
    assert.deepEqual(recordOf(model, "handfit").interactions, []);
  });

  it("publishes the same participant list on every page it lands on", () => {
    const { model } = project();
    for (const slug of ["driver", "sense"]) {
      const interaction = recordOf(model, slug).interactions[0]!;
      assert.deepEqual(interaction.recordIds, ["rec-driver", "rec-sense"]);
      assert.deepEqual(interaction.factIds, [
        "fact-driver-current-min",
        "fact-sense-resistance-max",
      ]);
      assert.equal(interaction.verdict, "NEEDS BENCH");
      assert.equal(interaction.anchor, "int-power-stage");
    }
  });

  it("emits every anchor exactly once within each page", () => {
    const { model } = project();
    for (const record of model.records) {
      const anchors = [
        record.identity.anchor,
        ...record.sources.map((entry) => entry.anchor),
        ...record.facts.map((entry) => entry.anchor),
        ...record.coverage.map((entry) => entry.anchor),
        ...record.interactions.map((entry) => entry.anchor),
        ...record.pinMaps.map((entry) => entry.anchor),
      ];
      assert.equal(new Set(anchors).size, anchors.length, record.identity.slug);
    }
  });

  it("never lets one anchor denote two different interactions", () => {
    const { model } = project();
    const byAnchor = new Map<string, string>();
    for (const interaction of model.records.flatMap((record) => record.interactions)) {
      const seen = byAnchor.get(interaction.anchor);
      if (seen !== undefined) assert.equal(seen, interaction.interactionId);
      byAnchor.set(interaction.anchor, interaction.interactionId);
    }
  });
});

describe("denied fields never reach the public model", () => {
  it("omits every canary from the projected view model", () => {
    const { model } = project();
    const serialized = JSON.stringify(model);
    for (const canary of ALL_CANARY_STRINGS) {
      assert.equal(serialized.includes(canary), false, `view model leaked ${canary}`);
    }
  });

  it("omits every canary from the preflight report", () => {
    const { model, policy } = project();
    const report = policy.buildReport({
      viewModelVersion: model.version,
      providerId: "fixture",
      providerContractVersion: 1,
      availableRecords: model.corpus.records,
      availableSources: model.corpus.sources,
      selectedSlugs: model.records.map((record) => record.identity.slug),
      counts: {},
    });
    const serialized = JSON.stringify(report);
    for (const canary of ALL_CANARY_STRINGS) {
      assert.equal(serialized.includes(canary), false, `preflight leaked ${canary}`);
    }
  });

  it("counts each denied field as withheld so the report shows it was seen", () => {
    const { model, policy } = project();
    const report = policy.buildReport({
      viewModelVersion: model.version,
      providerId: "fixture",
      providerContractVersion: 1,
      availableRecords: model.corpus.records,
      availableSources: model.corpus.sources,
      selectedSlugs: [],
      counts: {},
    });
    const withheld = new Map(report.fields.map((field) => [field.key, field]));

    // Four sources, three routes, three pin maps.
    assert.equal(withheld.get("source.sha256")?.withheld, 4);
    assert.equal(withheld.get("source.evidenceExtract")?.withheld, 4);
    assert.equal(withheld.get("source.alternateAuthoritativeUrl")?.withheld, 4);
    assert.equal(withheld.get("source.physicalPdfPageIndex")?.withheld, 4);
    assert.equal(withheld.get("routing.positivePrompts")?.withheld, 3);
    assert.equal(withheld.get("routing.negativePrompts")?.withheld, 3);
    assert.equal(withheld.get("pinMap.reviewedBy")?.withheld, 3);

    for (const field of report.fields) {
      if (field.decision === "DENY") assert.equal(field.emitted, 0, `${field.key} emitted`);
      else assert.equal(field.withheld, 0, `${field.key} withheld`);
    }
  });
});

describe("URL publication", () => {
  it("allows every fixture citation URL and records it once", () => {
    const { model, policy } = project();
    const report = policy.buildReport({
      viewModelVersion: model.version,
      providerId: "fixture",
      providerContractVersion: 1,
      availableRecords: model.corpus.records,
      availableSources: model.corpus.sources,
      selectedSlugs: [],
      counts: {},
    });
    assert.equal(report.urls.length, 4);
    assert.equal(report.urls.every((entry) => entry.decision === "ALLOW"), true);
  });

  it("withholds the link — and the URL string itself — for a non-linkable source", () => {
    const selection: InstanceSelection = {
      ...FIXTURE_SELECTION,
      linkableSourceIds: FIXTURE_SELECTION.linkableSourceIds.filter(
        (id) => id !== "src-driver-gone",
      ),
    };
    const { model, policy } = project(selection);

    const gone = recordOf(model, "driver").sources.find(
      (source) => source.sourceId === "src-driver-gone",
    );
    assert.ok(gone);
    // The source still publishes; only its outbound link is withheld.
    assert.equal(gone.url, null);
    assert.equal(gone.availability, "SOURCE UNAVAILABLE");

    const report = policy.buildReport({
      viewModelVersion: model.version,
      providerId: "fixture",
      providerContractVersion: 1,
      availableRecords: model.corpus.records,
      availableSources: model.corpus.sources,
      selectedSlugs: [],
      counts: {},
    });
    const denied = report.urls.find((entry) => entry.sourceId === "src-driver-gone");
    assert.deepEqual(denied, {
      sourceId: "src-driver-gone",
      url: "",
      decision: "DENY",
      reason: "SOURCE_NOT_LINKABLE",
    });
  });

  it("considers no URL at all when the field itself is denied", () => {
    const index = indexEvidence(fixtureInventory(), [fixtureBundle()], fixtureIntegrationRules());
    const policy = new PublicationPolicy(
      { ...FIXTURE_MATRIX, "source.authoritativeUrl": "DENY" },
      FIXTURE_SELECTION,
    );
    const model = projectIndex(index, policy);
    assert.equal(
      model.records.flatMap((entry) => entry.sources).every((source) => source.url === null),
      true,
    );

    const report = policy.buildReport({
      viewModelVersion: VIEW_MODEL_VERSION,
      providerId: "fixture",
      providerContractVersion: 1,
      availableRecords: 3,
      availableSources: 4,
      selectedSlugs: [],
      counts: {},
    });
    assert.equal(report.urls.every((entry) => entry.url === ""), true);
    assert.equal(report.urls.every((entry) => entry.reason === "FIELD_DENIED"), true);
    assert.equal(
      report.fields.find((field) => field.key === "source.authoritativeUrl")?.emitted,
      0,
    );
    assert.equal(JSON.stringify(report).includes("fixture.example.com"), false);
  });

  it("fails closed when the curated document URL is unsafe", () => {
    const index = indexEvidence(fixtureInventory(), [
      fixtureBundle({
        sources: (sources) =>
          sources.map((source) =>
            source.source_id === "src-driver-primary"
              ? { ...source, authoritative_url: "javascript:alert(1)" }
              : source,
          ),
      }),
    ], fixtureIntegrationRules());
    assert.throws(
      () => projectIndex(index, new PublicationPolicy(FIXTURE_MATRIX, FIXTURE_SELECTION)),
      (error: unknown) =>
        error instanceof ComponentDocsError &&
        error.code === "UNSAFE_VALUE" &&
        error.detail.sourceId === "src-driver-primary",
    );
  });
});

describe("selection stays closed under published links", () => {
  it("refuses to publish a record whose source is not selected", () => {
    const index = indexEvidence(fixtureInventory(), [fixtureBundle()], fixtureIntegrationRules());
    const selection: InstanceSelection = {
      ...FIXTURE_SELECTION,
      sourceIds: FIXTURE_SELECTION.sourceIds.filter((id) => id !== "src-driver-gone"),
      linkableSourceIds: FIXTURE_SELECTION.linkableSourceIds.filter(
        (id) => id !== "src-driver-gone",
      ),
      expect: { records: 3, sources: 4, integrationRules: 3 },
    };
    assert.throws(
      () => projectIndex(index, new PublicationPolicy(FIXTURE_MATRIX, selection)),
      (error: unknown) =>
        error instanceof ComponentDocsError && error.code === "STALE_SELECTION",
    );
  });

  it("refuses to publish a subordinate whose parent is not selected", () => {
    const index = indexEvidence(fixtureInventory(), [fixtureBundle()], fixtureIntegrationRules());
    const selection: InstanceSelection = {
      ...FIXTURE_SELECTION,
      recordIds: ["rec-sense", "rec-handfit"],
      documentSelections: FIXTURE_SELECTION.documentSelections.filter(
        (entry) => entry.recordId !== "rec-driver",
      ),
    };
    assert.throws(
      () => projectIndex(index, new PublicationPolicy(FIXTURE_MATRIX, selection)),
      (error: unknown) =>
        error instanceof ComponentDocsError && error.code === "STALE_SELECTION",
    );
  });

  it("refuses when the selection names a record the provider lost", () => {
    const index = indexEvidence(fixtureInventory(), [fixtureBundle()], fixtureIntegrationRules());
    const selection: InstanceSelection = {
      ...FIXTURE_SELECTION,
      recordIds: [...FIXTURE_SELECTION.recordIds, "rec-gone"],
      documentSelections: [
        ...FIXTURE_SELECTION.documentSelections,
        { recordId: "rec-gone", sourceId: "src-driver-primary", documentKind: "datasheet" },
      ],
    };
    assert.throws(
      () => projectIndex(index, new PublicationPolicy(FIXTURE_MATRIX, selection)),
      (error: unknown) =>
        error instanceof ComponentDocsError && error.code === "STALE_SELECTION",
    );
  });

  it("refuses when the corpus size moved under a still-valid selection", () => {
    const index = indexEvidence(fixtureInventory(), [fixtureBundle()], fixtureIntegrationRules());
    const selection: InstanceSelection = {
      ...FIXTURE_SELECTION,
      expect: { records: 4, sources: 4, integrationRules: 3 },
    };
    assert.throws(
      () => projectIndex(index, new PublicationPolicy(FIXTURE_MATRIX, selection)),
      (error: unknown) =>
        error instanceof ComponentDocsError && error.code === "STALE_SELECTION",
    );
  });
});

describe("repeated projection is byte-stable", () => {
  it("produces identical JSON for identical input", () => {
    assert.equal(JSON.stringify(project().model), JSON.stringify(project().model));
  });
});

describe("reviewed unavailable document", () => {
  const reason = "Distributor listing only; manufacturer document unavailable.";
  function projectException(matrix = FIXTURE_MATRIX) {
    const index = indexEvidence(fixtureInventory(), [fixtureBundle()], fixtureIntegrationRules());
    const references = index.references;
    assert.ok(references);
    const documentsByRecordId = new Map(references.documentsByRecordId);
    documentsByRecordId.delete("rec-handfit");
    const selection: InstanceSelection = {
      ...FIXTURE_SELECTION,
      documentSelections: FIXTURE_SELECTION.documentSelections.filter((entry) => entry.recordId !== "rec-handfit"),
      documentExceptions: [{ recordId: "rec-handfit", reason }],
    };
    const exceptionIndex = {
      ...index,
      references: { ...references, documentsByRecordId, documentExceptionsByRecordId: new Map([["rec-handfit", reason]]) },
    };
    return projectIndex(exceptionIndex, new PublicationPolicy(matrix, selection));
  }

  it("publishes the reason while retaining the footprint and model", () => {
    const record = recordOf(projectException(), "handfit");
    assert.deepEqual(record.sources.map((source) => source.authorityClass), ["DISTRIBUTOR_IDENTITY"]);
    assert.equal(record.reference.document, null);
    assert.equal(record.reference.documentUnavailableReason, reason);
    assert.ok(record.reference.footprint);
    assert.ok(record.reference.footprint.modelPath);
  });

  it("requires publication of the reviewed reason", () => {
    assert.throws(() => projectException({ ...FIXTURE_MATRIX, "reference.document.availability": "DENY" }),
      (error: unknown) => error instanceof ComponentDocsError && error.code === "PUBLICATION_POLICY");
  });
});

describe("PCB record without a published package (ADR-012 declared zero)", () => {
  function projectWithout(options: { declared: boolean; lcsc?: string }): PublicViewModel {
    const inventory = fixtureInventory();
    const lines = inventory.lines.map((line) =>
      line.line_id === "line-driver" && options.lcsc !== undefined ? { ...line, lcsc: options.lcsc } : line,
    );
    const index = withFixtureReferences(rawIndexEvidence({ ...inventory, lines }, [fixtureBundle()], fixtureIntegrationRules()));
    const references = index.references;
    assert.ok(references);
    const packageByRecordId = new Map(references.packageByRecordId);
    packageByRecordId.delete("rec-driver");
    const withoutDriver = {
      ...index,
      references: {
        ...references,
        packageByRecordId,
        unpublishedPackageRecordIds: new Set(options.declared ? ["rec-driver"] : []),
      },
    };
    return projectIndex(withoutDriver, new PublicationPolicy(FIXTURE_MATRIX, FIXTURE_SELECTION));
  }

  it("projects a declared-unpublished PCB record as mounting pcb with no footprint", () => {
    const driver = recordOf(projectWithout({ declared: true }), "driver");
    assert.equal(driver.reference.mounting, "pcb");
    assert.equal(driver.reference.footprint, null);
    assert.equal(recordOf(projectWithout({ declared: true }), "sense").reference.footprint === null, false);
  });

  it("still refuses a PCB record whose package is missing without the declared-zero lock", () => {
    assert.throws(
      () => projectWithout({ declared: false }),
      (error: unknown) =>
        error instanceof ComponentDocsError &&
        error.code === "ADAPTER_CONTRACT" &&
        /no complete reference descriptor/u.test(error.message),
    );
  });

  it("accepts an empty LCSC ID for a generic-profile line (ADR-010)", () => {
    const driver = recordOf(projectWithout({ declared: true, lcsc: "" }), "driver");
    assert.equal(String(driver.identity.lcsc), "");
  });
});
