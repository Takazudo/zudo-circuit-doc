/**
 * The provider driven through injected project paths, against scratch
 * projects on disk: the I/O half (`readEvidenceIndex`, the reference contract,
 * canaries, model publication, the validator runner) and the adapter factory
 * that closes over it.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { ComponentDocsError, type ErrorCode } from "../../src/core/errors.ts";
import { runPipeline } from "../../src/core/pipeline.ts";
import { PublicationPolicy } from "../../src/core/publication.ts";
import { indexEvidence } from "../../src/provider/v1/evidence.ts";
import {
  CIRCUIT_ADAPTER_ID,
  CIRCUIT_CONTRACT_VERSION,
  CIRCUIT_PUBLICATION_MATRIX,
  CIRCUIT_PUBLICATION_MATRIX_PRESET,
  createCircuitAdapter,
  projectIndex,
  readEvidenceIndex,
} from "../../src/provider/v1/index.ts";
import { CIRCUIT_PUBLICATION_MATRIX_PRESETS } from "../../src/provider/v1/matrix.ts";
import { readCanaries } from "../../src/provider/v1/canaries.ts";
import { buildModelAssetPlan, publishModelAssets } from "../../src/provider/v1/model-assets.ts";
import { CIRCUIT_PROJECT_PATH_KEYS, projectPaths, type CircuitProjectPaths } from "../../src/provider/v1/paths.ts";
import { createPythonValidator } from "../../src/provider/v1/validate.ts";
import {
  ALL_CANARY_STRINGS,
  FIXTURE_LAYOUT,
  FIXTURE_MODEL_PREFIX,
  FIXTURE_PACKAGE_COUNT,
  FIXTURE_SELECTION,
  fixtureInventory,
  onDiskFixtureBundle,
  writeFixtureProject,
} from "../fixtures/provider-fixtures.ts";

const REFERENCE = { modelLocatorPrefix: FIXTURE_MODEL_PREFIX };

let scratch = "";
let paths: CircuitProjectPaths;

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "component-docs-adapter-"));
  paths = await writeFixtureProject(join(scratch, "project"));
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("projectPaths", () => {
  it("resolves every key against the root", () => {
    const resolved = projectPaths("/p", FIXTURE_LAYOUT);
    assert.deepEqual(Object.keys(resolved).sort(), [...CIRCUIT_PROJECT_PATH_KEYS].sort());
    assert.equal(resolved.projectRoot, "/p");
    assert.equal(resolved.inventoryFile, "/p/.claude/skills/component-spec-audit/references/inventory.json");
  });

  it("refuses a relative root", () => {
    throwsWith(() => projectPaths("relative", FIXTURE_LAYOUT), "PATH_CONTAINMENT");
  });

  it("refuses a layout with a missing key", () => {
    const { modelRoot: _dropped, ...partial } = FIXTURE_LAYOUT;
    throwsWith(
      () => projectPaths("/p", partial as typeof FIXTURE_LAYOUT),
      "ADAPTER_CONTRACT",
    );
  });
});

describe("readEvidenceIndex", () => {
  it("reads the inventory, bundles, rules and reference contract from the given paths", async () => {
    const index = await readEvidenceIndex({ paths, selection: FIXTURE_SELECTION, reference: REFERENCE });
    assert.deepEqual(
      index.records.map((entry) => entry.record.record_id),
      ["rec-driver", "rec-sense", "rec-handfit"],
    );
    assert.equal(index.integrationRules.length, 3);
    const packages = index.references?.packages ?? [];
    assert.deepEqual(packages.map((entry) => entry.packageId), ["MSOP-8", "R-2512", "HDR-1x5"]);
    // Asset paths are project-relative, never absolute.
    assert.equal(packages[0]?.footprintPath, "footprints/kicad/fixture.pretty/MSOP-8.kicad_mod");
    assert.equal(packages[0]?.modelPath, "footprints/kicad/fixture.3dshapes/MSOP-8.wrl");
    assert.deepEqual(packages[0]?.rotation, { x: 0, y: 0, z: 90 });
  });

  it("projects the same view model as the pure path over the same evidence", async () => {
    const index = await readEvidenceIndex({ paths, selection: FIXTURE_SELECTION, reference: REFERENCE });
    const fromDisk = projectIndex(index, policy());
    const pure = projectIndex(
      {
        ...indexEvidence(
          fixtureInventory(),
          [onDiskFixtureBundle()],
          index.integrationRules,
        ),
        references: index.references,
      },
      policy(),
    );
    assert.equal(JSON.stringify(fromDisk), JSON.stringify(pure));
  });

  it("enforces the project-reviewed package lock (ADR-012), not an upstream literal", async () => {
    const staleLock: typeof FIXTURE_SELECTION = {
      ...FIXTURE_SELECTION,
      expect: { ...FIXTURE_SELECTION.expect, packages: FIXTURE_PACKAGE_COUNT + 1 },
    };
    await rejectsWith(
      readEvidenceIndex({ paths, selection: staleLock, reference: REFERENCE }),
      "ADAPTER_CONTRACT",
      /exactly 4 packages/u,
    );
  });

  it("keeps the upstream model locator prefix as the default", async () => {
    await rejectsWith(
      readEvidenceIndex({ paths, selection: FIXTURE_SELECTION, reference: {} }),
      "PATH_CONTAINMENT",
      /not a safe local WRL/u,
    );
  });

  it("labels a malformed inventory by its path under the bundles root", async () => {
    const broken = await writeFixtureProject(join(scratch, "broken-inventory"), {
      inventory: { schema_version: 1, assertions: {} },
    });
    await assert.rejects(
      readEvidenceIndex({ paths: broken, selection: FIXTURE_SELECTION, reference: REFERENCE }),
      (error: unknown) => {
        assert.ok(error instanceof ComponentDocsError);
        assert.equal(error.code, "ADAPTER_CONTRACT");
        assert.ok(
          JSON.stringify(error.detail).includes("component-spec-audit/references/inventory.json"),
          JSON.stringify(error.detail),
        );
        return true;
      },
    );
  });

  it("labels malformed integration rules by their path under the bundles root", async () => {
    const broken = await writeFixtureProject(join(scratch, "broken-rules"), {
      rules: { schema_version: 1 },
    });
    await assert.rejects(
      readEvidenceIndex({ paths: broken, selection: FIXTURE_SELECTION, reference: REFERENCE }),
      (error: unknown) => {
        assert.ok(error instanceof ComponentDocsError);
        assert.equal(error.code, "ADAPTER_CONTRACT");
        assert.ok(
          JSON.stringify(error.detail).includes("circuit-spec-integration/references/rules.json"),
          JSON.stringify(error.detail),
        );
        return true;
      },
    );
  });

  it("refuses an inventory outside the bundles root", async () => {
    await rejectsWith(
      readEvidenceIndex({
        paths: { ...paths, inventoryFile: join(paths.projectRoot, "inventory.json") },
        selection: FIXTURE_SELECTION,
        reference: REFERENCE,
      }),
      "PATH_CONTAINMENT",
      /escapes the skills root/u,
    );
  });
});

describe("createCircuitAdapter", () => {
  it("keeps the v1 identity and defaults to the package matrix preset", () => {
    const adapter = createCircuitAdapter({
      paths,
      selection: FIXTURE_SELECTION,
      validator: passingValidator(),
    });
    assert.equal(adapter.id, CIRCUIT_ADAPTER_ID);
    assert.equal(adapter.id, "circuit-component-spec");
    assert.equal(adapter.contractVersion, CIRCUIT_CONTRACT_VERSION);
    assert.equal(adapter.contractVersion, 1);
    assert.equal(adapter.matrix, CIRCUIT_PUBLICATION_MATRIX);
    assert.equal(adapter.selection, FIXTURE_SELECTION);
    assert.equal(CIRCUIT_PUBLICATION_MATRIX_PRESET, "component-evidence-v1");
    assert.equal(CIRCUIT_PUBLICATION_MATRIX_PRESETS["component-evidence-v1"], CIRCUIT_PUBLICATION_MATRIX);
  });

  it("threads the integration owner skill into the projection", async () => {
    const index = await readEvidenceIndex({ paths, selection: FIXTURE_SELECTION, reference: REFERENCE });
    const defaulted = JSON.stringify(projectIndex(index, policy()).integration);
    const custom = JSON.stringify(
      projectIndex(index, policy(), { integrationOwnerSkill: "project-integration" }).integration,
    );
    assert.ok(defaulted.includes('"circuit-spec-integration"'));
    assert.ok(custom.includes('"project-integration"'));
    assert.equal(custom.includes("circuit-spec-integration"), false);
  });

  it("generates pages from a scratch project", async () => {
    const generatedRoot = join(scratch, "generated");
    const result = await runPipeline(
      createCircuitAdapter({
        paths,
        selection: FIXTURE_SELECTION,
        validator: passingValidator(),
        reference: REFERENCE,
      }),
      { generatedRoot, dryRun: false },
    );
    assert.ok(result.pages.length > 0);
    const serialized = JSON.stringify(result.report);
    for (const canary of ALL_CANARY_STRINGS) {
      assert.equal(serialized.includes(canary), false, `${canary} leaked into the report`);
    }
  });

  // The generic half of upstream adversarial.test.ts "invalid input fails
  // before the generated tree is replaced"; the real-corpus half is LED-bound.
  it("leaves the previous output byte-identical when validation fails", async () => {
    const generatedRoot = join(scratch, "atomic");
    const options = { paths, selection: FIXTURE_SELECTION, reference: REFERENCE };
    await runPipeline(createCircuitAdapter({ ...options, validator: passingValidator() }), {
      generatedRoot,
      dryRun: false,
    });

    const before = new Map<string, string>();
    for (const name of await readdir(generatedRoot)) {
      const path = join(generatedRoot, name);
      if (name.endsWith(".mdx")) before.set(name, await readFile(path, "utf8"));
    }
    assert.ok(before.size > 0, "the first run produced nothing to protect");

    const failing = join(scratch, "reject.py");
    await writeFile(failing, 'import sys\nsys.stderr.write("FAIL: seeded\\n")\nsys.exit(4)\n');

    await assert.rejects(
      runPipeline(
        createCircuitAdapter({
          ...options,
          validator: createPythonValidator({ scriptPath: failing, cwd: scratch, minVersion: ANY_PYTHON }),
        }),
        { generatedRoot, dryRun: false },
      ),
      (error: unknown) =>
        error instanceof ComponentDocsError && error.code === "VALIDATION_FAILED",
    );

    for (const [name, contents] of before) {
      assert.equal(
        await readFile(join(generatedRoot, name), "utf8"),
        contents,
        `${name} changed during a failed run`,
      );
    }
  });
});

describe("createPythonValidator", () => {
  it("passes args after the script, in the given cwd and env", async () => {
    const script = join(scratch, "echo.py");
    await writeFile(
      script,
      'import os, sys\nprint(" ".join(sys.argv[1:]))\nprint(os.getcwd())\nprint(os.environ.get("CIRCUIT_TEST_MARK", ""))\n',
    );
    const outcome = await createPythonValidator({
      scriptPath: script,
      cwd: paths.projectRoot,
      args: ["--config", "-"],
      env: { ...process.env, CIRCUIT_TEST_MARK: "marked" },
      minVersion: ANY_PYTHON,
    })();
    assert.equal(outcome.ok, true, outcome.stderr);
    assert.deepEqual(outcome.command.slice(1), [script, "--config", "-"]);
    const [argv, cwd, mark] = outcome.stdout.trim().split("\n");
    assert.equal(argv, "--config -");
    assert.equal(cwd, paths.projectRoot);
    assert.equal(mark, "marked");
  });

  it("refuses an interpreter older than minVersion", async () => {
    const outcome = await createPythonValidator({
      scriptPath: join(scratch, "never-run.py"),
      cwd: scratch,
      minVersion: { major: 99, minor: 0 },
    })();
    assert.equal(outcome.ok, false);
    assert.match(outcome.stderr, />= 99\.0/u);
  });
});

describe("readCanaries", () => {
  it("harvests denied values from the project's bundles root", async () => {
    const canaries = await readCanaries(paths);
    const values = new Set(canaries.map((canary) => canary.value));
    assert.ok(values.size > 0);
    for (const value of values) {
      assert.ok(
        ALL_CANARY_STRINGS.some((canary) => canary.includes(value) || value.includes(canary)),
        `${value} is not a fixture canary`,
      );
    }
  });
});

describe("model publication", () => {
  it("plans and publishes the selected WRLs into modelPublicRoot", async () => {
    const options = {
      paths,
      selection: FIXTURE_SELECTION,
      reference: REFERENCE,
      policy: policy(),
      validation: PASSING_VALIDATION,
    };
    const plan = await buildModelAssetPlan(options);
    assert.deepEqual(plan.map((entry) => entry.name), ["HDR-1x5.wrl", "MSOP-8.wrl", "R-2512.wrl"]);

    const dry = await publishModelAssets(options, true);
    assert.equal(dry.drift.length, FIXTURE_PACKAGE_COUNT);

    const written = await publishModelAssets(options, false);
    assert.deepEqual(written.written, ["HDR-1x5.wrl", "MSOP-8.wrl", "R-2512.wrl"]);
    assert.deepEqual(
      (await readdir(paths.modelPublicRoot)).sort(),
      ["HDR-1x5.wrl", "MSOP-8.wrl", "R-2512.wrl"],
    );
    assert.deepEqual((await publishModelAssets(options, true)).drift, []);
  });

  it("keeps the project-reviewed package lock, not an upstream literal", async () => {
    const staleLock: typeof FIXTURE_SELECTION = {
      ...FIXTURE_SELECTION,
      expect: { ...FIXTURE_SELECTION.expect, packages: FIXTURE_PACKAGE_COUNT + 1 },
    };
    await rejectsWith(
      buildModelAssetPlan({
        paths,
        selection: staleLock,
        reference: REFERENCE,
        policy: policy(staleLock),
        validation: PASSING_VALIDATION,
      }),
      "ADAPTER_CONTRACT",
      /exactly 4/u,
    );
  });

  it("refuses to publish when the canonical validator did not pass", async () => {
    await rejectsWith(
      buildModelAssetPlan({
        paths,
        selection: FIXTURE_SELECTION,
        reference: REFERENCE,
        policy: policy(),
        validation: { ok: false, command: ["stub"], exitCode: 1, stdout: "", stderr: "FAIL" },
      }),
      "VALIDATION_FAILED",
      /passing canonical validator/u,
    );
  });
});

// --- helpers ---------------------------------------------------------------

const ANY_PYTHON = { major: 3, minor: 0 } as const;

const PASSING_VALIDATION = { ok: true, command: ["stub"], exitCode: 0, stdout: "", stderr: "" } as const;

function policy(selection: typeof FIXTURE_SELECTION = FIXTURE_SELECTION): PublicationPolicy {
  return new PublicationPolicy(CIRCUIT_PUBLICATION_MATRIX, selection);
}

function passingValidator() {
  return async () => ({ ok: true, command: ["stub"], exitCode: 0, stdout: "", stderr: "" });
}

function throwsWith(run: () => unknown, code: ErrorCode): void {
  assert.throws(run, (error: unknown) => error instanceof ComponentDocsError && error.code === code);
}

async function rejectsWith(run: Promise<unknown>, code: ErrorCode, message: RegExp): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof ComponentDocsError, String(error));
    assert.equal(error.code, code, error.message);
    assert.match(error.message, message);
    return true;
  });
}
