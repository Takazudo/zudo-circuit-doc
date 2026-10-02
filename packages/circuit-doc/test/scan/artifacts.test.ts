/**
 * `runArtifactScan` against synthetic dist trees.
 *
 * The synthetic project (`writeSyntheticProject`) is not the real render/emit
 * pipeline — it is a hand-built dist tree whose content is derived from the
 * SAME `buildPositiveControls`/`buildDiscoveryControls` helpers the scanner
 * itself uses, so a passing base case proves the scanner's own logic (surface
 * wiring, page/search coverage, hydration/credential/sitemap checks) rather
 * than re-proving the render pipeline (which owns its own tests).
 *
 * Adversarial cases (spec item 3, porting the spirit of upstream
 * `gates.test.ts:306-356,395`): a canary leak in HTML/search/llms fails; a
 * credential pattern fails; a vacuous scan with records present fails. A
 * declared-empty project (0 published records) passes with `SKIP:` lines.
 */

import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { ComponentDocsError } from "../../src/core/errors.ts";
import { harvestCanaries, type ScanTarget } from "../../src/core/scan.ts";
import { safeText } from "../../src/core/text.ts";
import { VIEW_MODEL_VERSION, type PublicViewModel } from "../../src/core/view-model.ts";
import { authoredContentTargets, runArtifactScan } from "../../src/scan/artifacts.ts";
import { sha256 } from "../../src/footprint-previews/hash.ts";
import { derivePublicCanonicalHashes } from "../../src/scan/public-canonical.ts";
import { buildScanPolicy } from "../../src/scan/policy.ts";
import { fixtureModel } from "../fixtures/view-model-fixtures.ts";
import { recordDistHtmlPath, writeSyntheticProject } from "./dist-fixture.ts";

const EMPTY_MODEL: PublicViewModel = {
  version: VIEW_MODEL_VERSION,
  provider: { id: safeText("fixture-provider", { field: "fixture" }), contractVersion: 1 },
  corpus: {
    ownerBundles: 0,
    records: 0,
    standaloneRecords: 0,
    subordinateRecords: 0,
    sources: 0,
    facts: 0,
    coverageDomains: 0,
    interactions: 0,
    pinMaps: 0,
    pins: 0,
    inventoryLines: 0,
    fittedLines: 0,
    dnpOrHandFitLines: 0,
  },
  records: [],
  packagePreviews: [],
  integration: [],
};

let scratch = "";

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "circuit-doc-artifact-scan-"));
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function policy() {
  return buildScanPolicy(null, { agentResources: true });
}

function canaryFor(value: string) {
  return harvestCanaries([{ evidence_extract: value }], { deniedKeys: ["evidence_extract"] });
}

function ownerSkillCanaryFor(value: string) {
  return harvestCanaries([{ owner_skill: value }, { skill: value }], { deniedKeys: ["owner_skill", "skill"] });
}

function rejectsWith(promise: Promise<unknown>, code: string, messagePattern?: RegExp): Promise<void> {
  return assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ComponentDocsError, `expected a ComponentDocsError, got ${String(error)}`);
    assert.equal(error.code, code);
    if (messagePattern !== undefined) assert.match(error.message, messagePattern);
    return true;
  });
}

describe("authoredContentTargets", () => {
  const contentRoot = join(tmpdir(), "target-helper", "docs", "src/content/docs");
  const target = (label: string): ScanTarget => ({ label, text: label });

  it("excludes a nested generated root and keeps authored content", () => {
    const targets = [
      target("content/components/records/x/index.mdx"),
      target("content/guide/intro.mdx"),
    ];

    assert.deepEqual(
      authoredContentTargets(targets, {
        contentRoot,
        generatedRoot: join(contentRoot, "components"),
      }),
      [target("content/guide/intro.mdx")],
    );
  });

  it("keeps every target when the generated root is outside content", () => {
    const targets = [target("content/components/records/x/index.mdx"), target("content/guide/intro.mdx")];

    assert.deepEqual(
      authoredContentTargets(targets, {
        contentRoot,
        generatedRoot: join(tmpdir(), "target-helper", "generated"),
      }),
      targets,
    );
  });

  it("drops every target when the generated root equals content", () => {
    const targets = [target("content/components/records/x/index.mdx"), target("content/guide/intro.mdx")];

    assert.deepEqual(authoredContentTargets(targets, { contentRoot, generatedRoot: contentRoot }), []);
  });

  it("does not exclude a sibling whose label only shares a prefix", () => {
    const targets = [
      target("content/components/records/x/index.mdx"),
      target("content/components-extra/a.mdx"),
    ];

    assert.deepEqual(
      authoredContentTargets(targets, {
        contentRoot,
        generatedRoot: join(contentRoot, "components"),
      }),
      [target("content/components-extra/a.mdx")],
    );
  });
});

