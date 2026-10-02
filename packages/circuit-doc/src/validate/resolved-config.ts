/**
 * The resolved-config JSON `circuit_validate.py` reads (ADR-007), built from a
 * plain, package-independent `ValidatorInput`.
 *
 * This module never imports the config loader (`src/config/*`): `ValidatorInput`
 * is its own shape, and #18 is the only place that maps a loaded
 * `circuit.config.ts` into it. Keeping the boundary here means this module, and
 * every test in `test/validate/`, can build a resolved config without ever
 * loading a `.ts` config file.
 *
 * The shape matches `packages/circuit-doc/python/RESOLVED_CONFIG.md` exactly:
 * every key present, every path absolute, `null` for "not configured".
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const RESOLVED_CONFIG_VERSION = 1;
export const RESOLVED_CONTRACT_VERSION = 1;

/** The packaged component-skill template's frontmatter `name` (`circuit_evidence/template.py`). */
export const PACKAGED_TEMPLATE_NAME = "component-example";

/** `RESOLVED_CONFIG.md` `online.userAgent` default. */
export const DEFAULT_ONLINE_USER_AGENT = "zudo-circuit-doc-component-spec/1.0";

export type ValidatorInventoryProvider =
  | { readonly kind: "manual" }
  | { readonly kind: string; readonly [option: string]: unknown };

/**
 * The plain object `buildResolvedValidatorConfig` accepts. Every path is
 * already absolute — this module resolves no project path itself, only the
 * two package-owned ones (`template.dir`, and the `online.tempRoot` fallback).
 */
export type ValidatorInput = {
  readonly projectRoot: string;
  readonly bundles: {
    readonly root: string;
    readonly ownerPrefix: string;
    /** Prefix-matching directory NAMES (not paths) that are not owner bundles, e.g. the audit skill's own dir name. */
    readonly reservedDirs: readonly string[];
    readonly auditSkillDir: string | null;
    /** Default `true` (`RESOLVED_CONFIG.md`). */
    readonly requireSkillMd?: boolean;
  };
  readonly inventory: {
    readonly path: string;
    readonly provider: ValidatorInventoryProvider;
    readonly candidatesPath?: string | null;
  };
  readonly routing: {
    readonly directRouting: string | null;
    readonly vendorQualifiers: string | null;
  };
  readonly cad:
    | { readonly enabled: false }
    | {
        readonly enabled: true;
        readonly symbolLibraries: readonly string[];
        readonly footprintDirs: readonly string[];
      };
  readonly integration: {
    readonly rulesPath: string | null;
    readonly forwardTests: string | null;
    readonly integrationSkillDir: string | null;
  };
  readonly policy: { readonly path: string | null };
  readonly online: {
    /** Defaults to `<projectRoot>/.circuit-cache/sources`; only online modes read it. */
    readonly tempRoot?: string;
    readonly userAgent?: string;
    /** Default `true`. */
    readonly skipVolatileInAll?: boolean;
  };
  readonly output?: { readonly json?: boolean };
};

/** The exact JSON shape piped to `circuit_validate.py`; see `RESOLVED_CONFIG.md`. */
export type ResolvedValidatorConfig = {
  readonly configVersion: 1;
  readonly contractVersion: 1;
  readonly projectRoot: string;
  readonly bundles: {
    readonly root: string;
    readonly ownerPrefix: string;
    readonly reservedDirs: readonly string[];
    readonly auditSkillDir: string | null;
    readonly requireSkillMd: boolean;
  };
  readonly inventory: {
    readonly path: string;
    readonly provider: ValidatorInventoryProvider;
    readonly candidatesPath: string | null;
  };
  readonly routing: {
    readonly directRouting: string | null;
    readonly vendorQualifiers: string | null;
  };
  readonly template: { readonly dir: string; readonly name: string };
  readonly cad: {
    readonly enabled: boolean;
    readonly symbolLibraries: readonly string[];
    readonly footprintDirs: readonly string[];
    readonly requirePinEqualsPad: true;
  };
  readonly integration: {
    readonly rulesPath: string | null;
    readonly forwardTests: string | null;
    readonly integrationSkillDir: string | null;
  };
  readonly policy: { readonly path: string | null };
  readonly online: {
    readonly tempRoot: string;
    readonly userAgent: string;
    readonly skipVolatileInAll: boolean;
  };
  readonly output: { readonly json: boolean };
};

/**
 * `<pkg>/templates/component-skill-template`. Resolved with `import.meta.url`
 * rather than a project path: this is the package's own shipped template, and
 * the depth (`../../templates/…`) matches the `rootDir: src` -> `outDir: dist`
 * 1:1 layout (ADR-004), so it resolves the same way from `src/` under
 * `--experimental-strip-types` and from the built `dist/`.
 */
export function packagedTemplateDir(): string {
  return fileURLToPath(new URL("../../templates/component-skill-template", import.meta.url));
}

export function buildResolvedValidatorConfig(input: ValidatorInput): ResolvedValidatorConfig {
  const cad = input.cad.enabled
    ? {
        enabled: true,
        symbolLibraries: input.cad.symbolLibraries,
        footprintDirs: input.cad.footprintDirs,
        requirePinEqualsPad: true as const,
      }
    : { enabled: false, symbolLibraries: [], footprintDirs: [], requirePinEqualsPad: true as const };

  return {
    configVersion: RESOLVED_CONFIG_VERSION,
    contractVersion: RESOLVED_CONTRACT_VERSION,
    projectRoot: input.projectRoot,
    bundles: {
      root: input.bundles.root,
      ownerPrefix: input.bundles.ownerPrefix,
      reservedDirs: input.bundles.reservedDirs,
      auditSkillDir: input.bundles.auditSkillDir,
      requireSkillMd: input.bundles.requireSkillMd ?? true,
    },
    inventory: {
      path: input.inventory.path,
      provider: input.inventory.provider,
      candidatesPath: input.inventory.candidatesPath ?? null,
    },
    routing: {
      directRouting: input.routing.directRouting,
      vendorQualifiers: input.routing.vendorQualifiers,
    },
    template: { dir: packagedTemplateDir(), name: PACKAGED_TEMPLATE_NAME },
    cad,
    integration: {
      rulesPath: input.integration.rulesPath,
      forwardTests: input.integration.forwardTests,
      integrationSkillDir: input.integration.integrationSkillDir,
    },
    policy: { path: input.policy.path },
    online: {
      tempRoot: input.online.tempRoot ?? join(input.projectRoot, ".circuit-cache/sources"),
      userAgent: input.online.userAgent ?? DEFAULT_ONLINE_USER_AGENT,
      skipVolatileInAll: input.online.skipVolatileInAll ?? true,
    },
    output: { json: input.output?.json ?? false },
  };
}
