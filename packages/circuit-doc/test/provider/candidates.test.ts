import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ComponentDocsError } from "../../src/core/errors.ts";
import { PublicationPolicy, type InstanceSelection } from "../../src/core/publication.ts";
import { footprintSelectionsFromIndex } from "../../src/footprint-previews/selection.ts";
import {
  indexEvidence, readCandidateInventory, type CandidateInventory, type ProviderBundle,
} from "../../src/provider/v1/evidence.ts";
import { projectIndex, readEvidenceIndex } from "../../src/provider/v1/index.ts";
import { buildModelAssetPlan } from "../../src/provider/v1/model-assets.ts";
import {
  fixtureBundle, fixtureCandidate, fixtureIntegrationRules, fixtureInventory,
  FIXTURE_MATRIX, FIXTURE_MODEL_PREFIX, FIXTURE_SELECTION, onDiskFixtureBundle,
  withFixtureReferences, writeFixtureProject,
} from "../fixtures/provider-fixtures.ts";

function corpus(fitted = fixtureBundle()) {
  const shared = fixtureCandidate("shared");
  const separate = fixtureCandidate("separate", "component-candidate-only");
  const bundles: ProviderBundle[] = [{
    skill: fitted.skill,
    records: [...fitted.records, ...shared.bundle.records],
    sources: [...fitted.sources, ...shared.bundle.sources],
    facts: [...fitted.facts, ...shared.bundle.facts],
    coverage: [...fitted.coverage, ...shared.bundle.coverage],
    routes: [...fitted.routes, ...shared.bundle.routes],
    interactions: [...fitted.interactions, ...shared.bundle.interactions],
    pinMaps: [...fitted.pinMaps, ...shared.bundle.pinMaps],
  }, separate.bundle];
  const candidates: CandidateInventory = { schema_version: 1, candidates: [shared.candidate, separate.candidate] };
  return {
    inventory: fixtureInventory(), candidates, bundles, rules: fixtureIntegrationRules(),
    shared: shared.bundle, separate: separate.bundle,
  };
}
type Corpus = ReturnType<typeof corpus>;
const index = (data: Corpus) => indexEvidence(data.inventory, data.bundles, data.rules, data.candidates);
function contractError(pattern: RegExp) {
  return (error: unknown) => {
    assert.ok(error instanceof ComponentDocsError);
    assert.equal(error.code, "ADAPTER_CONTRACT");
    assert.match(error.message, pattern);
    return true;
  };
}
function candidateSelectionError(error: unknown) {
  assert.ok(error instanceof ComponentDocsError);
  assert.equal(error.code, "STALE_SELECTION");
  assert.match(error.message, /selection names an audited candidate/u);
  return true;
}

describe("audited candidate publication partition", () => {
  it("publishes exactly the fitted corpus with shared and candidate-only owners", () => {
    const data = corpus();
    const result = index(data);
    const fitted = indexEvidence(fixtureInventory(), [fixtureBundle()], fixtureIntegrationRules());
    assert.deepEqual(result.records, fitted.records);
    assert.deepEqual(result.recordById, fitted.recordById);
    assert.deepEqual(result.factById, fitted.factById);
    assert.deepEqual(result.interactionById, fitted.interactionById);
    assert.deepEqual(result.ownerSkills, fitted.ownerSkills);
    assert.deepEqual(result.sourceIds, fitted.sourceIds);
    assert.deepEqual(result.totals, fitted.totals);
    assert.equal(result.candidates.length, 2);
    assert.ok(result.candidates.every((entry) => !("line" in entry)));
    const project = (value: typeof result) => projectIndex(
      withFixtureReferences(value), new PublicationPolicy(FIXTURE_MATRIX, FIXTURE_SELECTION),
    );
    assert.deepEqual(project(result), project(fitted));
    const serialized = JSON.stringify(project(result));
    for (const entry of result.candidates) {
      for (const token of [entry.candidate.candidate_id, entry.candidate.mpn, entry.record.record_id,
        ...entry.record.source_ids, ...entry.record.fact_ids, ...entry.record.interaction_ids]) {
        assert.ok(!serialized.includes(token), `candidate value leaked: ${token}`);
      }
    }
  });

  for (const target of ["record", "source", "linkable source"] as const) {
    it(`rejects a selected candidate ${target} before count freshness`, () => {
      const data = corpus();
      const candidate = data.shared.records[0]!;
      const selection: InstanceSelection = {
        ...FIXTURE_SELECTION,
        ...(target === "record" ? { recordIds: [...FIXTURE_SELECTION.recordIds, candidate.record_id],
              documentExceptions: [{ recordId: candidate.record_id, reason: "candidate selection must fail" }] }
          : target === "source" ? { sourceIds: [...FIXTURE_SELECTION.sourceIds, candidate.source_ids[0]!] }
          : { sourceIds: [...FIXTURE_SELECTION.sourceIds, candidate.source_ids[0]!],
              linkableSourceIds: [...FIXTURE_SELECTION.linkableSourceIds, candidate.source_ids[0]!] }),
      };
      assert.throws(() => projectIndex(withFixtureReferences(index(data)), new PublicationPolicy(FIXTURE_MATRIX, selection)), candidateSelectionError);
    });
  }
});

