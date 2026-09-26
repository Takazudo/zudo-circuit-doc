import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ALLOWED_COMPONENT_ATTRIBUTES } from "../../src/core/mdx.ts";
import { decodeComponentReferencesDescriptor } from "../../src/core/reference-descriptor.ts";
import { CATALOG_INDEX_ANCHOR, renderCatalog } from "../../src/core/render/catalog.ts";
import { renderRecord, renderRecordsIndex } from "../../src/core/render/record.ts";
import { buildRecordIndex } from "../../src/core/render/shared.ts";
import { ComponentDocsError } from "../../src/core/errors.ts";
import {
  FIXTURE_IDS,
  GUARD_REJECTED_TEXT,
  HOSTILE_TEXT,
  denseModel,
  emptyArraysModel,
  fixtureModel,
} from "../fixtures/view-model-fixtures.ts";
import { safeText } from "../../src/core/text.ts";
import type { PublicRecord, PublicViewModel } from "../../src/core/view-model.ts";

function pageFor(model: PublicViewModel, recordId: string): string {
  const record = model.records.find((entry) => entry.identity.recordId === recordId);
  assert.ok(record, `fixture has no record ${recordId}`);
  return renderRecord(record, buildRecordIndex(model)).contents;
}

function recordOf(model: PublicViewModel, recordId: string): PublicRecord {
  const record = model.records.find((entry) => entry.identity.recordId === recordId);
  assert.ok(record, `fixture has no record ${recordId}`);
  return record;
}

const model = fixtureModel();
const driverPage = pageFor(model, FIXTURE_IDS.driverRecord);
const sensePage = pageFor(model, FIXTURE_IDS.senseRecord);
const hostilePage = pageFor(model, FIXTURE_IDS.hostileRecord);
const catalogPage = renderCatalog(model).contents;

describe("catalog", () => {
  it("keeps the catalog index free of reference islands and model viewers", () => {
    assert.doesNotMatch(catalogPage, /<(?:ComponentReferences|PackageModelViewer)\b/u);
  });

  it("routes and names every record exactly once in the index", () => {
    for (const record of model.records) {
      const { identity } = record;
      assert.match(
        catalogPage,
        new RegExp(`\\[${escape(identity.mpn)}\\]\\(/docs/components/records/${identity.slug}/\\)`),
        `${identity.recordId} is not linked from the catalog`,
      );
      assert.ok(
        catalogPage.includes(`<EvidenceAnchor id="${identity.anchor}" />`),
        `${identity.recordId} has no anchor on the catalog`,
      );
      assert.ok(catalogPage.includes(`\`${identity.recordId}\``));
    }
  });

  it("marks a subordinate as subordinate and links its parent record", () => {
    assert.ok(catalogPage.includes("(subordinate)"));
    assert.match(
      catalogPage,
      new RegExp(
        `audited as part of \\[\`${FIXTURE_IDS.driverRecord}\`\\]` +
          `\\(/docs/components/records/${FIXTURE_IDS.driverSlug}/\\)`,
      ),
    );
  });

  it("states the open-domain denominator instead of a bare count", () => {
    // The whole point of the column: "2 of 3" cannot be misread as a score, and
    // a record with nothing published says so rather than counting to zero.
    assert.ok(catalogPage.includes("| 2 of 3 "), "expected an open/total ratio");
    const empty = renderCatalog(emptyArraysModel()).contents;
    assert.ok(empty.includes("none published"));
    assert.ok(!empty.includes("| 0 of 0 "), "an unchecked record must not read as 0 open");
  });

  it("publishes the identity payload the bill of materials needs", () => {
    for (const label of [
      "| Record ID",
      "| Manufacturer",
      "| Function",
      "| Orderable ID",
      "| Package",
      "| Inventory line",
      "**Placements:**",
      "**Fit:**",
      "**Identity state:**",
      "**Source state:**",
      "**Open coverage domains:**",
    ]) {
      assert.ok(catalogPage.includes(label), `catalog entry is missing ${label}`);
    }
    assert.ok(catalogPage.includes("**Fit:** DNP or hand-fit"));
    assert.ok(catalogPage.includes("**Fit:** Fitted"));
  });

  it("prints alternate search terms so a record is findable by its other names", () => {
    // Several real records are routed by LCSC code rather than part number, so
    // the alias has to be in the rendered page — search indexes the page, not
    // the view model.
    assert.match(catalogPage, /\| Also known as\s*\| `FX8860`/u);
    assert.match(driverPage, /\| Also known as\s*\| `FX8860`/u);
    // Terms already shown as identity fields are not repeated.
    assert.ok(!catalogPage.includes("`FX8860MP-13`, `FX8860`"));
    // A record with no extra aliases gets no empty row.
    assert.ok(!hostilePage.includes("**Also known as:**"));
  });

  it("groups placements by board rather than listing them flat", () => {
    assert.ok(catalogPage.includes("**Placements:** board-l U2; board-p U7"));
  });

  it("stays navigable at a density above the real corpus", () => {
    const dense = renderCatalog(denseModel(64)).contents;
    for (let n = 0; n < 64; n += 1) {
      assert.ok(
        dense.includes(`\`rec-fixture-dense-${n}\``),
        `dense record ${n} is missing from the catalog`,
      );
    }
    // The 24-placement line is the worst real case; it must stay in one cell
    // grouped by board, not explode the row.
    assert.match(dense, /\*\*Placements:\*\* board-p C1, C3.*; board-l C2, C4/u);
  });

  it("never renders a component-wide verdict", () => {
    assertNoAggregateVerdict(catalogPage);
  });
});