describe("a correctly built dist tree passes", () => {
  it("reports both tiers clean and the built pages/searchable counts", async () => {
    const model = fixtureModel();
    const project = await writeSyntheticProject(join(scratch, "happy"), model);
    const canaries = ownerSkillCanaryFor("CANARY-OWNER-SKILL-NOT-PUBLISHED-VALUE-0001");

    const report = await runArtifactScan({
      publicCanonicalHashes: [],
      policy: policy(),
      paths: project,
      docsRoot: project.docsRoot,
      canaries,
      model,
      agentSkillRoot: null,
    });

    const expectedPages = model.records.length + 4; // 4 section pages + one per record
    assert.ok(report.lines.some((line) => line.includes("OWNED tier")));
    assert.ok(report.lines.some((line) => line.includes("SITE tier")));
    assert.ok(report.lines.some((line) => new RegExp(`built pages\\s+${expectedPages}\\b`, "u").test(line)));
    assert.ok(
      report.lines.some((line) => new RegExp(`searchable records\\s+${model.records.length}\\b`, "u").test(line)),
    );
    assert.ok(!report.lines.some((line) => line.startsWith("SKIP:")));
  });

  it("counts authored pages outside nested generatedContent as withheld from SITE", async () => {
    const model = fixtureModel();
    const root = join(scratch, "withheld-authored-content");
    const contentRoot = join(root, "doc", "src/content/docs");
    const project = await writeSyntheticProject(root, model, {
      generatedRoot: join(contentRoot, "components"),
    });
    const value = "CANARY-AUTHORED-GUIDE-WITHHELD-FROM-SITE-0001";
    const siteValue = "CANARY-REMAINS-IN-SITE-SCAN-0002";
    await mkdir(join(contentRoot, "guide"), { recursive: true });
    await writeFile(join(contentRoot, "guide", "intro.mdx"), value);

    const report = await runArtifactScan({
      publicCanonicalHashes: [],
      policy: policy(),
      paths: project,
      docsRoot: project.docsRoot,
      canaries: [...canaryFor(value), ...canaryFor(siteValue)],
      model,
      agentSkillRoot: null,
    });

    // This confirms the authored corpus is read; helper unit cases separately
    // prove that the generated subtree itself is excluded.
    const withheldLine = report.lines.find((line) => line.includes("canary/canaries withheld"));
    assert.equal(withheldLine?.trim(), "1 canary/canaries withheld (published by another content source)");
  });
});

describe("adversarial: a canary leak fails closed", () => {
  it("fails when a denied value leaks into a built record page", async () => {
    const model = fixtureModel();
    const project = await writeSyntheticProject(join(scratch, "leak-html"), model);
    const leak = "CANARY-LEAKED-INTO-BUILT-HTML-0002";
    const canaries = canaryFor(leak);
    const slug = model.records[0]?.identity.slug as string;
    await appendFile(recordDistHtmlPath(project, slug), leak);

    await rejectsWith(
      runArtifactScan({ publicCanonicalHashes: [], policy: policy(), paths: project, docsRoot: project.docsRoot, canaries, model, agentSkillRoot: null }),
      "PUBLICATION_POLICY",
      /denied value/u,
    );
  });

  it("fails when a denied value leaks into search-index.json", async () => {
    const model = fixtureModel();
    const project = await writeSyntheticProject(join(scratch, "leak-search"), model);
    const leak = "CANARY-LEAKED-INTO-SEARCH-INDEX-0003";
    const canaries = canaryFor(leak);
    // search-index.json must stay valid JSON: the leak is planted as an extra
    // entry's description, the way a real leak would arrive (an indexed field
    // carrying a denied value), not as bytes appended after the document.
    const searchIndexPath = join(project.distRoot, "search-index.json");
    const entries = JSON.parse(await readFile(searchIndexPath, "utf8")) as readonly unknown[];
    await writeFile(
      searchIndexPath,
      JSON.stringify([...entries, { url: "/docs/components/records/leaked", description: leak }]),
    );

    await rejectsWith(
      runArtifactScan({ publicCanonicalHashes: [], policy: policy(), paths: project, docsRoot: project.docsRoot, canaries, model, agentSkillRoot: null }),
      "PUBLICATION_POLICY",
      /denied value/u,
    );
  });

  it("fails when a denied value leaks into llms.txt", async () => {
    const model = fixtureModel();
    const project = await writeSyntheticProject(join(scratch, "leak-llms"), model);
    const leak = "CANARY-LEAKED-INTO-LLMS-TXT-0004";
    const canaries = canaryFor(leak);
    await appendFile(join(project.distRoot, "llms.txt"), `\n${leak}`);

    await rejectsWith(
      runArtifactScan({ publicCanonicalHashes: [], policy: policy(), paths: project, docsRoot: project.docsRoot, canaries, model, agentSkillRoot: null }),
      "PUBLICATION_POLICY",
      /denied value/u,
    );
  });
});

