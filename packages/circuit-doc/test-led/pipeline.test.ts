/**
 * The real LED adapter driven end to end through the real Python validator
 * (#26), ported from upstream `pipeline.test.ts:26-113,198-205`
 * (`194d8a297e3545588197342130c3111a66c10973`).
 *
 * Validator-failure propagation and the generic adapter-contract refusals
 * (upstream lines 115-195) exercise `runPipeline` against a synthetic or
 * broken adapter and already live in `test/core/pipeline-anchors.test.ts` /
 * `test/validate/*.test.ts` (#5/#16). What is LED-bound is running the real
 * `createCircuitAdapter` with the real packaged Python validator over the
 * materialized corpus, and comparing the result to the pinned goldens.
 *
 * The committed generated tree lives at `docs.generatedContent` inside the
 * LED fixture's own `upstream/` (root-relative) layout — the real pinned
 * `fixtures/led/upstream/doc/src/content/docs/components/**`, so a dry run
 * against the scratch copy's `generatedRoot` reports zero drift for exactly
 * the reason `pnpm test:led`'s CLI harness (`scripts/check-led-fixture.mjs`)
 * does. The one deliberate difference — `viewModelVersion` moved from the
 * upstream extraction's 1 to this package's 2 (ADR-011) — is why the
 * preflight report is compared against `fixtures/led/expected/`, not
 * `fixtures/led/upstream/`, exactly as the CLI harness does.
 */

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { ComponentDocsError } from "../src/core/errors.ts";
import { runPipeline } from "../src/core/pipeline.ts";
import { VIEW_MODEL_VERSION } from "../src/core/view-model.ts";
import type { ComponentDataAdapter } from "../src/core/adapter.ts";
import { createCircuitAdapter } from "../src/provider/v1/index.ts";
import { createProjectValidator } from "../src/config/map.ts";
import { serializeReport } from "../src/cli/run.ts";
import type { LoadedProject } from "../src/cli/project.ts";
import { LED_FIXTURE_DIR, setUpLedProject, type LedScratch } from "./support/led-project.ts";

let scratch: LedScratch;
let project: LoadedProject;
let adapter: ComponentDataAdapter;

before(async () => {
  const led = await setUpLedProject();
  scratch = led;
  project = led.project;
  adapter = createCircuitAdapter({
    paths: project.paths,
    selection: project.selection,
    matrix: project.matrix,
    validator: createProjectValidator(project, process.env),
    integrationOwnerSkill: project.integrationOwnerSkill,
    reference: project.reference,
  });
});

after(() => {
  scratch?.cleanup();
});