describe("record page — structure", () => {
  it("renders one reviewed component-reference descriptor for every record, before evidence tables", () => {
    for (const record of model.records) {
      const page = pageFor(model, record.identity.recordId);
      if (record.reference.footprint === null) {
        assert.match(page, /External panel-mounted component/u);
        assert.match(page, /Datasheet PDF/u);
        assert.doesNotMatch(page, /<ComponentReferences/u);
        continue;
      }
      const descriptors = [...page.matchAll(/<ComponentReferences descriptor="([0-9a-f]+)"/gu)];
      assert.equal(descriptors.length, 1, `${record.identity.recordId} needs one component references block`);
      const encoded = descriptors[0]?.[1];
      assert.ok(encoded);
      const reference = decodeComponentReferencesDescriptor(encoded);
      assert.equal(reference.document.label, record.reference.document.label);
      assert.equal(reference.document.title, record.reference.document.documentTitle);
      assert.equal(reference.document.authority, record.reference.document.authorityClass);
      assert.equal(reference.document.availability, record.reference.document.availability);
      assert.equal(reference.document.url, record.reference.document.url);
      assert.equal(reference.footprint.name, record.reference.footprint.footprintName);
      assert.equal(
        reference.footprint.assetUrl,
        `/assets/component-previews/footprints/${record.reference.footprint.footprintName}.svg`,
      );
      assert.ok(page.indexOf("<ComponentReferences") < page.indexOf("## Placements"));
      assert.ok(page.indexOf("## Sources") > page.indexOf("<ComponentReferences"));
    }
  });

  it("passes the reviewed PDF label through without deriving it from document kind", () => {
    const record = recordOf(model, FIXTURE_IDS.driverRecord);
    const altered = {
      ...record,
      reference: {
        ...record.reference,
        document: { ...record.reference.document, label: safeText("Mechanical drawing PDF", { field: "label" }) },
      },
    };
    const page = renderRecord(altered, buildRecordIndex(model)).contents;
    const encoded = /<ComponentReferences descriptor="([0-9a-f]+)"/u.exec(page)?.[1];
    assert.ok(encoded);
    assert.equal(decodeComponentReferencesDescriptor(encoded).document.label, "Mechanical drawing PDF");
  });

  it("renders every section, in the locked reading order", () => {
    const order = [
      "## Identity",
      "## Placements",
      "## Coverage",
      "## Facts",
      "## Calculation dependencies",
      "## Pin maps",
      "## Interactions",
      "## Sources",
      "## Legend",
      "## Raw agent resource",
    ];
    let cursor = -1;
    for (const section of order) {
      const at = driverPage.indexOf(section);
      assert.ok(at > cursor, `${section} is missing or out of order`);
      cursor = at;
    }
    // Coverage before facts is load-bearing: a reader must learn what is
    // unresolved before reading values as a settled specification.
    assert.ok(driverPage.indexOf("## Coverage") < driverPage.indexOf("## Facts"));
  });

  it("titles the page with the MPN while routing by the record ID", () => {
    const page = renderRecord(
      recordOf(model, FIXTURE_IDS.driverRecord),
      buildRecordIndex(model),
    );
    assert.equal(page.relativePath, `records/${FIXTURE_IDS.driverSlug}/index.mdx`);
    assert.ok(page.contents.includes('title: "FX8860MP-13"'));
  });

  it("anchors on evidence IDs, never on heading text", () => {
    const record = recordOf(model, FIXTURE_IDS.driverRecord);
    const expected = [
      record.identity.anchor,
      ...record.sources.map((source) => source.anchor),
      ...record.facts.map((fact) => fact.anchor),
      ...record.coverage.map((entry) => entry.anchor),
      ...record.interactions.map((entry) => entry.anchor),
      ...record.pinMaps.map((entry) => entry.anchor),
    ];
    for (const anchor of expected) {
      assert.ok(
        driverPage.includes(`<EvidenceAnchor id="${anchor}" />`),
        `no anchor emitted for ${anchor}`,
      );
    }
  });

  it("explains a subordinate record and links its parent", () => {
    assert.ok(sensePage.includes("## Subordinate record"));
    assert.ok(sensePage.includes("This is a subordinate record."));
    assert.match(
      sensePage,
      new RegExp(
        `\\[\`${FIXTURE_IDS.driverRecord}\`\\]\\(/docs/components/records/` +
          `${FIXTURE_IDS.driverSlug}/\\)`,
      ),
    );
    assert.ok(!driverPage.includes("## Subordinate record"), "a standalone record must not claim one");
  });

  it("links the owning bundle, not the agent-resource index", () => {
    // `ownerSkill` has landed, so both surfaces now name the bundle and link it
    // directly. The distinction still matters: a link to the resource index
    // would read as this record's bundle and go somewhere else, and a
    // convincingly wrong link is worse than a stated absence.
    assert.ok(driverPage.includes("## Raw agent resource"));
    assert.ok(driverPage.includes("the bundle is right and this page is stale"));
    assert.ok(driverPage.includes(`(/docs/claude-skills/${FIXTURE_IDS.ownerSkill}/)`));
    assert.ok(catalogPage.includes(`(/docs/claude-skills/${FIXTURE_IDS.ownerSkill}/)`));
    assert.ok(!driverPage.includes("(/docs/claude-skills/)"));
    assert.ok(!catalogPage.includes("(/docs/claude-skills/)"));
  });
});