describe("adversarial: a denied owner-skill canary leak fails closed", () => {
  it("fails when a denied owner skill leaks into a built record page", async () => {
    const model = fixtureModel();
    const project = await writeSyntheticProject(join(scratch, "owner-skill-leak-html"), model);
    const leak = "CANARY-OWNER-SKILL-LEAKED-INTO-HTML-0002";
    const canaries = ownerSkillCanaryFor(leak);
    const slug = model.records[0]?.identity.slug as string;
    await appendFile(recordDistHtmlPath(project, slug), leak);

    await rejectsWith(
      runArtifactScan({
        publicCanonicalHashes: [],
        policy: policy(),
        paths: project,
        docsRoot: project.docsRoot,
        canaries,
        model,
        agentSkillRoot: null,
      }),
      "PUBLICATION_POLICY",
      /denied value/u,
    );
  });

  it("fails when a denied owner skill leaks into search-index.json", async () => {
    const model = fixtureModel();
    const project = await writeSyntheticProject(join(scratch, "owner-skill-leak-search"), model);
    const leak = "CANARY-OWNER-SKILL-LEAKED-INTO-SEARCH-0003";
    const canaries = ownerSkillCanaryFor(leak);
    const searchIndexPath = join(project.distRoot, "search-index.json");
    const entries = JSON.parse(await readFile(searchIndexPath, "utf8")) as readonly unknown[];
    await writeFile(
      searchIndexPath,
      JSON.stringify([...entries, { url: "/docs/components/records/leaked", description: leak }]),
    );

    await rejectsWith(
      runArtifactScan({
        publicCanonicalHashes: [],
        policy: policy(),
        paths: project,
        docsRoot: project.docsRoot,
        canaries,
        model,
        agentSkillRoot: null,
      }),
      "PUBLICATION_POLICY",
      /denied value/u,
    );
  });

  for (const filename of ["llms.txt", "llms-full.txt"] as const) {
    it(`fails when a denied owner skill leaks into ${filename}`, async () => {
      const model = fixtureModel();
      const project = await writeSyntheticProject(join(scratch, `owner-skill-leak-${filename}`), model);
      const leak = `CANARY-OWNER-SKILL-LEAKED-INTO-${filename.toUpperCase().replaceAll(".", "-")}-0004`;
      const canaries = ownerSkillCanaryFor(leak);
      await appendFile(join(project.distRoot, filename), `\n${leak}`);

      await rejectsWith(
        runArtifactScan({
          publicCanonicalHashes: [],
          policy: policy(),
          paths: project,
          docsRoot: project.docsRoot,
          canaries,
          model,
          agentSkillRoot: null,
        }),
        "PUBLICATION_POLICY",
        /denied value/u,
      );
    });
  }
});

describe("adversarial: a credential pattern fails closed", () => {
  it("fails on an AWS access key id in a built artifact", async () => {
    const model = fixtureModel();
    const project = await writeSyntheticProject(join(scratch, "credential"), model);
    const canaries = canaryFor("CANARY-NOT-PUBLISHED-ANYWHERE-VALUE-0005");
    await appendFile(join(project.distRoot, "llms.txt"), "\nAKIA1234567890ABCDEF leaked");

    await rejectsWith(
      runArtifactScan({ publicCanonicalHashes: [], policy: policy(), paths: project, docsRoot: project.docsRoot, canaries, model, agentSkillRoot: null }),
      "PUBLICATION_POLICY",
      /credential/u,
    );
  });
});

describe("adversarial: a vacuous scan with records present fails closed", () => {
  it("fails when the generated MDX surface produced no files despite published records", async () => {
    const model = fixtureModel();
    const project = await writeSyntheticProject(join(scratch, "vacuous"), model);
    const canaries = canaryFor("CANARY-NOT-PUBLISHED-ANYWHERE-VALUE-0006");
    // Simulate `scan` running against a dist that was built without `generate`
    // having populated the generated-content tree (the directory exists, empty).
    await rm(project.generatedRoot, { recursive: true, force: true });
    await mkdir(project.generatedRoot, { recursive: true });

    await rejectsWith(
      runArtifactScan({ publicCanonicalHashes: [], policy: policy(), paths: project, docsRoot: project.docsRoot, canaries, model, agentSkillRoot: null }),
      "PUBLICATION_POLICY",
      /produced no content/u,
    );
  });
});

