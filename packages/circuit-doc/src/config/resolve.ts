// Turns a validated config into absolute paths. No existence checks here: the
// adapter/CLI owns them, so "absent file" vs "empty file" is decided in one place.
import { resolve } from "node:path";

import {
  CONFIG_VERSION,
  DEFAULT_PYTHON_MIN_VERSION,
  DEFAULT_REFERENCE_LIMITS,
  DEFAULT_ROOT,
  EVIDENCE_CONTRACT_VERSION,
  type BrowserSmokeConfig,
  type CircuitConfig,
  type PreviewRendererConfig,
  type ProjectConfig,
  type ReferenceLimitsConfig,
  type ScanPolicyConfig,
} from "./define.ts";
import { ConfigError } from "./errors.ts";
import { configPathProblem } from "./schema.ts";

export type ResolvedInventoryProvider =
  | { readonly kind: "manual" }
  | { readonly kind: "led-generator-v1"; readonly specs: readonly { readonly path: string }[] };

export type ResolvedCadConfig =
  | { readonly enabled: false; readonly libraryName: string | null }
  | {
      readonly enabled: true;
      readonly libraryName: string;
      readonly symbolLibraries: readonly string[];
      readonly footprintMasterRoot: string;
      readonly footprintLibraryRoot: string;
      readonly modelRoot: string;
      readonly modelLocatorPrefix: string;
      readonly footprintPathBase: string;
      readonly previewRenderer: PreviewRendererConfig;
      readonly limits: ReferenceLimitsConfig;
    };

/** Every path is absolute. */
export type ResolvedCircuitConfig = {
  readonly configVersion: 1;
  readonly configDir: string;
  /** The project data root (`root`). */
  readonly root: string;
  readonly project: ProjectConfig;
  readonly docs: {
    readonly root: string;
    readonly generatedContent: string;
    readonly preflight: string;
    readonly publicRoot: string;
    readonly dist: string;
    readonly agentResources: boolean;
    readonly generatedMarker: string | null;
    /** `null` means unset: `map.ts` falls back to the legacy-marker inference. */
    readonly generatedNotice: boolean | null;
    readonly integrationGloss: string | null;
  };
  readonly evidence: {
    readonly contractVersion: 1;
    readonly bundlesRoot: string;
    readonly ownerPrefix: string;
    readonly auditSkill: string;
    readonly integrationSkill: string;
    readonly inventory: string;
    readonly integrationRules: string;
    readonly directRouting: string;
    readonly vendorQualifiers: string;
    readonly forwardTests: string | null;
    readonly sourceCache: string;
  };
  readonly inventoryProvider: ResolvedInventoryProvider;
  readonly publication: {
    readonly selection: string;
    readonly assets: string;
    /** `null` means the package preset `DEFAULT_PUBLICATION_MATRIX_PRESET`. */
    readonly matrix: string | null;
  };
  readonly cad: ResolvedCadConfig;
  readonly validation: {
    readonly pythonMinVersion: string;
    readonly policy: string | null;
    readonly userAgent: string | null;
  };
  /** Overrides only; defaults belong to the scan policy owner. */
  readonly scan: ScanPolicyConfig | null;
  readonly browserSmoke: BrowserSmokeConfig | null;
};