describe("record page — PCB record without a published package (ADR-012 declared zero)", () => {
  function withReference(mounting: "pcb" | "external"): PublicViewModel {
    const base = fixtureModel();
    return {
      ...base,
      records: base.records.map((record) =>
        record.identity.recordId === FIXTURE_IDS.driverRecord
          ? {
              ...record,
              identity: { ...record.identity, lcsc: safeText("", { field: "lcsc", allowEmpty: true }) },
              reference: { ...record.reference, mounting, footprint: null },
            }
          : record,
      ),
    };
  }

  it("states that no footprint or 3D model is published, without calling the part external", () => {
    const page = pageFor(withReference("pcb"), FIXTURE_IDS.driverRecord);
    assert.match(page, /No footprint or 3D model is published for this record: CAD is not enabled for this project\./u);
    assert.match(page, /Datasheet PDF/u);
    assert.doesNotMatch(page, /External panel-mounted component|external solder lugs|External terminal/u);
    assert.doesNotMatch(page, /<ComponentReferences/u);
    assert.match(page, /Footprint pad/u);
  });

  it("keeps the exact external-part wording for an external record", () => {
    const page = pageFor(withReference("external"), FIXTURE_IDS.driverRecord);
    assert.match(page, /External panel-mounted component, hand-wired to the PCB\./u);
    assert.match(page, /Not applicable — external solder lugs/u);
    assert.match(page, /External terminal/u);
    assert.doesNotMatch(page, /CAD is not enabled/u);
  });

  it("omits the catalog's Orderable ID row for a record with no LCSC ID", () => {
    const withoutLcsc = renderCatalog(withReference("pcb")).contents;
    const orderableRows = [...withoutLcsc.matchAll(/\| Orderable ID/gu)].length;
    const allRows = [...catalogPage.matchAll(/\| Orderable ID/gu)].length;
    assert.equal(orderableRows, allRows - 1);
  });
});

