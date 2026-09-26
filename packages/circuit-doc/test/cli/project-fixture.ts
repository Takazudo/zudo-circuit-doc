/**
 * Temp circuit projects for CLI tests: the generated-project layout with a
 * canonical `circuit.config.ts` (`import type` + `satisfies`), an explicitly
 * empty evidence corpus, and captured io for in-process `main()` runs.
 *
 * Not a `*.test.ts` file, so `node --test` does not pick it up as a suite.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { CliIo } from "../../src/cli/command.ts";
import { main } from "../../src/cli/main.ts";

// `skillmd.py` `frontmatter()`: description must be >= 80 chars and mention "use".
const SKILL_DESCRIPTION =
  "Resolve exact component limits and constraints for this synthetic CLI test project. Use whenever it is relevant.";

export const INVENTORY = ".claude/skills/component-spec-audit/references/inventory.json";
export const RULES = ".claude/skills/circuit-spec-integration/references/rules.json";
export const SELECTION = "circuit/publication/selection.json";
export const GENERATED = "doc/src/content/docs/components";
export const PREFLIGHT = "circuit/generated/preflight.json";

export type ConfigOverrides = {
  readonly docs?: Record<string, unknown>;
  readonly cad?: Record<string, unknown>;
  readonly extra?: string;
};

export function configSource(overrides: ConfigOverrides = {}): string {
  const docs = {
    root: "doc",
    generatedContent: GENERATED,
    preflight: PREFLIGHT,
    publicRoot: "doc/public",
    dist: "doc/dist",
    agentResources: true,
    ...overrides.docs,
  };
  const cad = overrides.cad ?? { enabled: false, libraryName: "test-circuit" };
  return `import type { CircuitConfig } from "@takazudo/zudo-circuit-doc/config";

export default {
  configVersion: 1,
  project: { name: "test-circuit", title: "Test Circuit" },
  docs: ${JSON.stringify(docs, null, 2).replaceAll("\n", "\n  ")},
  evidence: {
    contractVersion: 1,
    bundlesRoot: ".claude/skills",
    ownerPrefix: "component-",
    auditSkill: "component-spec-audit",
    integrationSkill: "circuit-spec-integration",
    inventory: "${INVENTORY}",
    integrationRules: "${RULES}",
    directRouting: ".claude/skills/component-spec-audit/references/direct-routing.json",
    vendorQualifiers: ".claude/skills/component-spec-audit/references/external-vendor-qualifiers.json",
    sourceCache: ".circuit-cache/sources",
  },
  inventoryProvider: { kind: "manual" },
  publication: {
    selection: "${SELECTION}",
    assets: "circuit/publication/assets.json",
  },
  cad: ${JSON.stringify(cad)},
  validation: {},${overrides.extra ?? ""}
} satisfies CircuitConfig;
`;
}

export const EMPTY_SELECTION = {
  schema_version: 1,
  recordIds: [],
  sourceIds: [],
  linkableSourceIds: [],
  documentSelections: [],
  expect: { records: 0, sources: 0, integrationRules: 0, packages: 0 },
};

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function skillMd(name: string): string {
  return `---\nname: ${name}\ndescription: ${SKILL_DESCRIPTION}\n---\n\n# Test skill\n`;
}

/** A valid, explicitly empty project (zero components, CAD disabled). */
export async function writeEmptyProject(root: string, overrides: ConfigOverrides = {}): Promise<string> {
  const skills = join(root, ".claude/skills");
  await mkdir(join(skills, "component-spec-audit/references"), { recursive: true });
  await mkdir(join(skills, "circuit-spec-integration/references"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({ private: true, type: "module" })}\n`);
  await writeFile(join(root, "circuit.config.ts"), configSource(overrides));
  await writeFile(join(skills, "component-spec-audit/SKILL.md"), skillMd("component-spec-audit"));
  await writeFile(join(skills, "circuit-spec-integration/SKILL.md"), skillMd("circuit-spec-integration"));
  await writeJson(join(root, INVENTORY), {
    schema_version: 1,
    generator_specs: [],
    assertions: { orderable_lines: 0, fitted_lines: 0, dnp_or_hand_fit_lines: 0 },
    exclusions: [],
    lines: [],
  });
  await writeJson(join(skills, "component-spec-audit/references/direct-routing.json"), {
    schema_version: 1,
    contract: "direct-routing-v1",
    cases: [],
  });
  await writeJson(join(skills, "component-spec-audit/references/external-vendor-qualifiers.json"), {
    schema_version: 1,
    vendor_names: [],
  });
  await writeJson(join(root, RULES), { schema_version: 1, rules: [] });
  await writeJson(join(root, SELECTION), EMPTY_SELECTION);
  await writeJson(join(root, "circuit/publication/assets.json"), { schema_version: 1, assets: [] });
  return root;
}

export type CliRun = { readonly code: number; readonly stdout: string; readonly stderr: string };

/** Run `main()` in-process against `cwd`, capturing output. */
export async function runCli(
  cwd: string,
  argv: readonly string[],
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly signal?: AbortSignal;
    readonly onStdout?: (chunk: string) => void;
    readonly onStderr?: (chunk: string) => void;
  } = {},
): Promise<CliRun> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    cwd,
    env: options.env ?? process.env,
    signal: options.signal,
    stdout: {
      write: (chunk: string) => {
        stdout += chunk;
        options.onStdout?.(chunk);
        return true;
      },
    },
    stderr: {
      write: (chunk: string) => {
        stderr += chunk;
        options.onStderr?.(chunk);
        return true;
      },
    },
  };
  const code = await main(argv, io);
  return { code, stdout, stderr };
}