/** `config` must already be validated (`validateCircuitConfig`); `configDir` is the config file's directory. */
export function resolveCircuitConfig(config: CircuitConfig, configDir: string): ResolvedCircuitConfig {
  const base = resolve(configDir);
  const at = (value: string, field: string): string => {
    const problem = configPathProblem(value);
    if (problem !== undefined) throw new ConfigError("CONFIG_INVALID", [{ path: field, message: problem }]);
    return resolve(base, value);
  };
  const atOrNull = (value: string | null | undefined, field: string): string | null =>
    value === undefined || value === null ? null : at(value, field);

  const root = at(config.root ?? DEFAULT_ROOT, "root");
  const { docs, evidence, publication, cad, inventoryProvider } = config;
  const validation = config.validation ?? {};

  return {
    configVersion: CONFIG_VERSION,
    configDir: base,
    root,
    project: { name: config.project.name, title: config.project.title },
    docs: {
      root: at(docs.root, "docs.root"),
      generatedContent: at(docs.generatedContent, "docs.generatedContent"),
      preflight: at(docs.preflight, "docs.preflight"),
      publicRoot: at(docs.publicRoot, "docs.publicRoot"),
      dist: at(docs.dist, "docs.dist"),
      agentResources: docs.agentResources ?? true,
      generatedMarker: docs.generatedMarker ?? null,
      generatedNotice: docs.generatedNotice ?? null,
      integrationGloss: atOrNull(docs.integrationGloss, "docs.integrationGloss"),
    },
    evidence: {
      contractVersion: EVIDENCE_CONTRACT_VERSION,
      bundlesRoot: at(evidence.bundlesRoot, "evidence.bundlesRoot"),
      ownerPrefix: evidence.ownerPrefix,
      auditSkill: evidence.auditSkill,
      integrationSkill: evidence.integrationSkill,
      inventory: at(evidence.inventory, "evidence.inventory"),
      integrationRules: at(evidence.integrationRules, "evidence.integrationRules"),
      directRouting: at(evidence.directRouting, "evidence.directRouting"),
      vendorQualifiers: at(evidence.vendorQualifiers, "evidence.vendorQualifiers"),
      forwardTests: atOrNull(evidence.forwardTests, "evidence.forwardTests"),
      sourceCache: at(evidence.sourceCache, "evidence.sourceCache"),
    },
    inventoryProvider:
      inventoryProvider.kind === "manual"
        ? { kind: "manual" }
        : {
            kind: "led-generator-v1",
            specs: inventoryProvider.specs.map((spec, index) => ({
              path: at(spec.path, `inventoryProvider.specs[${index}].path`),
            })),
          },
    publication: {
      selection: at(publication.selection, "publication.selection"),
      assets: at(publication.assets, "publication.assets"),
      matrix: atOrNull(publication.matrix, "publication.matrix"),
    },
    cad: cad.enabled
      ? {
          enabled: true,
          libraryName: cad.libraryName,
          symbolLibraries: cad.symbolLibraries.map((path, index) => at(path, `cad.symbolLibraries[${index}]`)),
          footprintMasterRoot: at(cad.footprintMasterRoot, "cad.footprintMasterRoot"),
          footprintLibraryRoot: at(cad.footprintLibraryRoot, "cad.footprintLibraryRoot"),
          modelRoot: at(cad.modelRoot, "cad.modelRoot"),
          modelLocatorPrefix: cad.modelLocatorPrefix,
          footprintPathBase:
            cad.footprintPathBase === undefined ? root : at(cad.footprintPathBase, "cad.footprintPathBase"),
          previewRenderer: {
            ...cad.previewRenderer,
            layers: [...cad.previewRenderer.layers],
            options: [...cad.previewRenderer.options],
          },
          limits: withDefaultLimits(cad.limits),
        }
      : { enabled: false, libraryName: cad.libraryName ?? null },
    validation: {
      pythonMinVersion: validation.pythonMinVersion ?? DEFAULT_PYTHON_MIN_VERSION,
      policy: atOrNull(validation.policy, "validation.policy"),
      userAgent: validation.userAgent ?? null,
    },
    scan: config.scan === undefined ? null : { ...config.scan },
    browserSmoke:
      config.browserSmoke === undefined
        ? null
        : { representatives: config.browserSmoke.representatives.map((entry) => ({ ...entry })) },
  };
}

function withDefaultLimits(limits: Partial<ReferenceLimitsConfig> | undefined): ReferenceLimitsConfig {
  return {
    footprintBytes: limits?.footprintBytes ?? DEFAULT_REFERENCE_LIMITS.footprintBytes,
    modelBytes: limits?.modelBytes ?? DEFAULT_REFERENCE_LIMITS.modelBytes,
    aggregateModelBytes: limits?.aggregateModelBytes ?? DEFAULT_REFERENCE_LIMITS.aggregateModelBytes,
  };
}
