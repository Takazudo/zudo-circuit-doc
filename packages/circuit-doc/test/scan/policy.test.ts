/**
 * `ScanPolicy` derivation: config overrides win verbatim (this is how the LED
 * fixture, #23, restores the exact upstream floors); absent an override the
 * policy carries `null` (generic-default) rather than a copy-pasted number.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildScanPolicy } from "../../src/scan/policy.ts";

describe("buildScanPolicy", () => {
  it("carries config overrides verbatim", () => {
    const policy = buildScanPolicy(
      {
        minimumOwnedCanaries: 100,
        minimumOwnedFiles: 60,
        minimumSiteCanaries: 100,
        minimumSiteFiles: 150,
        expectedWithheld: 6,
        positiveControlRecord: "al8860mp-13",
      },
      { agentResources: true },
    );
    assert.equal(policy.minimumOwnedCanaries, 100);
    assert.equal(policy.minimumOwnedFiles, 60);
    assert.equal(policy.minimumSiteCanaries, 100);
    assert.equal(policy.minimumSiteFiles, 150);
    assert.equal(policy.expectedWithheld, 6);
    assert.equal(policy.positiveControlRecord, "al8860mp-13");
  });

  it("defaults to null overrides and \"auto\" when scan config is absent", () => {
    const policy = buildScanPolicy(null, { agentResources: true });
    assert.equal(policy.minimumOwnedCanaries, null);
    assert.equal(policy.minimumOwnedFiles, null);
    assert.equal(policy.minimumSiteCanaries, null);
    assert.equal(policy.minimumSiteFiles, null);
    assert.equal(policy.expectedWithheld, null);
    assert.equal(policy.positiveControlRecord, "auto");
  });

  it("derives required agent routes from core/site.ts, empty when agentResources is off", () => {
    const on = buildScanPolicy(null, { agentResources: true });
    assert.deepEqual(on.requiredAgentRoutes, [
      "/docs/components/index.",
      "/docs/components/catalog/",
      "/docs/components/integration/",
      "/docs/components/records/",
    ]);

    const off = buildScanPolicy(null, { agentResources: false });
    assert.deepEqual(off.requiredAgentRoutes, []);
  });

  it("derives the section-page dist labels from core/site.ts", () => {
    const policy = buildScanPolicy(null, { agentResources: true });
    assert.deepEqual(policy.sectionPages, [
      "dist/docs/components/index.html",
      "dist/docs/components/catalog/index.html",
      "dist/docs/components/records/index.html",
      "dist/docs/components/integration/index.html",
    ]);
  });

  it("uses the default dist artifact names and sitemap pattern", () => {
    const policy = buildScanPolicy(null, { agentResources: true });
    assert.equal(policy.artifacts.searchIndex, "search-index.json");
    assert.equal(policy.artifacts.llms, "llms.txt");
    assert.equal(policy.artifacts.llmsFull, "llms-full.txt");
    assert.equal(policy.artifacts.assetViewerRoutePrefix, "/files/");
    assert.ok(policy.artifacts.sitemapPattern.test("dist/sitemap.xml"));
    assert.ok(policy.artifacts.sitemapPattern.test("dist/sitemap-index.xml"));
    assert.ok(!policy.artifacts.sitemapPattern.test("dist/site-map.xml"));
  });
});
