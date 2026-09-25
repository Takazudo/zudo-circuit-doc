/** `config/map.ts`: resolved config -> paths, selection, matrix, validator input, render and reference options. */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import type { CircuitConfig } from "../../src/config/define.ts";
import { configRelative, declaredProjectFiles, mapCircuitConfig } from "../../src/config/map.ts";
import { resolveCircuitConfig } from "../../src/config/resolve.ts";
import { ComponentDocsError } from "../../src/core/errors.ts";
import { LEGACY_MARKERS } from "../../src/core/page.ts";
import { CIRCUIT_PUBLICATION_MATRIX } from "../../src/provider/v1/matrix.ts";
import { DEFAULT_PROJECT_CONFIG, LED_STYLE_CONFIG, mutable } from "../config/fixtures.ts";
import { EMPTY_SELECTION, SELECTION, writeEmptyProject, writeJson } from "./project-fixture.ts";

let scratch = "";
let counter = 0;

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "zcd-map-"));
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function fixture(edit: (config: Record<string, any>) => void = () => {}) {
  counter += 1;
  const root = await writeEmptyProject(join(scratch, `m${counter}`));
  const config = mutable(DEFAULT_PROJECT_CONFIG);
  config.docs.generatedContent = "doc/src/content/docs/components";
  edit(config);
  return { root, resolved: resolveCircuitConfig(config as CircuitConfig, root) };
}

async function rejectsAdapter(promise: Promise<unknown>, pattern: RegExp): Promise<ComponentDocsError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ComponentDocsError, String(error));
    assert.equal(error.code, "ADAPTER_CONTRACT");
    assert.match(`${error.message}\n${JSON.stringify(error.detail)}`, pattern);
    return error;
  }
  assert.fail("expected ADAPTER_CONTRACT");
}

describe("mapCircuitConfig", () => {
  it("maps the default project onto provider paths, validator input and defaults", async () => {
    const { root, resolved } = await fixture();
    const mapping = await mapCircuitConfig(resolved);

    assert.equal(mapping.paths.projectRoot, root);
    assert.equal(mapping.paths.modelPublicRoot, join(root, "doc/public/assets/component-previews/models"));
    assert.equal(mapping.paths.footprintPreviewRoot, join(root, "doc/public/assets/component-previews/footprints"));
    assert.equal(mapping.matrix, CIRCUIT_PUBLICATION_MATRIX);
    assert.equal(mapping.matrixSource, "preset:component-evidence-v1");
    assert.deepEqual(mapping.selection, {
      recordIds: [],
      sourceIds: [],
      linkableSourceIds: [],
      documentSelections: [],
      expect: { records: 0, sources: 0, integrationRules: 0, packages: 0 },
    });
    assert.deepEqual(mapping.assets, { schema_version: 1, assets: [] });
    assert.deepEqual(mapping.render, { agentResources: true, integrationDomainGloss: {}, generatedNotice: true });
    assert.deepEqual(mapping.reference, { enabled: false });
    assert.deepEqual(mapping.pythonMinVersion, { major: 3, minor: 10 });
    assert.equal(mapping.integrationOwnerSkill, "circuit-spec-integration");

    const input = mapping.validatorInput;
    assert.equal(input.projectRoot, root);
    assert.deepEqual(input.bundles.reservedDirs, ["component-spec-audit"]);
    assert.equal(input.bundles.auditSkillDir, join(root, ".claude/skills/component-spec-audit"));
    assert.equal(input.integration.integrationSkillDir, join(root, ".claude/skills/circuit-spec-integration"));
    assert.deepEqual(input.inventory.provider, { kind: "manual" });
    assert.deepEqual(input.cad, { enabled: false });
    assert.deepEqual(input.online, { tempRoot: join(root, ".circuit-cache/sources") });
  });

  it("a legacy marker keeps the pre-extraction output (no generated notice)", async () => {
    const { resolved } = await fixture((config) => {
      config.docs.generatedMarker = LEGACY_MARKERS[0];
      config.docs.agentResources = false;
    });
    const { render } = await mapCircuitConfig(resolved);
    assert.equal(render.generatedMarker, LEGACY_MARKERS[0]);
    assert.equal(render.generatedNotice, false);
    assert.equal(render.agentResources, false);
  });

  it("reads the integration gloss and a full matrix override", async () => {
    const { root, resolved } = await fixture((config) => {
      config.docs.integrationGloss = "gloss.json";
      config.publication.matrix = "matrix.json";
    });
    await writeJson(join(root, "gloss.json"), { "rail-envelope": "What the rail must stay within." });
    await writeJson(join(root, "matrix.json"), { ...CIRCUIT_PUBLICATION_MATRIX, "record.lcsc": "DENY" });
    const mapping = await mapCircuitConfig(resolved);
    assert.deepEqual(mapping.render.integrationDomainGloss, { "rail-envelope": "What the rail must stay within." });
    assert.equal(mapping.matrix["record.lcsc"], "DENY");
    assert.equal(mapping.matrixSource, "matrix.json");
  });

  it("accepts the preset name as publication.matrix", async () => {
    const { resolved } = await fixture((config) => {
      config.publication.matrix = "component-evidence-v1";
    });
    assert.equal((await mapCircuitConfig(resolved)).matrixSource, "preset:component-evidence-v1");
  });

  it("an incomplete matrix override lists every undecided key", async () => {
    const { root, resolved } = await fixture((config) => {
      config.publication.matrix = "matrix.json";
    });
    const { ["record.lcsc"]: _dropped, ...partial } = CIRCUIT_PUBLICATION_MATRIX;
    await writeJson(join(root, "matrix.json"), { ...partial, "record.bogus": "PUBLISH" });
    await rejectsAdapter(mapCircuitConfig(resolved), /record\.lcsc: must be .*record\.bogus: unknown field key/su);
  });

  it("absent is not empty: every missing declared file is reported with its config-relative path", async () => {
    const { root, resolved } = await fixture((config) => {
      config.docs.integrationGloss = "gloss.json";
    });
    await rm(join(root, SELECTION));
    await rm(join(root, ".claude/skills/circuit-spec-integration/references/rules.json"));
    const error = await rejectsAdapter(mapCircuitConfig(resolved), /missing/u);
    assert.deepEqual(error.detail.missing, [
      "evidence.integrationRules: .claude/skills/circuit-spec-integration/references/rules.json (file)",
      "publication.selection: circuit/publication/selection.json (file)",
      "docs.integrationGloss: gloss.json (file)",
    ]);
  });

  it("an explicitly empty selection with a non-zero package lock is still a valid shape", async () => {
    const { root, resolved } = await fixture();
    await writeJson(join(root, SELECTION), { ...EMPTY_SELECTION, expect: { ...EMPTY_SELECTION.expect, packages: 2 } });
    assert.equal((await mapCircuitConfig(resolved)).selection.expect.packages, 2);
  });

  it("rejects malformed selection, assets and non-JSON files", async () => {
    const { root, resolved } = await fixture();
    await writeJson(join(root, SELECTION), {
      ...EMPTY_SELECTION,
      recordIds: ["a", "a"],
      documentSelections: [{ recordId: "a", sourceId: "s", documentKind: "brochure" }],
      extra: 1,
    });
    await rejectsAdapter(
      mapCircuitConfig(resolved),
      /extra: unknown key.*recordIds: must not contain duplicates.*documentKind: must be one of/su,
    );

    await writeJson(join(root, SELECTION), EMPTY_SELECTION);
    await writeJson(join(root, "circuit/publication/assets.json"), {
      schema_version: 1,
      assets: [{ path: "../escape.pdf" }],
    });
    await rejectsAdapter(mapCircuitConfig(resolved), /assets\[0\]\.reason: is required.*assets\[0\]\.path: must be/su);

    await writeFile(join(root, "circuit/publication/assets.json"), "{ not json");
    await rejectsAdapter(mapCircuitConfig(resolved), /not valid JSON.*circuit\/publication\/assets\.json/su);
  });

  it("maps an LED-style config: led-generator provider, CAD reference options, data root", () => {
    const resolved = resolveCircuitConfig(LED_STYLE_CONFIG, "/fixture");
    const files = declaredProjectFiles(resolved).map((entry) => `${entry.field}=${configRelative(resolved, entry.path)}`);
    assert.ok(files.includes("inventoryProvider.specs[1].path=upstream/scripts/schgen/board_l_spec.py"));
    assert.ok(files.includes("validation.policy=policy.json"));
    assert.ok(files.includes("cad.modelRoot=upstream/footprints/kicad/zudo-led-lamp.3dshapes"));
  });
});

