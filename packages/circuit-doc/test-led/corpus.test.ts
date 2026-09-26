/**
 * The projection against the real LED `.claude/skills/**` corpus (#26).
 *
 * Ported from zudo-led-lamp `doc/component-docs/tests/corpus.test.ts`
 * (`194d8a297e3545588197342130c3111a66c10973`). The figures asserted here are
 * the ones the epic states. They are not cosmetic: a drift in any of them
 * means the evidence moved and the committed selection needs a human
 * decision, which is exactly what should fail a build.
 *
 * The Python validator is NOT run here — `pipeline.test.ts` owns that path.
 * These tests read the evidence and project it, so a failure points at the
 * adapter rather than at the interpreter.
 *
 * Every test copies `fixtures/led/` into a scratch directory and loads it
 * through the real config loader (#9) and config-to-project mapping (#18),
 * then calls the provider API directly — never a subprocess, never the real
 * fixture tree.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { SLUG_PATTERN } from "../src/core/ids.ts";
import { PublicationPolicy } from "../src/core/publication.ts";
import { readEvidenceIndex, projectIndex } from "../src/provider/v1/index.ts";
import type { EvidenceIndex } from "../src/provider/v1/evidence.ts";
import type { PublicRecord, PublicViewModel } from "../src/core/view-model.ts";
import { setUpLedProject, type LedScratch } from "./support/led-project.ts";
import type { LoadedProject } from "../src/cli/project.ts";

let scratch: LedScratch;
let project: LoadedProject;
let index: EvidenceIndex;
let model: PublicViewModel;
let policy: PublicationPolicy;

before(async () => {
  const led = await setUpLedProject();
  scratch = led;
  project = led.project;
  index = await readEvidenceIndex({
    paths: project.paths,
    selection: project.selection,
    reference: project.reference,
  });
  policy = new PublicationPolicy(project.matrix, project.selection);
  model = projectIndex(index, policy, { integrationOwnerSkill: project.integrationOwnerSkill });
});

after(() => {
  scratch?.cleanup();
});

function record(slug: string): PublicRecord {
  const found = model.records.find((entry) => entry.identity.slug === slug);
  assert.ok(found, `no published record with slug ${slug}`);
  return found;
}

describe("the corpus normalizes to the figures the epic states", () => {
  it("counts 14 bundles and 35 records, 25 standalone and 10 subordinate", () => {
    assert.equal(model.corpus.ownerBundles, 14);
    assert.equal(model.corpus.records, 35);
    assert.equal(model.corpus.standaloneRecords, 25);
    assert.equal(model.corpus.subordinateRecords, 10);
    assert.equal(model.corpus.inventoryLines, 35);
    assert.equal(model.corpus.fittedLines, 31);
    assert.equal(model.corpus.dnpOrHandFitLines, 4);
  });

  it("counts 91 sources, 391 facts, 116 coverage domains, 49 interactions", () => {
    assert.equal(model.corpus.sources, 91);
    assert.equal(model.corpus.facts, 391);
    assert.equal(model.corpus.coverageDomains, 116);
    assert.equal(model.corpus.interactions, 49);
  });

  it("counts 35 routes, 35 pin maps and 163 pins", () => {
    assert.equal(index.totals.routes, 35);
    assert.equal(model.corpus.pinMaps, 35);
    assert.equal(model.corpus.pins, 163);
  });

  it("publishes every instance without duplicating or dropping one", () => {
    assert.equal(model.records.length, 35);
    assert.equal(sum(model.records, (entry) => entry.sources.length), 91);
    assert.equal(sum(model.records, (entry) => entry.facts.length), 391);
    assert.equal(sum(model.records, (entry) => entry.coverage.length), 116);
    assert.equal(sum(model.records, (entry) => entry.pinMaps.length), 35);
    assert.equal(
      sum(model.records, (entry) => sum(entry.pinMaps, (map) => map.pins.length)),
      163,
    );

    // Interactions are the one relation that fans out: 49 distinct interactions
    // land on 62 record pages because every participant shows its involvement.
    const interactions = model.records.flatMap((entry) => entry.interactions);
    assert.equal(interactions.length, 62);
    assert.equal(new Set(interactions.map((entry) => entry.interactionId)).size, 49);
  });

  it("gives every record a unique, route-safe slug and page-unique anchors", () => {
    const slugs = model.records.map((entry) => entry.identity.slug);
    assert.equal(new Set(slugs).size, 35);
    for (const slug of slugs) assert.match(slug, SLUG_PATTERN);

    // Anchors become HTML ids, so uniqueness is a per-document invariant.
    let total = 0;
    for (const entry of model.records) {
      const anchors = [
        entry.identity.anchor,
        ...entry.sources.map((value) => value.anchor),
        ...entry.facts.map((value) => value.anchor),
        ...entry.coverage.map((value) => value.anchor),
        ...entry.interactions.map((value) => value.anchor),
        ...entry.pinMaps.map((value) => value.anchor),
      ];
      assert.equal(new Set(anchors).size, anchors.length, entry.identity.slug);
      total += anchors.length;
    }
    assert.equal(total, 35 + 91 + 391 + 116 + 62 + 35);

    // Record-scoped anchors stay globally unique — each belongs to one page.
    const scoped = model.records.flatMap((entry) => [
      entry.identity.anchor,
      ...entry.sources.map((value) => value.anchor),
      ...entry.facts.map((value) => value.anchor),
      ...entry.coverage.map((value) => value.anchor),
      ...entry.pinMaps.map((value) => value.anchor),
    ]);
    assert.equal(new Set(scoped).size, scoped.length);
  });

  it("names the owner bundle on every record", () => {
    const owners = new Set(model.records.map((entry) => entry.identity.ownerSkill));
    assert.equal(owners.size, 14);
    assert.equal(record("al8860mp-13").identity.ownerSkill, "component-al8860mp-13");
    assert.equal(record("ro-ss26").identity.ownerSkill, "component-al8860mp-13");
    assert.equal(record("c13585").identity.ownerSkill, "component-project-passives");
    // It is the bundle the evidence really came from, not a guess from the ID.
    for (const entry of index.records) {
      assert.equal(
        record(entry.record.record_id.replace(/^rec-/u, "")).identity.ownerSkill,
        entry.skill,
      );
    }
  });

  it("orders each standalone record immediately before its own subordinates", () => {
    const slugs = model.records.map((entry) => entry.identity.slug);
    for (const entry of model.records) {
      if (entry.identity.kind !== "subordinate") continue;
      const parentSlug = entry.identity.parentSlug;
      assert.ok(parentSlug, `${entry.identity.slug} has no parent slug`);
      const position = slugs.indexOf(entry.identity.slug);
      const parentPosition = slugs.indexOf(parentSlug);
      assert.ok(parentPosition < position, `${entry.identity.slug} precedes its parent`);
      // Nothing between a parent and its child but that parent's other children.
      for (const between of model.records.slice(parentPosition + 1, position)) {
        assert.equal(between.identity.parentSlug, parentSlug);
      }
    }
  });

  it("starts with the first inventory line, not with an alphabetical sort", () => {
    assert.equal(model.records[0]?.identity.slug, "type-c-31-m-17");
    assert.equal(model.records[0]?.identity.lineId, index.inventory.lines[0]?.line_id);
  });
});

describe("the real records the epic calls out", () => {
  it("publishes a standalone active part with its placement and states", () => {
    const driver = record("al8860mp-13");
    assert.equal(driver.identity.kind, "standalone");
    assert.equal(driver.identity.mpn, "AL8860MP-13");
    assert.equal(driver.identity.lcsc, "C500782");
    assert.equal(driver.identity.dnp, false);
    assert.deepEqual(
      driver.identity.placements.map((placement) => `${placement.board}.${placement.refdes}`),
      ["board-l.U2"],
    );
    assert.notEqual(driver.identity.identityState, "");
    assert.notEqual(driver.identity.sourceState, "");
  });

  it("publishes a subordinate with its owner and parent links intact", () => {
    const catchDiode = record("ro-ss26");
    assert.equal(catchDiode.identity.kind, "subordinate");
    assert.equal(catchDiode.identity.parentRecordId, "rec-al8860mp-13");
    assert.equal(catchDiode.identity.parentSlug, "al8860mp-13");
  });

  it("publishes all four DNP / hand-fit lines as DNP", () => {
    const dnp = model.records.filter((entry) => entry.identity.dnp);
    assert.equal(dnp.length, model.corpus.dnpOrHandFitLines);
    assert.deepEqual(dnp.map((entry) => entry.identity.slug).sort(), [
      "c4749199",
      "c492404",
      "pesd24vs1ub",
      "rd-0603waf5101t5e",
    ]);
    // A DNP line is still a full record: it keeps its evidence, not a stub.
    assert.ok(record("c492404").facts.length > 0);
    assert.ok(record("c492404").coverage.length > 0);
  });

  it("publishes one six-pin map for each half of the mated board-header pair", () => {
    const male = record("c492405");
    const female = record("c2832269");
    assert.equal(male.pinMaps.length, 1);
    assert.equal(female.pinMaps.length, 1);
    assert.equal(male.pinMaps[0]?.recordId, "rec-c492405");
    assert.equal(female.pinMaps[0]?.recordId, "rec-c2832269");
    assert.equal(male.pinMaps[0]?.pins.length, 6);
    assert.equal(female.pinMaps[0]?.pins.length, 6);
    assert.equal(model.records.some((entry) => entry.pinMaps.length !== 1), false);
  });

  it("publishes the large passive bundle as eleven separate records", () => {
    const passives = index.records.filter((entry) => entry.skill === "component-project-passives");
    assert.equal(passives.length, 11);
    for (const entry of passives) {
      assert.ok(record(entry.record.record_id.replace(/^rec-/u, "")));
    }
  });

  it("publishes every unavailable source, with its unavailability visible", () => {
    const sources = model.records.flatMap((entry) => entry.sources);
    const unavailable = sources.filter((source) => source.availability === "SOURCE UNAVAILABLE");
    assert.equal(unavailable.length, 11);
    for (const source of unavailable) {
      assert.notEqual(source.documentTitle, "");
      assert.notEqual(source.locator, "");
    }
    assert.equal(
      sources.every(
        (source) =>
          source.availability === "AVAILABLE" || source.availability === "SOURCE UNAVAILABLE",
      ),
      true,
    );
  });

  it("publishes open coverage, both with and without applicable blockers", () => {
    const coverage = model.records.flatMap((entry) => entry.coverage);
    const open = coverage.filter((entry) => entry.status === "OPEN");
    assert.equal(coverage.filter((entry) => entry.status === "COVERED").length, 48);
    assert.equal(open.length, 68);

    const withBlockers = open.filter((entry) => entry.blockingFactIds.length > 0);
    const withoutBlockers = open.filter((entry) => entry.blockingFactIds.length === 0);
    assert.equal(withBlockers.length, 37);
    assert.equal(withoutBlockers.length, 31);

    // An open domain never publishes without saying why it is open.
    for (const entry of open) assert.notEqual(entry.reason, "");
  });

  it("preserves calculated facts, their expressions and cross-record edges", () => {
    const facts = model.records.flatMap((entry) => entry.facts);
    const factRecord = new Map<string, string>(
      facts.map((fact) => [fact.factId, fact.recordId]),
    );

    const calculated = facts.filter((fact) => fact.expression !== "");
    assert.equal(calculated.length, 27);
    assert.equal(facts.filter((fact) => fact.dependsOn.length > 0).length, 27);

    const crossRecord = facts.flatMap((fact) =>
      fact.dependsOn.filter((id) => factRecord.get(id) !== fact.recordId),
    );
    assert.equal(crossRecord.length, 7);
    for (const fact of facts) {
      for (const id of fact.dependsOn) assert.ok(factRecord.has(id), `${id} does not resolve`);
    }

    const currentMin = facts.find((fact) => fact.factId === "fact-al8860-current-min");
    assert.ok(currentMin);
    assert.deepEqual(currentMin.dependsOn, [
      "fact-al8860-sense-min",
      "fact-rlp25-resistance-max",
    ]);
    assert.notEqual(currentMin.expression, "");
    assert.equal(factRecord.get("fact-rlp25-resistance-max"), "rec-rlp25feer200");
  });

  it("keeps numeric, string and structured fact values in their own shapes", () => {
    const values = model.records.flatMap((entry) => entry.facts).map((fact) => fact.value);
    assert.equal(values.filter((value) => typeof value === "number").length, 196);
    assert.equal(values.filter((value) => typeof value === "string").length, 189);
    assert.equal(values.filter((value) => Array.isArray(value)).length, 6);

    const identity = model.records
      .flatMap((entry) => entry.facts)
      .find((fact) => fact.factId === "fact-type-c-31-m-17-identity");
    assert.ok(identity);
    assert.deepEqual(identity.value, [
      { key: "lcsc", value: "C283540" },
      { key: "manufacturer", value: "HRO" },
      { key: "mpn", value: "TYPE-C-31-M-17" },
      { key: "variant", value: "exact orderable receptacle" },
    ]);
  });

  it("publishes an interaction on every record it names", () => {
    const interactions = model.records.flatMap((entry) => entry.interactions);
    const powerStage = interactions.find(
      (entry) => entry.interactionId === "int-al8860-power-stage",
    );
    assert.ok(powerStage);
    assert.deepEqual(powerStage.recordIds, [
      "rec-al8860mp-13",
      "rec-rlp25feer200",
      "rec-fxl0630-330-m",
      "rec-ro-ss26",
    ]);
    // All four participants carry it, the subordinates included.
    for (const slug of ["al8860mp-13", "rlp25feer200", "fxl0630-330-m", "ro-ss26"]) {
      assert.ok(
        record(slug).interactions.some(
          (entry) => entry.interactionId === "int-al8860-power-stage",
        ),
        `${slug} does not carry int-al8860-power-stage`,
      );
    }
    assert.deepEqual(
      record("al8860mp-13").interactions.map((entry) => entry.interactionId),
      ["int-al8860-control", "int-al8860-power-stage"],
    );

    // A record carries exactly the interactions its manifest lists — the
    // projection never invents an attachment and never drops one.
    for (const entry of index.records) {
      assert.deepEqual(
        record(entry.record.record_id.replace(/^rec-/u, "")).interactions.map(
          (value) => value.interactionId,
        ),
        entry.record.interaction_ids,
      );
    }

    // Every participant of every published interaction is itself published.
    const published = new Set<string>(model.records.map((entry) => entry.identity.recordId));
    for (const entry of interactions) {
      for (const id of entry.recordIds) assert.ok(published.has(id), `${id} is not published`);
    }
  });

  it("gives every record search aliases", () => {
    for (const entry of model.records) {
      assert.ok(entry.aliases.mpn.length > 0, `${entry.identity.slug} has no MPN alias`);
      assert.ok(entry.aliases.lcsc.length > 0, `${entry.identity.slug} has no LCSC alias`);
      assert.ok(entry.aliases.function.length > 0, `${entry.identity.slug} has no function alias`);
    }
    assert.ok(
      (record("al8860mp-13").aliases.function as readonly string[]).includes("buck LED driver"),
    );
  });
});

describe("denied evidence never reaches the public model", () => {
  /**
   * Keys the matrix denies, plus the retrieval bookkeeping a few sources carry
   * that the view model has no field for at all. Values found under these keys
   * must not appear in the projection unless they are ALSO published somewhere
   * legitimately — five alternate URLs are another source's citation URL, and a
   * handful of routing prompts are bare LCSC codes, so those are excluded by
   * construction rather than by an allowlist.
   */
  const DENIED_KEYS = [
    "sha256",
    "identity_extract_sha256",
    "evidence_extract",
    "alternate_authoritative_url",
    "physical_pdf_page_index",
    "positive",
    "negative",
    "reviewed_by",
    "request_headers",
    "refresh_policy",
    "refresh_note",
  ];

  function collectStrings(value: unknown, denied: boolean, into: [Set<string>, Set<string>]): void {
    if (typeof value === "string") {
      into[denied ? 0 : 1].add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectStrings(item, denied, into);
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const [key, nested] of Object.entries(value)) {
        collectStrings(nested, denied || DENIED_KEYS.includes(key), into);
      }
    }
  }

  it("omits every string that only a denied field holds", () => {
    const buckets: [Set<string>, Set<string>] = [new Set(), new Set()];
    for (const entry of index.records) {
      collectStrings(
        { s: entry.sources, r: entry.route, p: entry.pinMaps, f: entry.facts, c: entry.coverage },
        false,
        buckets,
      );
    }

    const [denied, published] = buckets;
    // Joined with a separator no published string may contain, so a match
    // cannot straddle two of them. A denied string that already occurs inside
    // published evidence — an alternate URL that is another source's citation,
    // a routing prompt built out of the MPN — is not a leak, it is the same
    // words arriving through a field the matrix publishes.
    const publishedBlob = [...published].join("\u0000");
    const exclusivelyDenied = [...denied].filter(
      (value) => value.trim() !== "" && !publishedBlob.includes(value),
    );
    // Guard against the scan silently becoming vacuous.
    assert.ok(exclusivelyDenied.length >= 200, `only ${exclusivelyDenied.length} denied strings`);

    const serialized = JSON.stringify(model);
    for (const value of exclusivelyDenied) {
      assert.equal(serialized.includes(value), false, `view model leaked: ${value.slice(0, 60)}`);
    }
  });

  it("carries no denied key name, in the model or in the preflight report", () => {
    const report = policy.buildReport({
      viewModelVersion: model.version,
      providerId: "circuit-component-spec",
      providerContractVersion: 1,
      availableRecords: model.corpus.records,
      availableSources: model.corpus.sources,
      selectedSlugs: model.records.map((entry) => entry.identity.slug),
      counts: {},
    });

    const modelJson = JSON.stringify(model);
    for (const key of ["sha256", "evidenceExtract", "reviewedBy", "physicalPdfPageIndex"]) {
      assert.equal(modelJson.includes(key), false, `view model carries a ${key} key`);
    }
    // The report names denied FIELD KEYS by design — that is the audit trail —
    // but must never carry one of their values.
    const reportJson = JSON.stringify(report.urls) + JSON.stringify(report.records);
    for (const key of ["sha256", "evidence_extract", "reviewed_by"]) {
      assert.equal(reportJson.includes(key), false, `preflight carries a ${key} value`);
    }
  });

  it("publishes only http(s) citation URLs, and records all 91 decisions", () => {
    const report = policy.buildReport({
      viewModelVersion: model.version,
      providerId: "circuit-component-spec",
      providerContractVersion: 1,
      availableRecords: model.corpus.records,
      availableSources: model.corpus.sources,
      selectedSlugs: [],
      counts: {},
    });
    assert.equal(report.urls.length, 91);
    assert.equal(report.urls.filter((entry) => entry.decision === "ALLOW").length, 91);

    for (const source of model.records.flatMap((entry) => entry.sources)) {
      assert.ok(source.url, `${source.sourceId} has no URL`);
      assert.match(source.url, /^https?:\/\//u);
    }
  });
});

describe("repeated normalization of unchanged input is byte-stable", () => {
  it("projects identical JSON on a second pass", async () => {
    const second = projectIndex(
      await readEvidenceIndex({
        paths: project.paths,
        selection: project.selection,
        reference: project.reference,
      }),
      new PublicationPolicy(project.matrix, project.selection),
      { integrationOwnerSkill: project.integrationOwnerSkill },
    );
    assert.equal(JSON.stringify(second), JSON.stringify(model));
  });
});

function sum<T>(values: readonly T[], size: (value: T) => number): number {
  return values.reduce((total, value) => total + size(value), 0);
}
