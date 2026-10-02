import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildResolvedValidatorConfig,
  DEFAULT_ONLINE_USER_AGENT,
  PACKAGED_TEMPLATE_NAME,
  packagedTemplateDir,
  type ValidatorInput,
} from "../../src/validate/resolved-config.ts";

// The exact per-section key sets `circuit_validate.py`'s `orchestrator.CONFIG_SECTIONS`
// requires (RESOLVED_CONFIG.md); a drift here breaks the transport silently.
const CONFIG_SECTIONS: Readonly<Record<string, readonly string[]>> = {
  bundles: ["root", "ownerPrefix", "reservedDirs", "auditSkillDir", "requireSkillMd"],
  inventory: ["path", "provider", "candidatesPath"],
  routing: ["directRouting", "vendorQualifiers"],
  template: ["dir", "name"],
  cad: ["enabled", "symbolLibraries", "footprintDirs", "requirePinEqualsPad"],
  integration: ["rulesPath", "forwardTests", "integrationSkillDir"],
  policy: ["path"],
  online: ["tempRoot", "userAgent", "skipVolatileInAll"],
  output: ["json"],
};

function minimalInput(overrides: Partial<ValidatorInput> = {}): ValidatorInput {
  return {
    projectRoot: "/abs/project",
    bundles: {
      root: "/abs/project/.claude/skills",
      ownerPrefix: "component-",
      reservedDirs: ["component-spec-audit"],
      auditSkillDir: "/abs/project/.claude/skills/component-spec-audit",
    },
    inventory: {
      path: "/abs/project/.claude/skills/component-spec-audit/references/inventory.json",
      provider: { kind: "manual" },
    },
    routing: { directRouting: null, vendorQualifiers: null },
    cad: { enabled: false },
    integration: {
      rulesPath: "/abs/project/.claude/skills/circuit-spec-integration/references/rules.json",
      forwardTests: null,
      integrationSkillDir: "/abs/project/.claude/skills/circuit-spec-integration",
    },
    policy: { path: null },
    online: {},
    ...overrides,
  };
}

describe("buildResolvedValidatorConfig", () => {
  it("shapes exactly the sections and keys circuit_validate.py requires", () => {
    const resolved = buildResolvedValidatorConfig(minimalInput());
    assert.equal(resolved.configVersion, 1);
    assert.equal(resolved.contractVersion, 1);
    assert.equal(typeof resolved.projectRoot, "string");
    for (const [section, keys] of Object.entries(CONFIG_SECTIONS)) {
      const value = (resolved as unknown as Record<string, object>)[section];
      assert.ok(value, `missing section ${section}`);
      assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `section ${section}`);
    }
  });

  it("resolves the packaged template dir and name, not a project path", () => {
    const resolved = buildResolvedValidatorConfig(minimalInput());
    assert.equal(resolved.template.dir, packagedTemplateDir());
    assert.equal(resolved.template.name, PACKAGED_TEMPLATE_NAME);
    assert.ok(existsSync(resolved.template.dir), "packaged template dir must exist on disk");
    assert.ok(existsSync(`${resolved.template.dir}/SKILL.md`));
  });

  it("defaults online.tempRoot under the project root, and userAgent/skipVolatileInAll", () => {
    const resolved = buildResolvedValidatorConfig(minimalInput());
    assert.equal(resolved.online.tempRoot, "/abs/project/.circuit-cache/sources");
    assert.equal(resolved.online.userAgent, DEFAULT_ONLINE_USER_AGENT);
    assert.equal(resolved.online.skipVolatileInAll, true);
  });

  it("honors an explicit online.tempRoot / userAgent instead of the default", () => {
    const resolved = buildResolvedValidatorConfig(
      minimalInput({
        online: { tempRoot: "/abs/other/cache", userAgent: "custom/1.0", skipVolatileInAll: false },
      }),
    );
    assert.equal(resolved.online.tempRoot, "/abs/other/cache");
    assert.equal(resolved.online.userAgent, "custom/1.0");
    assert.equal(resolved.online.skipVolatileInAll, false);
  });

  it("defaults bundles.requireSkillMd to true and output.json to false", () => {
    const resolved = buildResolvedValidatorConfig(minimalInput());
    assert.equal(resolved.bundles.requireSkillMd, true);
    assert.equal(resolved.output.json, false);
  });

  it("normalizes a disabled cad config to the full python shape", () => {
    const resolved = buildResolvedValidatorConfig(minimalInput({ cad: { enabled: false } }));
    assert.deepEqual(resolved.cad, {
      enabled: false,
      symbolLibraries: [],
      footprintDirs: [],
      requirePinEqualsPad: true,
    });
  });

  it("passes through an enabled cad config's libraries", () => {
    const resolved = buildResolvedValidatorConfig(
      minimalInput({
        cad: {
          enabled: true,
          symbolLibraries: ["/abs/project/symbols/lib.kicad_sym"],
          footprintDirs: ["/abs/project/footprints/fixture.pretty"],
        },
      }),
    );
    assert.deepEqual(resolved.cad, {
      enabled: true,
      symbolLibraries: ["/abs/project/symbols/lib.kicad_sym"],
      footprintDirs: ["/abs/project/footprints/fixture.pretty"],
      requirePinEqualsPad: true,
    });
  });

  it("passes bundles/inventory/routing/integration/policy paths through unchanged", () => {
    const input = minimalInput();
    const resolved = buildResolvedValidatorConfig(input);
    assert.equal(resolved.bundles.root, input.bundles.root);
    assert.deepEqual(resolved.bundles.reservedDirs, input.bundles.reservedDirs);
    assert.equal(resolved.bundles.auditSkillDir, input.bundles.auditSkillDir);
    assert.equal(resolved.inventory.path, input.inventory.path);
    assert.equal(resolved.inventory.candidatesPath, null);
    assert.deepEqual(resolved.inventory.provider, input.inventory.provider);
    assert.equal(resolved.routing.directRouting, null);
    assert.equal(resolved.integration.integrationSkillDir, input.integration.integrationSkillDir);
    assert.equal(resolved.policy.path, null);
  });

  it("passes through an optional candidate inventory path", () => {
    const resolved = buildResolvedValidatorConfig(
      minimalInput({
        inventory: {
          ...minimalInput().inventory,
          candidatesPath: "/abs/project/candidates.json",
        },
      }),
    );
    assert.equal(resolved.inventory.candidatesPath, "/abs/project/candidates.json");
  });
});