describe("declared-empty mode (0 published records)", () => {
  it("passes with explicit SKIP: lines instead of running the record-derived checks", async () => {
    const project = await writeSyntheticProject(join(scratch, "declared-empty"), EMPTY_MODEL);

    const report = await runArtifactScan({
      publicCanonicalHashes: [],
      policy: policy(),
      paths: project,
      docsRoot: project.docsRoot,
      canaries: [],
      model: EMPTY_MODEL,
      agentSkillRoot: null,
    });

    const skipLines = report.lines.filter((line) => line.startsWith("SKIP:"));
    assert.ok(skipLines.length >= 3, `expected several SKIP: lines, got:\n${report.lines.join("\n")}`);
    assert.ok(skipLines.some((line) => line.includes("positive controls")));
    assert.ok(skipLines.some((line) => line.includes("non-vacuity floors")));
    assert.ok(report.lines.some((line) => /built pages\s+4/u.test(line)));
    assert.ok(report.lines.some((line) => /searchable records\s+0/u.test(line)));
  });

  it("still fails a credential pattern even at zero records", async () => {
    const project = await writeSyntheticProject(join(scratch, "declared-empty-credential"), EMPTY_MODEL);
    await appendFile(join(project.distRoot, "llms.txt"), "\nAKIA1234567890ABCDEF leaked");

    await rejectsWith(
      runArtifactScan({
        publicCanonicalHashes: [],
        policy: policy(),
        paths: project,
        docsRoot: project.docsRoot,
        canaries: [],
        model: EMPTY_MODEL,
        agentSkillRoot: null,
      }),
      "PUBLICATION_POLICY",
      /credential/u,
    );
  });

  it("still fails an unexpected extra record page even at zero records", async () => {
    const project = await writeSyntheticProject(join(scratch, "declared-empty-extra-page"), EMPTY_MODEL);
    await mkdir(join(project.distRoot, "docs/components/records/phantom"), { recursive: true });
    await writeFile(join(project.distRoot, "docs/components/records/phantom/index.html"), "<html></html>");

    await rejectsWith(
      runArtifactScan({
        publicCanonicalHashes: [],
        policy: policy(),
        paths: project,
        docsRoot: project.docsRoot,
        canaries: [],
        model: EMPTY_MODEL,
        agentSkillRoot: null,
      }),
      "PUBLICATION_POLICY",
      /pages the projection did not produce/u,
    );
  });
});

describe("a missing dist is a hard failure, never a silent skip", () => {
  it("fails with ADAPTER_CONTRACT when dist has not been built", async () => {
    const project = await writeSyntheticProject(join(scratch, "missing-dist-source"), fixtureModel());
    await rm(project.distRoot, { recursive: true, force: true });
    await mkdir(project.distRoot, { recursive: true });

    await rejectsWith(
      runArtifactScan({
        publicCanonicalHashes: [],
        policy: policy(),
        paths: project,
        docsRoot: project.docsRoot,
        canaries: [],
        model: fixtureModel(),
        agentSkillRoot: null,
      }),
      "ADAPTER_CONTRACT",
      /dist is empty/u,
    );
  });
});