describe("record page — evidence semantics", () => {
  it("keeps value, unit, conditions, verdict and provenance as labeled fields", () => {
    assert.match(driverPage, /<EvidenceFact>[\s\S]*?\*\*Value:\*\*[\s\S]*?\*\*Unit:\*\*[\s\S]*?\*\*Conditions:\*\*[\s\S]*?\*\*Verdict:\*\*[\s\S]*?\*\*Provenance:\*\*[\s\S]*?\*\*Evidence:\*\*/u);
    assert.ok(driverPage.includes("PASS - primary-source confirmed"));
    assert.ok(driverPage.includes("CONFIRMED - distributor identity only"));
    assert.ok(driverPage.includes("NEEDS BENCH"));
    assert.ok(driverPage.includes("UNSOURCED"));
    assert.ok(driverPage.includes("NOT APPLICABLE"));
  });

  it("groups facts by class and leads with the two most easily confused", () => {
    const absolute = driverPage.indexOf("### ABSOLUTE");
    const recommended = driverPage.indexOf("### RECOMMENDED");
    const projectState = driverPage.indexOf("### PROJECT");
    assert.ok(absolute > 0 && recommended > absolute);
    assert.ok(projectState > recommended, "PROJECT_STATE sorts after the specified classes");
    assert.ok(driverPage.includes("it is not an operating target"));
  });

  it("publishes a class it has no gloss for rather than dropping the facts", () => {
    assert.ok(driverPage.includes("### ACOUSTIC"));
    assert.ok(driverPage.includes("`fact-fixture-future-class`"));
  });

  it("renders a structured value as its several parts, never coerced or stringified", () => {
    // The evidence contract forbids flattening the distributor-identity objects,
    // so each pair has to survive as a pair.
    assert.ok(driverPage.includes("`lcsc`=C100001"));
    assert.ok(driverPage.includes("`manufacturer`=Fixture Semiconductor"));
    assert.ok(driverPage.includes("`mpn`=FX8860MP-13"));
    assert.ok(driverPage.includes("`variant`=exact orderable driver"));
    assert.ok(!driverPage.includes("[object Object]"));
  });

  it("renders a plain number as a number", () => {
    assert.match(driverPage, /\*\*Value:\*\* 42 · \*\*Unit:\*\* `V`/u);
  });

  it("links a calculated fact to inputs on another record and names that part", () => {
    assert.ok(driverPage.includes("## Calculation dependencies"));
    assert.ok(driverPage.includes("`fact_fixture_sense_max / fact_fixture_sense_resistance`"));
    // Same-record input resolves to a fragment.
    assert.ok(driverPage.includes("[`fact-fixture-sense-max`](#fact-fixture-sense-max)"));
    // Cross-record input crosses to the owning page and says whose it is.
    assert.ok(
      driverPage.includes(
        `[\`${FIXTURE_IDS.foreignDependency}\`](/docs/components/records/` +
          `${FIXTURE_IDS.senseSlug}/#${FIXTURE_IDS.foreignDependency}) on RLP25FEER200`,
      ),
    );
    // An input that is not published is stated, not silently dropped.
    assert.ok(
      driverPage.includes(`\`${FIXTURE_IDS.unpublishedDependency}\` (not published)`),
    );
  });

  it("omits the calculation section when nothing was derived", () => {
    assert.ok(!hostilePage.includes("## Calculation dependencies"));
  });

  it("distinguishes an open domain with blockers from one without", () => {
    assert.ok(driverPage.includes("**Blocked by:** these facts must be resolved"));
    assert.ok(driverPage.includes("**Blocked by:** no blocking fact is recorded."));
    // A covered domain gets neither line — it is not "open with no blockers".
    const covered = driverPage.slice(
      driverPage.indexOf(FIXTURE_IDS.covered),
      driverPage.indexOf(FIXTURE_IDS.openWithBlockers),
    );
    assert.ok(!covered.includes("**Blocked by:**"));
  });

  it("keeps a coverage reason verbatim and never rolls domains up", () => {
    assert.ok(
      driverPage.includes(
        "The mirror's max-design saturation column is absent from the primary document",
      ),
    );
    assert.ok(driverPage.includes("A record with no open domains has not thereby been declared safe."));
    assertNoAggregateVerdict(driverPage);
  });

  it("publishes an unavailable source with its unavailability visible", () => {
    assert.ok(driverPage.includes("**Availability:** SOURCE UNAVAILABLE"));
    assert.ok(driverPage.includes("**Document URL:** no link is published for this source"));
    // And a retrievable one still carries its link.
    assert.ok(
      driverPage.includes(
        "[https://example.invalid/datasheet/FX8860.pdf]" +
          "(https://example.invalid/datasheet/FX8860.pdf)",
      ),
    );
  });

  it("renders several pin maps for one record, each separately addressable", () => {
    assert.ok(driverPage.includes(`### ${FIXTURE_IDS.firstPinMap}`));
    assert.ok(driverPage.includes(`### ${FIXTURE_IDS.secondPinMap}`));
    assert.ok(driverPage.includes("**Symbol:** `FX8860MP-13-HARNESS`"));
    assert.equal(driverPage.split('<EvidenceDetails label="pin-assignments">').length - 1, 2);
    // Disclosure changes presentation, never presence: the rows are in the file.
    assert.ok(driverPage.includes("GND thermal pad, not a current-return substitute"));
  });

  it("publishes evidence pin names, pads and units carrying MDX delimiters as escaped text", () => {
    const t = (value: string) => safeText(value, { field: "test" });
    const record = recordOf(model, FIXTURE_IDS.driverRecord);
    const [pinMap] = record.pinMaps;
    assert.ok(pinMap);
    const [fact] = record.facts;
    assert.ok(fact);
    const hostilePins: PublicRecord = {
      ...record,
      pinMaps: [
        {
          ...pinMap,
          pins: [
            { ...pinMap.pins[0]!, symbolPin: t("<1"), name: t("~{RESET}"), footprintPad: t("{EP") },
            { ...pinMap.pins[0]!, symbolPin: t("2}"), name: t("VDD"), footprintPad: t("2") },
          ],
        },
        ...record.pinMaps.slice(1),
      ],
      facts: [{ ...fact, unit: t("{unit}") }, ...record.facts.slice(1)],
    };
    // Reaching the assertions means `assertMdxSafe` accepted the page.
    const page = renderRecord(hostilePins, buildRecordIndex(model)).contents;
    assert.ok(page.includes("~\\{RESET}"), "an active-low name renders as escaped text");
    assert.ok(page.includes("\\<1"));
    assert.ok(page.includes("\\{EP"));
    assert.ok(page.includes("**Unit:** \\{unit}"));
    // A value without an opening delimiter keeps its monospace form.
    assert.match(page, /\| `2\}` +\| `VDD` +\| `2` +\|/u);
  });

  it("links every record an interaction spans", () => {
    assert.ok(driverPage.includes(`### ${FIXTURE_IDS.interaction}`));
    assert.ok(driverPage.includes(`\`${FIXTURE_IDS.driverRecord}\` (this record)`));
    assert.ok(
      driverPage.includes(
        `[\`${FIXTURE_IDS.senseRecord}\`](/docs/components/records/${FIXTURE_IDS.senseSlug}/)`,
      ),
    );
  });

  it("shows a shared interaction on every participant, not only where it is attached", () => {
    // The sense record's own `interactions` array is EMPTY in the fixture — the
    // driver record carries the interaction they share. Reading `record.interactions`
    // naively would leave this page claiming it takes part in nothing. Nine real
    // record/interaction links depend on this.
    const sense = recordOf(model, FIXTURE_IDS.senseRecord);
    assert.equal(sense.interactions.length, 0, "fixture must exercise one-record attachment");
    assert.ok(sensePage.includes(`### ${FIXTURE_IDS.interaction}`));
    assert.ok(sensePage.includes(`<EvidenceAnchor id="${FIXTURE_IDS.interaction}" />`));
    assert.ok(sensePage.includes(`\`${FIXTURE_IDS.senseRecord}\` (this record)`));
    assert.ok(!sensePage.includes("No interaction is published for this record."));
  });

  it("renders a shared interaction exactly once per page", () => {
    // Anchor uniqueness is now scoped per document, so the same id on two pages
    // is correct — two copies on ONE page would not be.
    for (const page of [driverPage, sensePage]) {
      assert.equal(
        page.split(`<EvidenceAnchor id="${FIXTURE_IDS.interaction}" />`).length - 1,
        1,
      );
    }
  });
});

