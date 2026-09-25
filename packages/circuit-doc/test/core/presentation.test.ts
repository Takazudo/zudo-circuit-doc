/**
 * Presentation invariants: the parts of how a generated page reads that are
 * decided in the generator rather than in CSS.
 *
 * Everything asserted here is checkable from the serialized MDX and the two
 * files that have to agree with it — the component allow-list and the host
 * binding registry. Nothing here needs a browser, so all of it runs in CI on
 * every change rather than being re-checked by eye.
 *
 * The rules under test are the ones that fail silently if broken: an MDX
 * component the host does not register renders as literal text and swallows
 * the table it wraps, and a table that loses its scroll container does not
 * error — it just crushes its columns on a phone.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ALLOWED_COMPONENT_ATTRIBUTES, ATTRIBUTE_VALUE_PATTERN } from "../../src/core/mdx.ts";
import { renderCatalog } from "../../src/core/render/catalog.ts";
import { renderIntegration } from "../../src/core/render/integration.ts";
import { renderRecord } from "../../src/core/render/record.ts";
import { buildRecordIndex } from "../../src/core/render/shared.ts";
import { FIXTURE_IDS, fixtureModel } from "../fixtures/view-model-fixtures.ts";

/** Names bound by the host rather than by this project. */
const PACKAGE_GLOBAL_COMPONENTS: readonly string[] = ["CategoryNav"];

const model = fixtureModel();
const index = buildRecordIndex(model);
const catalogPage = renderCatalog(model).contents;
const recordPages = model.records.map((record) => renderRecord(record, index).contents);
/**
 * The integration page was NOT in this list until a browser pass found its
 * tables scrolling by pointer only — no tab stop, no focus ring — while every
 * record page had both. The suite said "on every page" and walked
 * `model.records`, so the one page rendered by a different renderer was
 * structurally invisible to it. Any future renderer must be added here too.
 */
const integrationPage = renderIntegration(model, index).contents;
/** The fixture record carrying facts, calculations and two pin maps. */
const driverPage = pageFor(FIXTURE_IDS.driverRecord);

function pageFor(recordId: string): string {
  const record = model.records.find((entry) => entry.identity.recordId === recordId);
  assert.ok(record, `fixture has no record ${recordId}`);
  return renderRecord(record, index).contents;
}

/** Every `| … | … |` header row, with its cell count. */
function tableHeaderWidths(page: string): number[] {
  const widths: number[] = [];
  const lines = page.split("\n");
  for (const [position, line] of lines.entries()) {
    const next = lines[position + 1];
    // A GFM header is a row followed by the `| --- |` delimiter row.
    if (next === undefined || !/^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/u.test(next)) continue;
    widths.push(line.split("|").length - 2);
  }
  return widths;
}

/** The text between an opening `<EvidenceDetails …>` and its close. */
function disclosedBlocks(page: string): string[] {
  return [...page.matchAll(/<EvidenceDetails[^>]*>([\s\S]*?)<\/EvidenceDetails>/gu)].map(
    (match) => match[1] ?? "",
  );
}


// moved to T11 (#13): "host bindings stay in step with the component allow-list"
// and "the stylesheet declares what the components emit" -- re-added there against
// the package's own chrome-bindings shim and stylesheet.

describe("dense tables carry a scroll container", () => {
  it("wraps every table wider than two columns, on every page", () => {
    for (const page of [catalogPage, integrationPage, ...recordPages]) {
      const wide = tableHeaderWidths(page).filter((width) => width > 2);
      const wrappers = [...page.matchAll(/<EvidenceTable\b/gu)].length;
      assert.equal(
        wrappers,
        wide.length,
        `page has ${wide.length} tables wider than two columns but ${wrappers} scroll containers`,
      );
    }
  });

  it("keeps each fact's claims together in one visible primitive", () => {
    const facts = [...driverPage.matchAll(/<EvidenceFact>([\s\S]*?)<\/EvidenceFact>/gu)];
    assert.ok(facts.length > 0);
    for (const [, body] of facts) {
      for (const label of ["Fact", "Value", "Unit", "Conditions", "Verdict", "Provenance", "Evidence"]) {
        assert.ok(body?.includes(`**${label}:**`), `fact omits ${label}`);
      }
    }
  });

  it("labels each container with a slug the guard would accept", () => {
    const labels = [...catalogPage.matchAll(/<EvidenceTable label="([^"]*)"/gu)].map(
      (match) => match[1] ?? "",
    );
    assert.ok(labels.length > 0);
    for (const label of labels) {
      assert.match(label, ATTRIBUTE_VALUE_PATTERN, `${label} would fail the MDX guard`);
    }
  });

  it("never lets a label carry evidence text", () => {
    // Attribute values are the one place evidence may never reach. Every label
    // the renderers emit is authored in this repository.
    const authored = new Set(["parts-index", "pin-assignments"]);
    for (const page of [catalogPage, ...recordPages]) {
      for (const match of page.matchAll(/<Evidence(?:Table|Details) label="([^"]*)"/gu)) {
        assert.ok(authored.has(match[1] ?? ""), `unexpected label ${match[1]}`);
      }
    }
  });
});

describe("nothing carrying a claim sits behind a disclosure", () => {
  it("discloses pin assignments and nothing else", () => {
    for (const page of recordPages) {
      for (const block of disclosedBlocks(page)) {
        assert.match(block, /<EvidenceTable label="pin-assignments">/u);
        for (const forbidden of ["Verdict", "Provenance", "Coverage ID", "Source ID", "Reason:"]) {
          assert.ok(
            !block.includes(forbidden),
            `a disclosure on a record page conceals ${forbidden}`,
          );
        }
      }
    }
  });

  it("leaves the disclosed rows in the page body", () => {
    // `<details>` changes how the rows are presented, never whether they are in
    // the file — so they stay in the built HTML and in the search index whether
    // the element is open or closed.
    assert.match(
      driverPage,
      /\| Symbol pin\s*\| Name\s*\| Footprint pad\s*\| Function\s*\|/u,
    );
  });
});

describe("link text names its subject", () => {
  it("never repeats a bare 'record details' across the catalog", () => {
    assert.ok(
      !catalogPage.includes("[Record details]"),
      "catalog links read the same for every one of its records",
    );
    for (const record of model.records) {
      assert.ok(
        catalogPage.includes(`[${record.identity.mpn} record details]`),
        `${record.identity.recordId} has no self-describing catalog link`,
      );
    }
  });
});

