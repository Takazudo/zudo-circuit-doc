import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PublicationPolicy, type PublicationMatrix } from "../../src/core/publication.ts";
import { renderCatalog } from "../../src/core/render/catalog.ts";
import { renderIntegration } from "../../src/core/render/integration.ts";
import { renderLanding } from "../../src/core/render/landing.ts";
import { renderRecord } from "../../src/core/render/record.ts";
import {
  DEFAULT_RENDER_OPTIONS,
  buildRecordIndex,
  type RenderOptions,
} from "../../src/core/render/shared.ts";
import { projectIndex } from "../../src/provider/v1/index.ts";
import { indexEvidence as rawIndexEvidence } from "../../src/provider/v1/evidence.ts";
import {
  FIXTURE_MATRIX,
  FIXTURE_SELECTION,
  fixtureBundle,
  fixtureIntegrationRules,
  fixtureInventory,
  withFixtureReferences,
} from "../fixtures/provider-fixtures.ts";

const INTEGRATION_OWNER = "circuit-fixture-integration";
const RECORD_OWNER = "component-fixture";

const DENY_OWNER_MATRIX: PublicationMatrix = {
  ...FIXTURE_MATRIX,
  "record.ownerSkill": "DENY",
  "integration.ownerSkill": "DENY",
  "reference.package.recordIds": "DENY",
};

const AGENT_RESOURCES_OFF: RenderOptions = {
  ...DEFAULT_RENDER_OPTIONS,
  agentResources: false,
};

function projectFixture(matrix: PublicationMatrix) {
  const index = withFixtureReferences(
    rawIndexEvidence(fixtureInventory(), [fixtureBundle()], fixtureIntegrationRules()),
  );
  const policy = new PublicationPolicy(matrix, FIXTURE_SELECTION);
  const model = projectIndex(index, policy, { integrationOwnerSkill: INTEGRATION_OWNER });
  return { index, model, policy };
}

function reportFor(
  index: ReturnType<typeof rawIndexEvidence>,
  model: ReturnType<typeof projectIndex>,
  policy: PublicationPolicy,
) {
  return policy.buildReport({
    viewModelVersion: model.version,
    providerId: model.provider.id,
    providerContractVersion: model.provider.contractVersion,
    availableRecords: index.records.length,
    availableSources: index.sourceIds.length,
    selectedSlugs: model.records.map((record) => record.identity.slug),
    counts: {},
  });
}

describe("owner skill and package membership DENY projection", () => {
  it("projects denied owners and package membership as null and records the denials", () => {
    const { index, model, policy } = projectFixture(DENY_OWNER_MATRIX);

    assert.equal(model.version, 2);
    assert.ok(model.records.every((record) => record.identity.ownerSkill === null));
    assert.ok(model.integration.every((rule) => rule.ownerSkill === null));
    assert.ok(model.packagePreviews.every((preview) => preview.recordIds === null));

    const report = reportFor(index, model, policy);
    for (const key of [
      "record.ownerSkill",
      "integration.ownerSkill",
      "reference.package.recordIds",
    ]) {
      const usage = report.fields.find((field) => field.key === key);
      assert.ok(usage, `missing preflight usage for ${key}`);
      assert.equal(usage.decision, "DENY");
      assert.equal(usage.emitted, 0);
      assert.ok(usage.withheld > 0, `${key} was not recorded as withheld`);
    }
  });

  it("renders no denied owner names or owner labels on the four component pages", () => {
    const { model, policy } = projectFixture(DENY_OWNER_MATRIX);
    const recordIndex = buildRecordIndex(model);
    const record = model.records[0];
    assert.ok(record, "fixture has no projected records");

    const pages = [
      renderRecord(record, recordIndex, AGENT_RESOURCES_OFF).contents,
      renderCatalog(model, AGENT_RESOURCES_OFF).contents,
      renderIntegration(model, recordIndex, AGENT_RESOURCES_OFF).contents,
      renderLanding(model, policy, AGENT_RESOURCES_OFF).contents,
    ];
    for (const [position, page] of pages.entries()) {
      assert.equal(page.includes(RECORD_OWNER), false, `page ${position} leaked the record owner`);
      assert.equal(page.includes(INTEGRATION_OWNER), false, `page ${position} leaked the integration owner`);
      assert.equal(page.includes("Owner skill"), false, `page ${position} rendered the owner label`);
      assert.equal(page.includes("/docs/claude-skills/"), false, `page ${position} rendered an owner route`);
    }
  });

  it("shows the missing integration owner with either agent-resource setting", () => {
    const { model } = projectFixture(DENY_OWNER_MATRIX);
    const recordIndex = buildRecordIndex(model);

    for (const options of [
      AGENT_RESOURCES_OFF,
      { ...DEFAULT_RENDER_OPTIONS, agentResources: true },
    ]) {
      const page = renderIntegration(model, recordIndex, options).contents;
      assert.ok(page.includes("No owning bundle is identified in the published model"));
      assert.equal(page.includes(INTEGRATION_OWNER), false);
      assert.equal(page.includes("/docs/claude-skills/"), false);
    }
  });

  it("keeps preset-equivalent owner names and links published", () => {
    const { model, policy } = projectFixture(FIXTURE_MATRIX);
    const recordIndex = buildRecordIndex(model);
    const record = model.records[0];
    assert.ok(record, "fixture has no projected records");

    const recordPage = renderRecord(record, recordIndex).contents;
    const catalogPage = renderCatalog(model).contents;
    const integrationPage = renderIntegration(model, recordIndex).contents;
    const landingPage = renderLanding(model, policy).contents;

    assert.ok(recordPage.includes("Owner skill"));
    assert.ok(recordPage.includes(RECORD_OWNER));
    assert.ok(recordPage.includes(`/docs/claude-skills/${RECORD_OWNER}/`));
    assert.ok(catalogPage.includes("Owner skill"));
    assert.ok(catalogPage.includes(RECORD_OWNER));
    assert.ok(catalogPage.includes(`/docs/claude-skills/${RECORD_OWNER}/`));
    assert.ok(integrationPage.includes(INTEGRATION_OWNER));
    assert.ok(integrationPage.includes(`/docs/claude-skills/${INTEGRATION_OWNER}/`));
    assert.ok(landingPage.includes("(/docs/claude/)"));
  });
});