describe("record page — legend", () => {
  it("explains only the terms the page actually uses", () => {
    const legend = driverPage.slice(driverPage.indexOf("## Legend"));
    assert.ok(legend.includes("### Verdict"));
    assert.ok(legend.includes("### Provenance"));
    assert.ok(legend.includes("### Fact class"));
    assert.ok(legend.includes("### Coverage status"));
    assert.ok(legend.includes("### Source availability"));
    assert.ok(legend.includes("### Source authority"));
    assert.ok(legend.includes("`PASS - primary-source confirmed`"));
    // The driver has no REFERENCE-DESIGN fact, so that term must not appear.
    assert.ok(!legend.includes("`REFERENCE-DESIGN`"));
  });

  it("marks a recorded term it has no wording for instead of hiding it", () => {
    assert.ok(driverPage.includes("`SOMETHING ENTIRELY NEW`"));
    assert.ok(driverPage.includes("No plain-language description is recorded for this term yet."));
  });

  it("never describes a field the publication matrix denies", () => {
    const legend = driverPage.slice(driverPage.indexOf("## Legend"));
    for (const denied of [
      "sha256",
      "evidenceExtract",
      "evidence extract",
      "alternate",
      "reviewedBy",
      "reviewed by",
      "physicalPdfPageIndex",
      "positivePrompts",
      "negativePrompts",
    ]) {
      assert.ok(!legend.toLowerCase().includes(denied.toLowerCase()), `legend mentions ${denied}`);
    }
  });
});

