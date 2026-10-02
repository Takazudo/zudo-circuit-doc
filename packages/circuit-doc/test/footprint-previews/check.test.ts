/**
 * `checkFootprintPreviews` (issue #20): Docker-free drift detection against
 * whatever `generateFootprintPreviews` just committed, the zero-selection
 * semantics, and CAD-03 (a changed canonical footprint fails the check until
 * regenerated).
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { ComponentDocsError, type ErrorCode } from "../../src/core/errors.ts";
import { checkFootprintPreviews, type CheckFootprintPreviewsOptions } from "../../src/footprint-previews/check.ts";
import { generateFootprintPreviews } from "../../src/footprint-previews/generate.ts";
import type { CircuitProjectPaths } from "../../src/provider/v1/paths.ts";
import { fakeDockerRunner } from "./fake-docker.ts";
import { FIXTURE_RENDERER, buildFootprintFixture, type FootprintFixture } from "./fixture.ts";

let scratch = "";

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "circuit-doc-footprint-check-"));
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** Build a fixture and immediately generate its committed previews, as a real project would have. */
async function generated(name: string, publishMembership = true): Promise<FootprintFixture> {
  const fixture = await buildFootprintFixture(join(scratch, name));
  await generateFootprintPreviews({
    selections: fixture.selections,
    footprintMasterRoot: fixture.paths.footprintMasterRoot,
    footprintLibraryRoot: fixture.paths.footprintLibraryRoot,
    previewRoot: fixture.paths.footprintPreviewRoot,
    renderer: FIXTURE_RENDERER,
    publishMembership,
    runDocker: fakeDockerRunner(FIXTURE_RENDERER.version),
  });
  return fixture;
}

function optionsFor(fixture: FootprintFixture, publishMembership = true): CheckFootprintPreviewsOptions {
  return {
    selections: fixture.selections,
    footprintMasterRoot: fixture.paths.footprintMasterRoot,
    footprintLibraryRoot: fixture.paths.footprintLibraryRoot,
    previewRoot: fixture.paths.footprintPreviewRoot,
    renderer: FIXTURE_RENDERER,
    publishMembership,
  };
}