describe("candidate contract failures", () => {
  const cases: [string, (data: Corpus) => void, RegExp][] = [
    ["unsupported schema", (d) => { d.candidates.schema_version = 2; }, /schema_version/u],
    ["duplicate candidate ID", (d) => { d.candidates.candidates.push(d.candidates.candidates[0]!); }, /duplicate candidate id/u],
    ["unusable candidate ID", (d) => { d.candidates.candidates[0]!.candidate_id = ""; }, /no usable id/u],
    ["null without candidate", (d) => { delete d.shared.records[0]!.candidate_id; }, /candidate identity/u],
    ["null candidate ID", (d) => { d.shared.records[0]!.candidate_id = null; }, /candidate identity/u],
    ["unknown candidate ID", (d) => { d.shared.records[0]!.candidate_id = "unknown"; }, /candidate identity/u],
    ["both IDs", (d) => { d.shared.records[0]!.line_id = "line-driver"; }, /both line_id and candidate_id/u],
    ["candidate without explicit null line", (d) => { delete (d.shared.records[0] as unknown as Record<string, unknown>).line_id; }, /explicitly set line_id to null/u],
    ["wrong owner", (d) => { d.candidates.candidates[1]!.owner_skill = "wrong"; }, /inventory does not assign/u],
    ["missing candidate record", (d) => { d.candidates.candidates.push({ ...d.candidates.candidates[0]!, candidate_id: "candidate-missing" }); }, /has no record/u],
    ["duplicate record across partitions", (d) => { d.shared.records[0]!.record_id = "rec-driver"; }, /duplicate record id/u],
    ["duplicate source across partitions", (d) => { d.shared.sources[0]!.source_id = "src-driver-primary"; }, /duplicate source id/u],
    ["duplicate fact across partitions", (d) => { d.separate.facts[0]!.fact_id = "fact-driver-identity"; }, /duplicate fact id/u],
    ["duplicate interaction across partitions", (d) => { d.separate.interactions[0]!.interaction_id = "int-power-stage"; }, /duplicate interaction id/u],
    ["unlisted candidate source", (d) => { d.separate.records[0]!.source_ids = []; }, /source is not listed/u],
    ["unlisted candidate fact", (d) => { d.separate.records[0]!.fact_ids = []; }, /fact is not listed/u],
    ["fitted manifest cites candidate source", (d) => { d.bundles[0]!.records[0]!.source_ids.push(d.shared.sources[0]!.source_id); }, /source owned by another record/u],
    ["candidate manifest cites fitted fact", (d) => { d.shared.records[0]!.fact_ids.push("fact-driver-identity"); }, /fact owned by another record/u],
    ["candidate source in wrong bundle", (d) => { (d.bundles[0]!.sources as unknown[]).push(d.separate.sources[0]); (d.separate.sources as unknown[]).pop(); }, /bundle that does not own/u],
    ["candidate missing route", (d) => { (d.separate.routes as unknown[]).pop(); }, /exactly one routing/u],
    ["candidate dependency cycle", (d) => { d.separate.facts[0]!.depends_on = [d.separate.facts[0]!.fact_id]; }, /form a cycle/u],
    ["crossing interaction records", (d) => {
      d.bundles[0]!.interactions[0]!.record_ids.push(d.shared.records[0]!.record_id);
      d.shared.records[0]!.interaction_ids.push("int-power-stage");
    }, /interaction crosses/u],
    ["crossing interaction fact owner", (d) => { d.bundles[0]!.interactions[0]!.fact_ids.push(d.shared.facts[0]!.fact_id); }, /outside its named records/u],
    ["candidate interaction names fitted fact", (d) => { d.separate.interactions[0]!.fact_ids.push("fact-driver-identity"); }, /outside its named records/u],
    ["same-partition foreign interaction fact", (d) => { d.bundles[0]!.interactions[0]!.fact_ids.push("fact-handfit-pitch"); }, /outside its named records/u],
    ["fitted depends on candidate", (d) => { d.bundles[0]!.facts[0]!.depends_on = [d.shared.facts[0]!.fact_id]; }, /dependency crosses/u],
    ["candidate depends on fitted", (d) => { d.separate.facts[0]!.depends_on = ["fact-driver-identity"]; }, /dependency crosses/u],
    ["fitted child of candidate", (d) => { d.bundles[0]!.records[1]!.parent_record_id = d.shared.records[0]!.record_id; }, /parent crosses/u],
    ["candidate child of fitted", (d) => { Object.assign(d.shared.records[0]!, { kind: "subordinate", parent_record_id: "rec-driver" }); }, /parent crosses/u],
    ["fitted coverage cites candidate", (d) => { d.bundles[0]!.coverage[0]!.fact_ids.push(d.shared.facts[0]!.fact_id); }, /coverage fact crosses/u],
    ["candidate coverage cites fitted", (d) => { d.separate.coverage[0]!.blocking_fact_ids.push("fact-driver-identity"); }, /coverage fact crosses/u],
    ["rule names candidate record", (d) => { d.rules[0]!.record_ids.push(d.shared.records[0]!.record_id); }, /integration rule names an audited candidate/u],
    ["rule names candidate fact", (d) => { d.rules[0]!.fact_ids.push(d.shared.facts[0]!.fact_id); }, /integration rule names an audited candidate/u],
    ["calculation names candidate fact", (d) => { d.rules[0]!.conditioned_calculations![0]!.fact_ids.push(d.shared.facts[0]!.fact_id); }, /integration rule names an audited candidate/u],
    ["evidence chain names candidate fact", (d) => { d.rules[1]!.evidence_chain![0]!.fact_ids.push(d.shared.facts[0]!.fact_id); }, /integration rule names an audited candidate/u],
  ];
  for (const field of ["mpn", "manufacturer", "lcsc", "package"] as const) {
    cases.push([`${field} mismatch`, (d) => { d.separate.records[0]![field] = "different"; }, /identity disagrees/u]);
  }
  for (const [name, mutate, pattern] of cases) {
    it(`rejects ${name}`, () => {
      const data = corpus();
      mutate(data);
      assert.throws(() => index(data), contractError(pattern));
    });
  }

  it("rejects a candidate record when no candidate inventory is configured", () => {
    const data = corpus();
    assert.throws(() => indexEvidence(data.inventory, data.bundles, data.rules), contractError(/candidate identity/u));
  });

  it("preserves fitted records carrying a null candidate_id", () => {
    const data = corpus();
    data.bundles[0]!.records[0]!.candidate_id = null;
    assert.equal(index(data).records.length, 3);
  });

  it("requires exactly one record per candidate inventory entry", () => {
    const data = corpus();
    const duplicate = fixtureCandidate("duplicate");
    duplicate.bundle.records[0]!.candidate_id = data.shared.records[0]!.candidate_id;
    data.bundles.push(duplicate.bundle);
    assert.throws(() => index(data), contractError(/more than one record/u));
  });

  it("accepts dependencies and parents confined to the candidate partition", () => {
    const data = corpus();
    Object.assign(data.separate.records[0]!, { kind: "subordinate", parent_record_id: data.shared.records[0]!.record_id });
    data.separate.facts[0]!.depends_on = [data.shared.facts[0]!.fact_id];
    assert.equal(index(data).candidates.length, 2);
  });
});