describe("record page — empty and hostile input", () => {
  it("says a section is empty rather than omitting it", () => {
    const empty = emptyArraysModel();
    const page = renderRecord(empty.records[0]!, buildRecordIndex(empty)).contents;
    for (const line of [
      "No board placement is published for this record.",
      "No coverage domain is published for this record.",
      "No fact is published for this record.",
      "No pin map is published for this record.",
      "No interaction is published for this record.",
      "No source is published for this record.",
    ]) {
      assert.ok(page.includes(line), `missing empty-state line: ${line}`);
    }
    assert.ok(page.includes("**Coverage:** no coverage domains published"));
  });

  it("escapes every MDX-active character an evidence string may contain", () => {
    // The fixture puts all of them in one record; reaching this assertion at all
    // means `assertMdxSafe` passed on the built page.
    assert.ok(hostilePage.includes(HOSTILE_TEXT.slice(0, 5)));
    assert.ok(hostilePage.includes("\\{expr}"), "an unescaped brace is a live MDX expression");
    assert.ok(hostilePage.includes("\\<Tag>"), "an unescaped angle bracket opens JSX");
    assert.ok(!/^\s{0,3}:::/mu.test(hostilePage), "a line-leading ::: opens a directive");
    assert.ok(!/^\s{0,3}(?:import|export)\s/mu.test(hostilePage), "line-leading MDX ESM");
  });

  it("fails the build rather than publish evidence containing an HTML comment", () => {
    // The guard rejects `<!--` on any line without asking whether the `<` was
    // escaped, so this string cannot be published even though the serializer
    // already neutralised it. That is stricter than it needs to be, and it is
    // pinned here deliberately: the behaviour is fail-closed, and a future
    // relaxation should have to delete this test on purpose.
    const model = fixtureModel();
    const record = recordOf(model, FIXTURE_IDS.hostileRecord);
    const withComment: PublicRecord = {
      ...record,
      identity: {
        ...record.identity,
        function: safeText(GUARD_REJECTED_TEXT, { field: "test" }),
      },
    };
    assert.throws(
      () => renderRecord(withComment, buildRecordIndex(model)),
      (error: unknown) =>
        error instanceof ComponentDocsError && error.code === "UNSAFE_MDX",
    );
  });

  it("emits only whitelisted components", () => {
    for (const page of [catalogPage, driverPage, sensePage, hostilePage]) {
      for (const name of liveJsxNames(body(page))) {
        assert.ok(
          name in ALLOWED_COMPONENT_ATTRIBUTES,
          `component ${name} is not on the allow-list`,
        );
      }
    }
  });
});