describe("SITE-only declared public canonical hashes", () => {
  async function canonicalProject(label: string) {
    const root = join(scratch, `canonical-${label}`);
    const model = fixtureModel();
    const preview = model.packagePreviews[0]!;
    const project = await writeSyntheticProject(root, model);
    const paths = {
      ...project,
      projectRoot: root,
      footprintLibraryRoot: join(root, "footprints"),
      footprintPreviewRoot: join(project.docsRoot, "public/assets/component-previews/footprints"),
    };
    const bytes = `(footprint "${preview.footprintName}")\n`;
    const digest = sha256(bytes);
    await mkdir(paths.footprintLibraryRoot, { recursive: true });
    await writeFile(join(paths.footprintLibraryRoot, `${preview.footprintName}.kicad_mod`), bytes);
    const builtPreviewRoot = join(paths.distRoot, "assets/component-previews/footprints");
    await mkdir(builtPreviewRoot, { recursive: true });
    await writeFile(join(builtPreviewRoot, "manifest.json"), JSON.stringify({
      formatVersion: 1,
      packages: [{ footprintName: preview.footprintName, footprintPath: preview.footprintPath, canonicalInputSha256: digest }],
    }));
    const publicCanonicalHashes = await derivePublicCanonicalHashes({
      declared: [preview.footprintName], model, paths,
    });
    const canaries = [
      ...harvestCanaries([{ sha256: digest }], { deniedKeys: ["sha256"] }),
      // Retain a denied value after subtraction so the normal non-vacuity
      // floor stays active in these published-record fixtures.
      ...canaryFor("UNRELATED-CANARY-REMAINS-DENIED-0001"),
    ];
    const input = { policy: policy(), paths, docsRoot: paths.docsRoot, model, canaries, publicCanonicalHashes, agentSkillRoot: null };
    return { input, digest };
  }

  it("fails SITE for a canonical digest in the public built manifest when undeclared", async () => {
    const { input } = await canonicalProject("undeclared");
    await rejectsWith(runArtifactScan({ ...input, publicCanonicalHashes: [] }), "PUBLICATION_POLICY", /denied value/u);
  });

  it("passes SITE when declared and reports one separately withheld hash", async () => {
    const { input } = await canonicalProject("declared");
    const report = await runArtifactScan(input);
    assert.ok(report.lines.some((line) => line.trim() === "1 canary/canaries withheld as declared public canonical footprint hashes"));
    assert.ok(report.lines.some((line) => line.trim() === "0 canary/canaries withheld (published by another content source)"));
    assert.ok(report.lines.some((line) => /OWNED tier\s+2 canaries/u.test(line)));
    assert.ok(report.lines.some((line) => /SITE tier\s+1 canaries/u.test(line)));
  });

  it("still fails OWNED when the declared digest appears in a built component page", async () => {
    const { input, digest } = await canonicalProject("owned-leak");
    await appendFile(recordDistHtmlPath(input.paths, input.model.records[0]!.identity.slug), digest);
    await rejectsWith(runArtifactScan(input), "PUBLICATION_POLICY", /denied value/u);
  });

  for (const key of ["evidence_extract", "identity_extract_sha256"]) {
    it(`still fails SITE for an equal digest reached through ${key}`, async () => {
      const { input, digest } = await canonicalProject(key);
      const otherKeyCanaries = harvestCanaries([{ [key]: digest }], { deniedKeys: [key] });
      assert.equal(otherKeyCanaries.length, 1);
      await rejectsWith(runArtifactScan({ ...input, canaries: otherKeyCanaries }), "PUBLICATION_POLICY", /denied value/u);
    });
  }

  it("still fails SITE when the digest is harvested through sha256 before evidence_extract", async () => {
    const { input, digest } = await canonicalProject("same-value-two-keys");
    const canaries = harvestCanaries([{ sha256: digest, evidence_extract: digest }], { deniedKeys: ["sha256", "evidence_extract"] });
    assert.equal(canaries.length, 2);
    await rejectsWith(runArtifactScan({ ...input, canaries }), "PUBLICATION_POLICY", /denied value/u);
  });

  it("still fails SITE for a different sha256 value", async () => {
    const { input } = await canonicalProject("different-digest");
    const different = sha256("unpublished private evidence");
    await writeFile(join(input.paths.distRoot, "leak.txt"), different);
    const canaries = [...input.canaries, ...harvestCanaries([{ sha256: different }], { deniedKeys: ["sha256"] })];
    assert.equal(canaries.length, 3);
    await rejectsWith(runArtifactScan({ ...input, canaries }), "PUBLICATION_POLICY", /denied value/u);
  });

  it("counts a digest already in authored content only toward expectedWithheld", async () => {
    const { input, digest } = await canonicalProject("authored-digest");
    await writeFile(join(input.paths.docsRoot, "src/content/docs/guide.mdx"), digest);
    const report = await runArtifactScan({ ...input, policy: { ...input.policy, expectedWithheld: 1 } });
    assert.ok(report.lines.some((line) => line.trim() === "1 canary/canaries withheld (published by another content source)"));
    assert.ok(report.lines.some((line) => line.trim() === "0 canary/canaries withheld as declared public canonical footprint hashes"));
  });

  it("does not count a newly exempt hash toward expectedWithheld", async () => {
    const { input } = await canonicalProject("expected-withheld");
    await runArtifactScan({ ...input, policy: { ...input.policy, expectedWithheld: 0 } });
    await rejectsWith(runArtifactScan({ ...input, policy: { ...input.policy, expectedWithheld: 1 } }), "PUBLICATION_POLICY", /number of canaries withheld/u);
  });
});
