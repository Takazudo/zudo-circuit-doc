/**
 * Model publication (issue #15): the plan is built only from a validated,
 * freshness-checked index — never from whatever happens to be on disk — and
 * the output-root symlink walk starts at the project root, not at the
 * filesystem root, so an ancestor symlink above the project never blocks a
 * publish that never reads or writes through it.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { ComponentDocsError, type ErrorCode } from "../../src/core/errors.ts";
import { PublicationPolicy } from "../../src/core/publication.ts";
import { CIRCUIT_PUBLICATION_MATRIX } from "../../src/provider/v1/matrix.ts";
import {
  buildModelAssetPlan,
  publishModelAssets,
  syncModelAssets,
  type ModelAssetPlanOptions,
} from "../../src/provider/v1/model-assets.ts";
import type { CircuitProjectPaths } from "../../src/provider/v1/paths.ts";
import {
  FIXTURE_MODEL_PREFIX,
  FIXTURE_PACKAGE_COUNT,
  FIXTURE_SELECTION,
  writeFixtureProject,
} from "../fixtures/provider-fixtures.ts";

const REFERENCE = { modelLocatorPrefix: FIXTURE_MODEL_PREFIX };
const PASSING_VALIDATION = { ok: true, command: ["stub"], exitCode: 0, stdout: "", stderr: "" } as const;

let scratch = "";

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "circuit-doc-model-assets-"));
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function options(paths: CircuitProjectPaths, selection = FIXTURE_SELECTION): ModelAssetPlanOptions {
  return {
    paths,
    selection,
    reference: REFERENCE,
    policy: new PublicationPolicy(CIRCUIT_PUBLICATION_MATRIX, selection),
    validation: PASSING_VALIDATION,
  };
}

describe("buildModelAssetPlan / publishModelAssets", () => {
  it("omits truly absent models from export while keeping the package count lock", async () => {
    const paths = await writeFixtureProject(join(scratch, "optional-model"));
    const names = (await readdir(paths.footprintLibraryRoot)).filter(name => name.endsWith('.kicad_mod'));
    for (const name of names) await writeFile(join(paths.footprintLibraryRoot, name), `(footprint "${name.slice(0, -10)}")`);
    assert.equal(names.length, FIXTURE_PACKAGE_COUNT);
    assert.deepEqual(await buildModelAssetPlan(options(paths)), []);
  });
  it("refuses to plan anything when the canonical validator did not pass", async () => {
    const paths = await writeFixtureProject(join(scratch, "unvalidated"));
    await rejectsWith(
      buildModelAssetPlan({
        ...options(paths),
        validation: { ok: false, command: ["circuit_validate.py"], exitCode: 4, stdout: "", stderr: "FAIL" },
      }),
      "VALIDATION_FAILED",
      /passing canonical validator/u,
    );
  });

  it("asserts the selection is fresh before planning anything", async () => {
    const paths = await writeFixtureProject(join(scratch, "stale-selection"));
    const stale = {
      ...FIXTURE_SELECTION,
      expect: { ...FIXTURE_SELECTION.expect, records: FIXTURE_SELECTION.expect.records + 1 },
    };
    await rejectsWith(
      buildModelAssetPlan(options(paths, stale)),
      "STALE_SELECTION",
      /provider record count does not match/u,
    );
  });

  it("plans and publishes exactly the selected WRLs", async () => {
    const paths = await writeFixtureProject(join(scratch, "happy-path"));
    const opts = options(paths);
    const plan = await buildModelAssetPlan(opts);
    assert.deepEqual(plan.map((entry) => entry.name), ["HDR-1x5.wrl", "MSOP-8.wrl", "R-2512.wrl"]);

    const written = await publishModelAssets(opts, false);
    assert.deepEqual(written.written, ["HDR-1x5.wrl", "MSOP-8.wrl", "R-2512.wrl"]);
    assert.deepEqual((await publishModelAssets(opts, true)).drift, []);
  });

  it("CAD-05: 0 selected packages publishes an empty plan with no models directory needed", async () => {
    const paths = await writeFixtureProject(join(scratch, "zero-state"), {
      bundles: [],
      inventory: { schema_version: 1, assertions: { orderable_lines: 0, fitted_lines: 0, dnp_or_hand_fit_lines: 0 }, lines: [] },
      rules: { schema_version: 1, rules: [] },
    });
    const zeroSelection = {
      recordIds: [],
      sourceIds: [],
      linkableSourceIds: [],
      documentSelections: [],
      expect: { records: 0, sources: 0, integrationRules: 0, packages: 0 },
    };
    const opts = options(paths, zeroSelection);

    const plan = await buildModelAssetPlan(opts);
    assert.deepEqual(plan, []);

    const dry = await publishModelAssets(opts, true);
    assert.deepEqual(dry, { expected: 0, written: [], unchanged: [], removed: [], drift: [] });

    const real = await publishModelAssets(opts, false);
    assert.deepEqual(real, { expected: 0, written: [], unchanged: [], removed: [], drift: [] });
  });

  it("PUB-03-adjacent: an extra file in an existing models dir still fails even at zero expected packages", async () => {
    const paths = await writeFixtureProject(join(scratch, "extra-file"), {
      bundles: [],
      inventory: { schema_version: 1, assertions: { orderable_lines: 0, fitted_lines: 0, dnp_or_hand_fit_lines: 0 }, lines: [] },
      rules: { schema_version: 1, rules: [] },
    });
    await mkdir(paths.modelPublicRoot, { recursive: true });
    await writeFile(join(paths.modelPublicRoot, "stale.wrl"), "stale");
    const zeroSelection = {
      recordIds: [],
      sourceIds: [],
      linkableSourceIds: [],
      documentSelections: [],
      expect: { records: 0, sources: 0, integrationRules: 0, packages: 0 },
    };
    const opts = options(paths, zeroSelection);

    assert.deepEqual((await publishModelAssets(opts, true)).drift, ["extra: stale.wrl"]);
    await rejectsWith(publishModelAssets(opts, false), "GENERATED_DRIFT", /extra file/u);
  });

  it("keeps the project-reviewed package lock, not an upstream literal", async () => {
    const paths = await writeFixtureProject(join(scratch, "lock-mismatch"));
    const staleLock = {
      ...FIXTURE_SELECTION,
      expect: { ...FIXTURE_SELECTION.expect, packages: FIXTURE_PACKAGE_COUNT + 1 },
    };
    await rejectsWith(
      buildModelAssetPlan(options(paths, staleLock)),
      "ADAPTER_CONTRACT",
      /exactly 4/u,
    );
  });

  it("an ancestor symlink above the project root does not block publication", async () => {
    const real = join(scratch, "ancestor-real");
    await mkdir(real, { recursive: true });
    const linked = join(scratch, "ancestor-link");
    await symlink(real, linked, "dir");
    const paths = await writeFixtureProject(join(linked, "project"));

    const opts = options(paths);
    const written = await publishModelAssets(opts, false);
    assert.deepEqual(written.written, ["HDR-1x5.wrl", "MSOP-8.wrl", "R-2512.wrl"]);
    assert.deepEqual(
      (await readdir(paths.modelPublicRoot)).sort(),
      ["HDR-1x5.wrl", "MSOP-8.wrl", "R-2512.wrl"],
    );
  });

  it("still refuses a symlink placed between the project root and the output root", async () => {
    const projectRoot = join(scratch, "internal-symlink", "project");
    await mkdir(projectRoot, { recursive: true });
    const realOutput = join(scratch, "internal-symlink", "real-output");
    await mkdir(realOutput, { recursive: true });
    const linkedOutput = join(projectRoot, "linked-output");
    await symlink(realOutput, linkedOutput, "dir");

    await rejectsWith(
      syncModelAssets([], projectRoot, join(linkedOutput, "models"), true),
      "PATH_CONTAINMENT",
      /is a symlink/u,
    );
  });
});

// --- helpers -----------------------------------------------------------------

async function rejectsWith(run: Promise<unknown>, code: ErrorCode, message: RegExp): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof ComponentDocsError, String(error));
    assert.equal(error.code, code, error.message);
    assert.match(error.message, message);
    return true;
  });
}