describe("determinism", () => {
  it("renders byte-identical output on repeated runs", () => {
    const first = fixtureModel();
    const second = fixtureModel();
    assert.equal(renderCatalog(first).contents, renderCatalog(second).contents);
    assert.equal(
      renderRecordsIndex(first.records).contents,
      renderRecordsIndex(second.records).contents,
    );
    for (const [position, record] of first.records.entries()) {
      assert.equal(
        renderRecord(record, buildRecordIndex(first)).contents,
        renderRecord(second.records[position]!, buildRecordIndex(second)).contents,
      );
    }
  });

  it("gives each record a distinct route and sidebar position", () => {
    const index = buildRecordIndex(model);
    const pages = model.records.map((record) => renderRecord(record, index));
    assert.equal(new Set(pages.map((page) => page.relativePath)).size, pages.length);
    const positions = pages.map(
      (page) => /^sidebar_position: (\d+)$/mu.exec(page.contents)?.[1],
    );
    assert.deepEqual(positions, ["2", "3", "4"]);
  });
});

describe("records index", () => {
  it("lists every record and points comparison at the catalog", () => {
    const page = renderRecordsIndex(model.records).contents;
    assert.equal(page.split("\n")[0], "---");
    assert.ok(page.includes("(/docs/components/catalog/)"));
    for (const record of model.records) {
      assert.ok(page.includes(`\`${record.identity.recordId}\``));
    }
  });

  it("survives an empty corpus", () => {
    const page = renderRecordsIndex([]).contents;
    assert.ok(page.includes("No component record is published."));
  });
});

describe("catalog anchor contract", () => {
  it("keeps the index anchor other pages link by", () => {
    assert.equal(CATALOG_INDEX_ANCHOR, "catalog-index");
    assert.ok(catalogPage.includes('<EvidenceAnchor id="catalog-index" />'));
    // The record page links back to its own row on that page.
    assert.ok(
      driverPage.includes(`(/docs/components/catalog/#${FIXTURE_IDS.driverRecord})`),
    );
  });
});

/**
 * No page may state a verdict about a part as a whole. Coverage is per-domain,
 * and the absence of an open domain is not a safety claim — so these words must
 * never appear as a judgement of the record.
 */
function assertNoAggregateVerdict(page: string): void {
  for (const forbidden of [
    "overall verdict",
    "overall status",
    "component verdict",
    "record verdict",
    "safety status",
    "all clear",
    "fully verified",
    "no issues",
  ]) {
    assert.ok(!page.toLowerCase().includes(forbidden), `page states an aggregate: ${forbidden}`);
  }
}

/**
 * The serialized body, without the frontmatter block.
 *
 * `assertMdxSafe` is given the body alone, and deliberately: frontmatter values
 * are JSON-encoded scalars in a block MDX never parses as MDX, so an evidence
 * string containing `<` is inert there. Scanning the whole file would flag that
 * inert text and say nothing about the part that is actually parsed.
 */
function body(page: string): string {
  const closing = page.indexOf("\n---\n", 4);
  return closing === -1 ? page : page.slice(closing + 5);
}

/**
 * Component names in tags that are actually live.
 *
 * Evidence text legitimately contains things like `<Tag>`; the serializer
 * escapes them, and an escaped `\<Tag>` is literal text, not a component. This
 * mirrors the guard's rule — escaped means preceded by an ODD number of
 * backslashes, so `\\<Tag>` is an escaped backslash followed by a LIVE `<`.
 */
function liveJsxNames(page: string): string[] {
  const names: string[] = [];
  for (let index = 0; index < page.length; index += 1) {
    if (page[index] !== "<") continue;
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && page[cursor] === "\\"; cursor -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 1) continue;
    const match = /^<\/?([A-Z][A-Za-z0-9]*)/u.exec(page.slice(index));
    if (match?.[1] !== undefined) names.push(match[1]);
  }
  return names;
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
