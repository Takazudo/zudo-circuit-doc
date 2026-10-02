import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, test } from "node:test";

import { DEFAULT_REFERENCE_LIMITS } from "../../src/config/define.ts";
import { ConfigError } from "../../src/config/errors.ts";
import { resolveCircuitConfig } from "../../src/config/resolve.ts";
import { DEFAULT_PROJECT_CONFIG, LED_STYLE_CONFIG, mutable } from "./fixtures.ts";

const DIR = "/work/project";

describe("resolveCircuitConfig", () => {
  test("the generated-project default resolves against the config directory", () => {
    const resolved = resolveCircuitConfig(DEFAULT_PROJECT_CONFIG, DIR);
    assert.equal(resolved.configDir, DIR);
    assert.equal(resolved.root, DIR);
    assert.equal(resolved.docs.root, join(DIR, "doc"));
    assert.equal(resolved.docs.generatedContent, join(DIR, "doc/src/content/docs/components"));
    assert.equal(resolved.docs.preflight, join(DIR, "circuit/generated/preflight.json"));
    assert.equal(resolved.docs.agentResources, true);
    assert.equal(resolved.docs.generatedMarker, null);
    assert.equal(resolved.docs.generatedNotice, null);
    assert.equal(resolved.docs.integrationGloss, null);
    assert.equal(resolved.evidence.bundlesRoot, join(DIR, ".claude/skills"));
    assert.equal(resolved.evidence.ownerPrefix, "component-");
    assert.equal(resolved.evidence.forwardTests, null);
    assert.equal(resolved.evidence.sourceCache, join(DIR, ".circuit-cache/sources"));
    assert.deepEqual(resolved.inventoryProvider, { kind: "manual" });
    assert.equal(resolved.publication.selection, join(DIR, "circuit/publication/selection.json"));
    assert.equal(resolved.publication.matrix, null);
    assert.deepEqual(resolved.cad, { enabled: false, libraryName: "my-circuit" });
    assert.deepEqual(resolved.validation, { pythonMinVersion: "3.10", policy: null, userAgent: null });
    assert.equal(resolved.scan, null);
    assert.equal(resolved.browserSmoke, null);
  });

  test("LED-style: data root from root, other paths still relative to the config file", () => {
    const resolved = resolveCircuitConfig(LED_STYLE_CONFIG, DIR);
    assert.equal(resolved.root, join(DIR, "upstream"));
    assert.equal(resolved.publication.selection, join(DIR, "selection.json"));
    assert.equal(resolved.docs.integrationGloss, join(DIR, "integration-gloss.json"));
    assert.equal(resolved.evidence.inventory, join(DIR, "upstream/.claude/skills/component-spec-audit/references/inventory.json"));
    assert.deepEqual(resolved.inventoryProvider, {
      kind: "led-generator-v1",
      specs: [
        { path: join(DIR, "upstream/scripts/schgen/board_p_spec.py") },
        { path: join(DIR, "upstream/scripts/schgen/board_l_spec.py") },
      ],
    });
    assert.ok(resolved.cad.enabled);
    assert.deepEqual(resolved.cad.symbolLibraries, [join(DIR, "upstream/symbols/zudo-led-lamp.kicad_sym")]);
    assert.equal(resolved.cad.modelLocatorPrefix, "${KIPRJMOD}/../../footprints/kicad/zudo-led-lamp.3dshapes/");
    assert.equal(resolved.cad.footprintPathBase, join(DIR, "upstream"), "footprintPathBase defaults to root");
    assert.deepEqual(resolved.cad.limits, DEFAULT_REFERENCE_LIMITS);
    assert.equal(resolved.validation.policy, join(DIR, "policy.json"));
    assert.equal(resolved.browserSmoke?.representatives.length, 1);
  });

  test("resolves optional LED generator options and only configured board names", () => {
    const config = mutable(LED_STYLE_CONFIG);
    config.inventoryProvider = {
      kind: "led-generator-v1",
      specs: [
        { path: "upstream/scripts/schgen/board_p_spec.py", board: "power" },
        { path: "upstream/scripts/schgen/board_l_spec.py" },
      ],
      fit: "placement",
      mpnFromValueLcsc: ["C144397"],
    };
    const resolved = resolveCircuitConfig(config as typeof LED_STYLE_CONFIG, DIR);
    assert.deepEqual(resolved.inventoryProvider, {
      kind: "led-generator-v1",
      specs: [
        { path: join(DIR, "upstream/scripts/schgen/board_p_spec.py"), board: "power" },
        { path: join(DIR, "upstream/scripts/schgen/board_l_spec.py") },
      ],
      fit: "placement",
      mpnFromValueLcsc: ["C144397"],
    });
  });

  test("an explicit footprintPathBase and partial limits override the defaults", () => {
    const config = mutable(LED_STYLE_CONFIG);
    config.cad.footprintPathBase = ".";
    config.cad.limits = { modelBytes: 4096 };
    const resolved = resolveCircuitConfig(config as typeof LED_STYLE_CONFIG, DIR);
    assert.ok(resolved.cad.enabled);
    assert.equal(resolved.cad.footprintPathBase, DIR);
    assert.deepEqual(resolved.cad.limits, { ...DEFAULT_REFERENCE_LIMITS, modelBytes: 4096 });
  });

  test("an explicit docs.generatedNotice resolves through as a boolean, not the null default", () => {
    const config = mutable(DEFAULT_PROJECT_CONFIG);
    config.docs.generatedNotice = false;
    assert.equal(resolveCircuitConfig(config as typeof DEFAULT_PROJECT_CONFIG, DIR).docs.generatedNotice, false);
    config.docs.generatedNotice = true;
    assert.equal(resolveCircuitConfig(config as typeof DEFAULT_PROJECT_CONFIG, DIR).docs.generatedNotice, true);
  });

  test("a relative configDir is made absolute", () => {
    const resolved = resolveCircuitConfig(DEFAULT_PROJECT_CONFIG, "rel/dir");
    assert.equal(resolved.configDir, join(process.cwd(), "rel/dir"));
  });

  test("an escaping path that skipped validation still throws", () => {
    const config = mutable(DEFAULT_PROJECT_CONFIG);
    config.docs.dist = "../dist";
    assert.throws(
      () => resolveCircuitConfig(config as typeof DEFAULT_PROJECT_CONFIG, DIR),
      (error: unknown) => error instanceof ConfigError && error.errors[0]?.path === "docs.dist",
    );
  });

  test("no existence checks: resolving never touches the filesystem", () => {
    assert.doesNotThrow(() => resolveCircuitConfig(LED_STYLE_CONFIG, "/definitely/not/a/real/dir"));
  });
});
