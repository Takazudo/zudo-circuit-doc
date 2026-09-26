/**
 * `generateFootprintPreviews` (issue #20): config-driven renderer, an
 * injectable Docker runner (no real Docker anywhere in this suite), the
 * ownership guard replacing the old unconditional `rm -rf`, and the
 * zero-package state never touching Docker.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { ComponentDocsError, type ErrorCode } from "../../src/core/errors.ts";
import { generateFootprintPreviews } from "../../src/footprint-previews/generate.ts";
import { FIXTURE_PACKAGE_COUNT } from "../fixtures/provider-fixtures.ts";
import { fakeDockerRunner } from "./fake-docker.ts";
import { FIXTURE_RENDERER, buildFootprintFixture } from "./fixture.ts";

let scratch = "";

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "circuit-doc-footprint-generate-"));
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("generateFootprintPreviews", () => {
  it("writes a manifest and one normalized SVG per selected package, in selection order", async () => {
    const { paths, selections } = await buildFootprintFixture(join(scratch, "happy-path"));
    assert.equal(selections.length, FIXTURE_PACKAGE_COUNT);

    const manifest = await generateFootprintPreviews({
      selections,
      footprintMasterRoot: paths.footprintMasterRoot,
      footprintLibraryRoot: paths.footprintLibraryRoot,
      previewRoot: paths.footprintPreviewRoot,
      renderer: FIXTURE_RENDERER,
      runDocker: fakeDockerRunner(FIXTURE_RENDERER.version),
    });

    assert.deepEqual(manifest.packages.map((entry) => entry.footprintName), selections.map((entry) => entry.footprintName));
    assert.equal(manifest.renderer?.image, FIXTURE_RENDERER.image);
    assert.equal(manifest.renderer?.version, FIXTURE_RENDERER.version);

    const written = (await readdir(paths.footprintPreviewRoot)).sort();
    assert.deepEqual(written, ["manifest.json", ...selections.map((entry) => `${entry.footprintName}.svg`)].sort());
    for (const entry of manifest.packages) {
      const svg = await readFile(join(paths.footprintPreviewRoot, `${entry.footprintName}.svg`), "utf8");
      assert.doesNotMatch(svg, /<title|<\?xml/u);
    }
  });

  it("never invokes Docker for the zero-package state, and still writes the empty manifest", async () => {
    const { paths, selections } = await buildFootprintFixture(join(scratch, "zero-state"), {
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
    assert.deepEqual(selections, []);

    const runDocker = async (): Promise<never> => {
      throw new Error("Docker must not be invoked for zero selected packages");
    };
    const manifest = await generateFootprintPreviews({
      selections,
      footprintMasterRoot: paths.footprintMasterRoot,
      footprintLibraryRoot: paths.footprintLibraryRoot,
      previewRoot: paths.footprintPreviewRoot,
      runDocker,
    });
    assert.deepEqual(manifest.packages, []);
    assert.equal(manifest.renderer, undefined);
    assert.deepEqual(await readdir(paths.footprintPreviewRoot), ["manifest.json"]);
  });

  it("PATH_CONTAINMENT: refuses to replace a preview root holding a file it does not own", async () => {
    const { paths, selections } = await buildFootprintFixture(join(scratch, "ownership-guard"));
    await mkdir(paths.footprintPreviewRoot, { recursive: true });
    await writeFile(join(paths.footprintPreviewRoot, "stale-notes.txt"), "not ours", "utf8");

    await rejectsWith(
      generateFootprintPreviews({
        selections,
        footprintMasterRoot: paths.footprintMasterRoot,
        footprintLibraryRoot: paths.footprintLibraryRoot,
        previewRoot: paths.footprintPreviewRoot,
        renderer: FIXTURE_RENDERER,
        runDocker: fakeDockerRunner(FIXTURE_RENDERER.version),
      }),
      "PATH_CONTAINMENT",
      /does not own/u,
    );
    // Refusing to delete means the stray file must still be there afterwards.
    assert.ok((await readdir(paths.footprintPreviewRoot)).includes("stale-notes.txt"));
  });

  it("fails closed when the pinned renderer reports an unexpected version", async () => {
    const { paths, selections } = await buildFootprintFixture(join(scratch, "wrong-version"));
    await rejectsWith(
      generateFootprintPreviews({
        selections,
        footprintMasterRoot: paths.footprintMasterRoot,
        footprintLibraryRoot: paths.footprintLibraryRoot,
        previewRoot: paths.footprintPreviewRoot,
        renderer: FIXTURE_RENDERER,
        runDocker: fakeDockerRunner("0.0.0-not-pinned"),
      }),
      "ADAPTER_CONTRACT",
      /unexpected version/u,
    );
  });

  it("fails when the dual-location footprint inventory has drifted", async () => {
    const { paths, selections } = await buildFootprintFixture(join(scratch, "parity-drift"));
    const first = selections[0]!;
    await writeFile(join(paths.footprintMasterRoot, `${first.footprintName}.kicad_mod`), "\n", { flag: "a" });

    await rejectsWith(
      generateFootprintPreviews({
        selections,
        footprintMasterRoot: paths.footprintMasterRoot,
        footprintLibraryRoot: paths.footprintLibraryRoot,
        previewRoot: paths.footprintPreviewRoot,
        renderer: FIXTURE_RENDERER,
        runDocker: fakeDockerRunner(FIXTURE_RENDERER.version),
      }),
      "ADAPTER_CONTRACT",
      /bytes differ/u,
    );
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