describe("candidate inventory reads and reference consumers", () => {
  async function scratch(run: (root: string) => Promise<void>) {
    const root = await mkdtemp(join(tmpdir(), "candidate-provider-"));
    try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
  }

  it("reads every candidate owner but excludes its sources, footprints and model assets", async () => scratch(async (root) => {
    const data = corpus(onDiskFixtureBundle());
    const paths = await writeFixtureProject(root, { ...data, rules: { schema_version: 1, rules: data.rules } });
    // Candidate CAD assets are deliberately missing: no publication consumer may read them.
    for (const bundle of [data.shared, data.separate]) {
      const footprint = bundle.pinMaps[0]!.footprint;
      await rm(join(paths.footprintLibraryRoot, `${footprint}.kicad_mod`));
      await rm(join(paths.modelRoot, `${footprint}.wrl`));
    }
    const result = await readEvidenceIndex({ paths, selection: FIXTURE_SELECTION, reference: { modelLocatorPrefix: FIXTURE_MODEL_PREFIX } });
    assert.equal(result.candidates.length, 2);
    assert.equal(result.references!.documentsByRecordId.size, 3);
    assert.equal(result.references!.packages.length, 3);
    assert.deepEqual([...result.references!.packageByRecordId.keys()], FIXTURE_SELECTION.recordIds);
    const previews = footprintSelectionsFromIndex(result, FIXTURE_SELECTION);
    assert.equal(previews.length, 3);
    assert.deepEqual(previews.flatMap((entry) => entry.recordIds), FIXTURE_SELECTION.recordIds);
    assert.equal(projectIndex(result, new PublicationPolicy(FIXTURE_MATRIX, FIXTURE_SELECTION)).corpus.records, 3);
    const modelPlan = await buildModelAssetPlan({
      paths, selection: FIXTURE_SELECTION, reference: { modelLocatorPrefix: FIXTURE_MODEL_PREFIX },
      policy: new PublicationPolicy(FIXTURE_MATRIX, FIXTURE_SELECTION),
      validation: { ok: true, command: ["fixture"], exitCode: 0, stdout: "", stderr: "" },
    });
    assert.deepEqual(modelPlan.map((entry) => entry.name), ["HDR-1x5.wrl", "MSOP-8.wrl", "R-2512.wrl"]);
    // Prove the candidate-only owner was validated, rather than merely skipped.
    await writeFile(join(paths.bundlesRoot, data.separate.skill, "facts.json"), JSON.stringify({ schema_version: 99, facts: [] }));
    await assert.rejects(readEvidenceIndex({ paths, selection: FIXTURE_SELECTION }), contractError(/schema_version/u));
  }));

  it("rejects candidate selection before reference construction", async () => scratch(async (root) => {
    const data = corpus(onDiskFixtureBundle());
    const paths = await writeFixtureProject(root, { ...data, rules: { schema_version: 1, rules: data.rules } });
    await assert.rejects(readEvidenceIndex({ paths, selection: {
      ...FIXTURE_SELECTION, recordIds: [...FIXTURE_SELECTION.recordIds, data.separate.records[0]!.record_id],
    } }), candidateSelectionError);
  }));

  it("requires a candidates array and contains reads including symlinks", async () => scratch(async (root) => {
    const paths = await writeFixtureProject(root, corpus());
    const path = paths.candidateInventoryFile!;
    await writeFile(path, JSON.stringify({ schema_version: 1 }));
    await assert.rejects(readCandidateInventory(paths.bundlesRoot, path), contractError(/no entry array/u));
    const outside = join(root, "outside.json");
    await writeFile(outside, JSON.stringify({ schema_version: 1, candidates: [] }));
    const containment = (error: unknown) => {
      assert.ok(error instanceof ComponentDocsError);
      assert.equal(error.code, "PATH_CONTAINMENT");
      return true;
    };
    await assert.rejects(readCandidateInventory(paths.bundlesRoot, outside), containment);
    await rm(path);
    await symlink(outside, path);
    await assert.rejects(readCandidateInventory(paths.bundlesRoot, path), containment);
  }));
});