describe("the real circuit adapter", () => {
  it("runs the canonical Python validator and projects the corpus", async () => {
    const result = await runPipeline(adapter, {
      generatedRoot: join(scratch.dir, "out-run", "generated"),
      dryRun: false,
      render: project.render,
    });

    // Corpus figures the epic states. A mismatch means evidence moved and the
    // committed selection needs review — exactly what should fail a build.
    assert.equal(result.report.records.available, 35);
    assert.equal(result.report.records.selected, 35);
    assert.equal(result.report.sources.available, 91);
    assert.equal(result.report.sources.selected, 91);
    assert.equal(result.report.viewModelVersion, VIEW_MODEL_VERSION);
    assert.equal(result.report.provider.id, "circuit-component-spec");

    // Eight cross-component rules, the same way: the ruleset lives outside
    // every owner bundle, so nothing else in this report would notice it
    // shrinking.
    assert.equal(result.report.counts.publishedIntegrationRules, 8);

    // The landing page, the catalog, the records index, the integration page,
    // and one page per selected record. A change in this count means a
    // renderer was added or a record stopped being published — both worth
    // failing on.
    const paths = result.pages.map((page) => page.relativePath);
    assert.equal(paths.length, result.report.records.selected + 4);
    assert.ok(paths.includes("index.mdx"));
    assert.ok(paths.includes("catalog/index.mdx"));
    assert.ok(paths.includes("records/index.mdx"));
    assert.ok(paths.includes("integration/index.mdx"));
    assert.ok(paths.includes("records/al8860mp-13/index.mdx"));
    // `emit` reports in path order; the renderers produce inventory order.
    assert.deepEqual([...(result.emitted?.written ?? [])].sort(), [...paths].sort());
  });

  it("is idempotent — a second run writes nothing", async () => {
    const generatedRoot = join(scratch.dir, "out-idempotent", "generated");
    await runPipeline(adapter, { generatedRoot, dryRun: false, render: project.render });
    const result = await runPipeline(adapter, { generatedRoot, dryRun: false, render: project.render });
    assert.deepEqual(result.emitted?.written, []);
    assert.deepEqual(
      [...(result.emitted?.unchanged ?? [])].sort(),
      result.pages.map((page) => page.relativePath).sort(),
    );
  });

  it("emits identical bytes on repeated runs (no timestamps, no locale order)", async () => {
    const first = await runPipeline(adapter, {
      generatedRoot: join(scratch.dir, "out-a", "generated"),
      dryRun: false,
      render: project.render,
    });
    const second = await runPipeline(adapter, {
      generatedRoot: join(scratch.dir, "out-b", "generated"),
      dryRun: false,
      render: project.render,
    });

    assert.equal(first.pages[0]?.contents, second.pages[0]?.contents);
    assert.equal(serializeReport(first.report), serializeReport(second.report));
  });

  it("denies every field the matrix denies, and withholds nothing it publishes", async () => {
    const result = await runPipeline(adapter, {
      generatedRoot: join(scratch.dir, "out-fields", "generated"),
      dryRun: true,
      render: project.render,
    });

    for (const field of result.report.fields) {
      if (field.decision === "PUBLISH") {
        assert.equal(field.withheld, 0, `${field.key} withheld a value while set to PUBLISH`);
      } else {
        assert.equal(field.emitted, 0, `${field.key} emitted a value while set to DENY`);
      }
    }
  });

  it("reports drift in check mode without writing", async () => {
    const generatedRoot = join(scratch.dir, "out-drift", "generated");
    await runPipeline(adapter, { generatedRoot, dryRun: false, render: project.render });

    const target = join(generatedRoot, "index.mdx");
    const original = await readFile(target, "utf8");
    await writeFile(target, `${original}\nedited by hand\n`, "utf8");

    const result = await runPipeline(adapter, { generatedRoot, dryRun: true, render: project.render });
    assert.deepEqual(result.drift, ["changed: index.mdx"]);
    assert.match(await readFile(target, "utf8"), /edited by hand/u);
  });
});

describe("committed output", () => {
  it("matches the committed generated tree and preflight report", async () => {
    const result = await runPipeline(adapter, {
      generatedRoot: project.paths.generatedRoot,
      dryRun: true,
      render: project.render,
    });
    assert.deepEqual(result.drift, []);

    // The pinned upstream extraction committed `viewModelVersion: 1`; this
    // package's committed golden (`fixtures/led/expected/`) records the one
    // deliberate difference (ADR-011): `viewModelVersion: 2`, everything else
    // byte-identical. `scripts/check-led-fixture.mjs` proves that relationship
    // independently at the CLI level; this asserts it directly against the
    // real, in-process pipeline result.
    const expected = await readFile(
      join(LED_FIXTURE_DIR, "expected/doc/component-docs/preflight.json"),
      "utf8",
    );
    assert.equal(serializeReport(result.report), expected);
  });
});

describe("adapter contract", () => {
  it("refuses an adapter that cannot produce this view-model version", async () => {
    const broken: ComponentDataAdapter = { ...adapter, supportedViewModelVersions: [] };
    await assert.rejects(
      runPipeline(broken, { generatedRoot: join(scratch.dir, "out-never"), dryRun: true }),
      (error: unknown) => error instanceof ComponentDocsError && error.code === "ADAPTER_CONTRACT",
    );
  });
});