describe("mapCircuitConfig: LED-style pieces", async () => {
  const { projectPathsFor, referenceOptionsFor, validatorInputFor } = await import("../../src/config/map.ts");
  const resolved = resolveCircuitConfig(LED_STYLE_CONFIG, "/fixture");

  it("projects the data root and the CAD roots", () => {
    const paths = projectPathsFor(resolved);
    assert.equal(paths.projectRoot, "/fixture/upstream");
    assert.equal(paths.modelRoot, "/fixture/upstream/footprints/kicad/zudo-led-lamp.3dshapes");
    assert.equal(paths.modelPublicRoot, "/fixture/upstream/doc/public/assets/component-previews/models");
  });

  it("threads the model locator, path base and limits into the reference options", () => {
    assert.deepEqual(referenceOptionsFor(resolved), {
      enabled: true,
      modelLocatorPrefix: "${KIPRJMOD}/../../footprints/kicad/zudo-led-lamp.3dshapes/",
      footprintPathBase: "/fixture/upstream",
      limits: { footprintBytes: 512 * 1024, modelBytes: 2 * 1024 * 1024, aggregateModelBytes: 8 * 1024 * 1024 },
    });
  });

  it("builds the validator input the LED regression uses", () => {
    const input = validatorInputFor(resolved);
    assert.deepEqual(input.inventory.provider, {
      kind: "led-generator-v1",
      specs: [
        { path: "/fixture/upstream/scripts/schgen/board_p_spec.py" },
        { path: "/fixture/upstream/scripts/schgen/board_l_spec.py" },
      ],
    });
    assert.deepEqual(input.cad, {
      enabled: true,
      symbolLibraries: ["/fixture/upstream/symbols/zudo-led-lamp.kicad_sym"],
      footprintDirs: ["/fixture/upstream/footprints/kicad"],
    });
    assert.equal(input.policy.path, "/fixture/policy.json");
    assert.equal(input.integration.forwardTests, null);
  });
});