describe("checkFootprintPreviews", () => {
  it("accepts what generate just committed", async () => {
    const fixture = await generated("happy-path");
    await assert.doesNotReject(checkFootprintPreviews(optionsFor(fixture)));
  });

  it("CAD-03: a canonical footprint changed after generation fails until regenerated", async () => {
    const fixture = await generated("cad-03");
    const first = fixture.selections[0]!;
    // Change both copies identically so the parity check (which runs first)
    // stays green, isolating the input-hash staleness this case targets.
    for (const root of [fixture.paths.footprintMasterRoot, fixture.paths.footprintLibraryRoot]) {
      await writeFile(join(root, `${first.footprintName}.kicad_mod`), "\n", { flag: "a" });
    }
    await rejectsWith(checkFootprintPreviews(optionsFor(fixture)), "ADAPTER_CONTRACT", /stale canonical input hash/u);

    // Regenerating clears it.
    await generateFootprintPreviews({
      selections: fixture.selections,
      footprintMasterRoot: fixture.paths.footprintMasterRoot,
      footprintLibraryRoot: fixture.paths.footprintLibraryRoot,
      previewRoot: fixture.paths.footprintPreviewRoot,
      renderer: FIXTURE_RENDERER,
      runDocker: fakeDockerRunner(FIXTURE_RENDERER.version),
    });
    await assert.doesNotReject(checkFootprintPreviews(optionsFor(fixture)));
  });

  it("fails on a missing committed SVG", async () => {
    const fixture = await generated("missing");
    const first = fixture.selections[0]!;
    await unlink(join(fixture.paths.footprintPreviewRoot, `${first.footprintName}.svg`));
    await rejectsWith(checkFootprintPreviews(optionsFor(fixture)), "ADAPTER_CONTRACT", /missing footprint preview output/u);
  });

  it("fails on an extra file in the preview root", async () => {
    const fixture = await generated("extra");
    await writeFile(join(fixture.paths.footprintPreviewRoot, "extra.svg"), "x", "utf8");
    await rejectsWith(checkFootprintPreviews(optionsFor(fixture)), "ADAPTER_CONTRACT", /extra footprint preview output/u);
  });

  it("fails on an unsafe committed SVG", async () => {
    const fixture = await generated("unsafe");
    const first = fixture.selections[0]!;
    const target = join(fixture.paths.footprintPreviewRoot, `${first.footprintName}.svg`);
    const svg = await readFile(target, "utf8");
    await writeFile(target, svg.replace("<path ", '<path onclick="x" '), "utf8");
    await rejectsWith(checkFootprintPreviews(optionsFor(fixture)), "PUBLICATION_POLICY", /unsafe/u);
  });

  it("fails on a symlinked committed SVG", async () => {
    const fixture = await generated("symlinked");
    const first = fixture.selections[0]!;
    const target = join(fixture.paths.footprintPreviewRoot, `${first.footprintName}.svg`);
    // The real bytes live OUTSIDE the preview root, so the symlink is the only
    // problem this case tests (a copy left inside the root would itself be an
    // unexpected extra file).
    const real = join(scratch, `symlinked-real-${first.footprintName}.svg`);
    await writeFile(real, await readFile(target, "utf8"), "utf8");
    await unlink(target);
    await symlink(real, target);
    await rejectsWith(checkFootprintPreviews(optionsFor(fixture)), "PATH_CONTAINMENT", /not a regular file/u);
  });

  it("fails on a stale package selection (a record alias added after generation)", async () => {
    const fixture = await generated("stale-selection");
    const changed = fixture.selections.map((entry, index) =>
      index === 0 ? { ...entry, recordIds: [...entry.recordIds, "rec-invented"] } : entry,
    );
    await rejectsWith(
      checkFootprintPreviews({ ...optionsFor(fixture), selections: changed }),
      "ADAPTER_CONTRACT",
      /stale package selection/u,
    );
  });

  it("accepts denied membership and rejects a manifest that retains recordIds", async () => {
    const fixture = await generated("denied-membership", false);
    const checkOptions = optionsFor(fixture, false);
    const manifestPath = join(fixture.paths.footprintPreviewRoot, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      packages: Array<Record<string, unknown>>;
    };
    assert.ok(manifest.packages.every((entry) => !Object.hasOwn(entry, "recordIds")));
    await assert.doesNotReject(checkFootprintPreviews(checkOptions));

    manifest.packages[0]!.recordIds = fixture.selections[0]!.recordIds;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rejectsWith(checkFootprintPreviews(checkOptions), "ADAPTER_CONTRACT", /stale package selection/u);
  });

  describe("zero-selection semantics", () => {
    async function zeroFixture(name: string): Promise<CircuitProjectPaths> {
      const fixture = await buildFootprintFixture(join(scratch, name), {
        contents: {
          bundles: [],
          inventory: { schema_version: 1, assertions: { orderable_lines: 0, fitted_lines: 0, dnp_or_hand_fit_lines: 0 }, lines: [] },
          rules: { schema_version: 1, rules: [] },
        },
        selection: {
          recordIds: [],
          sourceIds: [],
          linkableSourceIds: [],
          documentSelections: [],
          expect: { records: 0, sources: 0, integrationRules: 0, packages: 0 },
        },
      });
      assert.deepEqual(fixture.selections, []);
      return fixture.paths;
    }

    it("passes when the preview root is absent", async () => {
      const paths = await zeroFixture("zero-absent");
      await rm(paths.footprintPreviewRoot, { recursive: true, force: true });
      await assert.doesNotReject(
        checkFootprintPreviews({
          selections: [],
          footprintMasterRoot: paths.footprintMasterRoot,
          footprintLibraryRoot: paths.footprintLibraryRoot,
          previewRoot: paths.footprintPreviewRoot,
        }),
      );
    });

    it("passes when the preview root holds the empty manifest", async () => {
      const paths = await zeroFixture("zero-empty-manifest");
      await generateFootprintPreviews({
        selections: [],
        footprintMasterRoot: paths.footprintMasterRoot,
        footprintLibraryRoot: paths.footprintLibraryRoot,
        previewRoot: paths.footprintPreviewRoot,
      });
      await assert.doesNotReject(
        checkFootprintPreviews({
          selections: [],
          footprintMasterRoot: paths.footprintMasterRoot,
          footprintLibraryRoot: paths.footprintLibraryRoot,
          previewRoot: paths.footprintPreviewRoot,
        }),
      );
    });

    it("A configured root that is missing, symlinked or malformed still fails when packages ARE expected", async () => {
      const paths = await zeroFixture("zero-but-nonzero-expected");
      await rm(paths.footprintPreviewRoot, { recursive: true, force: true });
      await mkdir(paths.footprintPreviewRoot, { recursive: true });
      await rejectsWith(
        checkFootprintPreviews({
          selections: [{ packageId: "p", footprintName: "P", footprintPath: "P.kicad_mod", recordIds: ["rec-p"] }],
          footprintMasterRoot: paths.footprintMasterRoot,
          footprintLibraryRoot: paths.footprintLibraryRoot,
          previewRoot: paths.footprintPreviewRoot,
          renderer: FIXTURE_RENDERER,
        }),
        "ADAPTER_CONTRACT",
        /footprint preview manifest is missing; run `pnpm previews:generate`/u,
      );
    });

    it("#57: a missing preview root (with packages expected) hints at `pnpm previews:generate`", async () => {
      const paths = await zeroFixture("root-missing-nonzero-expected");
      await rm(paths.footprintPreviewRoot, { recursive: true, force: true });
      await rejectsWith(
        checkFootprintPreviews({
          selections: [{ packageId: "p", footprintName: "P", footprintPath: "P.kicad_mod", recordIds: ["rec-p"] }],
          footprintMasterRoot: paths.footprintMasterRoot,
          footprintLibraryRoot: paths.footprintLibraryRoot,
          previewRoot: paths.footprintPreviewRoot,
          renderer: FIXTURE_RENDERER,
        }),
        "ADAPTER_CONTRACT",
        /footprint preview root is missing; run `pnpm previews:generate`/u,
      );
    });

    it("still fails on an extra file even when zero packages are expected", async () => {
      const paths = await zeroFixture("zero-extra-file");
      await generateFootprintPreviews({
        selections: [],
        footprintMasterRoot: paths.footprintMasterRoot,
        footprintLibraryRoot: paths.footprintLibraryRoot,
        previewRoot: paths.footprintPreviewRoot,
      });
      await writeFile(join(paths.footprintPreviewRoot, "stale.svg"), "x", "utf8");
      await rejectsWith(
        checkFootprintPreviews({
          selections: [],
          footprintMasterRoot: paths.footprintMasterRoot,
          footprintLibraryRoot: paths.footprintLibraryRoot,
          previewRoot: paths.footprintPreviewRoot,
        }),
        "ADAPTER_CONTRACT",
        /extra footprint preview output/u,
      );
    });
  });
});

async function rejectsWith(run: Promise<unknown>, code: ErrorCode, message: RegExp): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof ComponentDocsError, String(error));
    assert.equal(error.code, code, error.message);
    assert.match(error.message, message);
    return true;
  });
}
