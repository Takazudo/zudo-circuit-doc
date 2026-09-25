/**
 * A synthetic, on-disk project shaped exactly like what `circuit_validate.py`
 * (contract v1) expects: a zero-component inventory, an audit skill and an
 * integration skill, each with a passing `SKILL.md`.
 *
 * Not a `*.test.ts` file, so `node --test` does not pick it up as a suite.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ValidatorInput } from "../../src/validate/resolved-config.ts";

export const AUDIT_SKILL = "component-spec-audit";
export const INTEGRATION_SKILL = "circuit-spec-integration";
export const TEST_USER_AGENT = "zudo-circuit-doc-component-spec-test/1.0";

// `skillmd.py` `frontmatter()`: description must be >= 80 chars and mention "use".
const SKILL_DESCRIPTION =
  "Resolve exact component limits and constraints for this synthetic test fixture. Use whenever it is relevant.";

function skillMd(name: string): string {
  return `---\nname: ${name}\ndescription: ${SKILL_DESCRIPTION}\n---\n\n# Test skill\n`;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * Writes the zero-component project `circuit_validate.py`'s own tests use as
 * the empty-project baseline: an inventory with `lines: []`, an empty
 * integration ruleset, and both skills present with a passing frontmatter. CAD
 * is disabled, so no symbol/footprint files are needed.
 */
export async function writeEmptyValidatorProject(root: string): Promise<ValidatorInput> {
  const skills = join(root, ".claude/skills");
  const auditDir = join(skills, AUDIT_SKILL);
  const auditRefs = join(auditDir, "references");
  const integrationDir = join(skills, INTEGRATION_SKILL);
  const integrationRefs = join(integrationDir, "references");

  await mkdir(auditRefs, { recursive: true });
  await mkdir(integrationRefs, { recursive: true });
  await writeFile(join(auditDir, "SKILL.md"), skillMd(AUDIT_SKILL), "utf8");
  await writeFile(join(integrationDir, "SKILL.md"), skillMd(INTEGRATION_SKILL), "utf8");

  const inventoryPath = join(auditRefs, "inventory.json");
  await writeJson(inventoryPath, {
    schema_version: 1,
    generator_specs: [],
    assertions: { orderable_lines: 0, fitted_lines: 0, dnp_or_hand_fit_lines: 0 },
    exclusions: [],
    lines: [],
  });

  const rulesPath = join(integrationRefs, "rules.json");
  await writeJson(rulesPath, { schema_version: 1, rules: [] });

  return {
    projectRoot: root,
    bundles: {
      root: skills,
      ownerPrefix: "component-",
      // `component-spec-audit` itself starts with the owner prefix, so it must
      // be reserved to keep it from being mistaken for an owner bundle.
      reservedDirs: [AUDIT_SKILL],
      auditSkillDir: auditDir,
      requireSkillMd: true,
    },
    inventory: { path: inventoryPath, provider: { kind: "manual" } },
    routing: { directRouting: null, vendorQualifiers: null },
    cad: { enabled: false },
    integration: { rulesPath, forwardTests: null, integrationSkillDir: integrationDir },
    policy: { path: null },
    online: {
      tempRoot: join(root, ".circuit-cache/sources"),
      userAgent: TEST_USER_AGENT,
      skipVolatileInAll: true,
    },
    output: { json: false },
  };
}

/** Removes the `.claude/skills/component-spec-audit/references/inventory.json` file, leaving everything else. */
export async function deleteInventoryFile(input: ValidatorInput): Promise<void> {
  await rm(input.inventory.path, { force: true });
}
