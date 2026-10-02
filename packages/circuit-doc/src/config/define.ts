// The public `circuit.config.ts` contract (ADR-005), exported as
// `@takazudo/zudo-circuit-doc/config`. Node-free and import-free: it is loaded
// by consumer configs and may be bundled into non-Node contexts.
//
// Canonical config form (type-only import, erased by native type stripping, so
// the file loads even where the package is not resolvable):
//
//   import type { CircuitConfig } from "@takazudo/zudo-circuit-doc/config";
//   export default { … } satisfies CircuitConfig;
//
// Every path is relative to the config file's directory and must stay inside it.

export const CONFIG_VERSION = 1;
export const EVIDENCE_CONTRACT_VERSION = 1;
export const DEFAULT_CONFIG_FILENAME = "circuit.config.ts";
export const DEFAULT_ROOT = ".";
export const DEFAULT_PYTHON_MIN_VERSION = "3.10";
export const DEFAULT_PUBLICATION_MATRIX_PRESET = "component-evidence-v1";
export const INVENTORY_PROVIDER_KINDS = ["manual", "led-generator-v1"] as const;

// Upstream zudo-led-lamp references.ts REFERENCE_LIMITS.
export const DEFAULT_REFERENCE_LIMITS: ReferenceLimitsConfig = {
  footprintBytes: 512 * 1024,
  modelBytes: 2 * 1024 * 1024,
  aggregateModelBytes: 8 * 1024 * 1024,
};

/** A ready-to-use `cad.previewRenderer` value; matches `examples/minimal/circuit.config.ts`. */
export const DEFAULT_PREVIEW_RENDERER: PreviewRendererConfig = {
  image: "kicad/kicad@sha256:e638b79b0321f29395a5b783e94bb9f3c73303e8da15da27b8f5cb4b67a37729",
  version: "9.0.9",
  platform: "linux/amd64",
  layers: ["F.Cu", "F.Silkscreen", "F.Fabrication", "F.Courtyard"],
  theme: "KiCad Default",
  options: ["--black-and-white"],
};

/** A path relative to the config file's directory; absolute paths and `..` escapes are rejected. */
export type ConfigPath = string;

export type InventoryProviderKind = (typeof INVENTORY_PROVIDER_KINDS)[number];

export type ProjectConfig = {
  readonly name: string;
  readonly title: string;
};

export type DocsConfig = {
  readonly root: ConfigPath;
  /** The route `/docs/components/` is fixed in v1. */
  readonly generatedContent: ConfigPath;
  readonly preflight: ConfigPath;
  /** Previews go under `<publicRoot>/assets/component-previews/{footprints,models}`. */
  readonly publicRoot: ConfigPath;
  readonly dist: ConfigPath;
  /** Generated pages link `/docs/claude/` and `/docs/claude-skills/<owner>/` (requires zudo-doc `claudeResources`). Default `true`. */
  readonly agentResources?: boolean;
  /** LED fixture only: the legacy generated-page marker. */
  readonly generatedMarker?: string;
  /**
   * Whether generated pages carry the ADR-020 generated-page notice
   * paragraph. Default `true`, except when `generatedMarker` is a legacy
   * marker (see `LEGACY_MARKERS`) and this is left unset, in which case the
   * notice stays off to reproduce pre-extraction output byte-for-byte.
   */
  readonly generatedNotice?: boolean;
  /** Optional JSON file `{ domain: text }`. */
  readonly integrationGloss?: ConfigPath;
};

export type EvidenceConfig = {
  readonly contractVersion: 1;
  readonly bundlesRoot: ConfigPath;
  readonly ownerPrefix: string;
  /** Directory name under `bundlesRoot`. */
  readonly auditSkill: string;
  /** Directory name under `bundlesRoot`. */
  readonly integrationSkill: string;
  readonly inventory: ConfigPath;
  readonly integrationRules: ConfigPath;
  readonly directRouting: ConfigPath;
  readonly vendorQualifiers: ConfigPath;
  readonly forwardTests?: ConfigPath | null;
  readonly candidates?: ConfigPath | null;
  readonly sourceCache: ConfigPath;
};

export type ManualInventoryProviderConfig = {
  readonly kind: "manual";
};

export type LedGeneratorSpecConfig = {
  readonly path: ConfigPath;
  /** Expected board name; defaults to the spec's PROJECT_NAME. */
  readonly board?: string;
};

export type LedGeneratorInventoryProviderConfig = {
  readonly kind: "led-generator-v1";
  readonly specs: readonly LedGeneratorSpecConfig[];
  /** How generated fit state is represented. Defaults to line-level fit. */
  readonly fit?: "line" | "placement";
  /** Reviewed generator LCSC codes whose MPN is taken from the generated value. */
  readonly mpnFromValueLcsc?: readonly string[];
};

export type InventoryProviderConfig = ManualInventoryProviderConfig | LedGeneratorInventoryProviderConfig;

export type PublicationConfig = {
  readonly selection: ConfigPath;
  readonly assets: ConfigPath;
  /** A matrix JSON file; when absent the package preset `component-evidence-v1` is used. */
  readonly matrix?: ConfigPath;
};

export type PreviewRendererConfig = {
  /** Container image reference, e.g. `kicad/kicad@sha256:…`. */
  readonly image: string;
  readonly version: string;
  /** Container platform, e.g. `linux/amd64`. */
  readonly platform: string;
  readonly layers: readonly string[];
  readonly theme: string;
  readonly options: readonly string[];
};

export type ReferenceLimitsConfig = {
  readonly footprintBytes: number;
  readonly modelBytes: number;
  readonly aggregateModelBytes: number;
};

export type CadDisabledConfig = {
  readonly enabled: false;
  readonly libraryName?: string;
};

export type CadEnabledConfig = {
  readonly enabled: true;
  readonly libraryName: string;
  readonly symbolLibraries: readonly ConfigPath[];
  readonly footprintMasterRoot: ConfigPath;
  readonly footprintLibraryRoot: ConfigPath;
  readonly modelRoot: ConfigPath;
  /** KiCad model locator prefix, e.g. `${KIPRJMOD}/../../footprints/kicad/<lib>.3dshapes/`. Not a filesystem path. */
  readonly modelLocatorPrefix: string;
  /** Base for footprint paths recorded in preview manifests. Default: `root`. */
  readonly footprintPathBase?: ConfigPath;
  readonly previewRenderer: PreviewRendererConfig;
  readonly limits?: Partial<ReferenceLimitsConfig>;
};

export type CadConfig = CadDisabledConfig | CadEnabledConfig;

export type ValidationConfig = {
  /** Minimum Python version for the validator. Default `"3.10"`. */
  readonly pythonMinVersion?: string;
  /** Data-driven project policy JSON. */
  readonly policy?: ConfigPath | null;
  readonly userAgent?: string;
};

/** Overrides for the production artifact scan policy. */
export type ScanPolicyConfig = {
  readonly minimumOwnedCanaries?: number;
  readonly minimumOwnedFiles?: number;
  readonly minimumSiteCanaries?: number;
  readonly minimumSiteFiles?: number;
  readonly expectedWithheld?: number;
  /** Positive-control record slug; `null` picks one deterministically. */
  readonly positiveControlRecord?: string | null;
};

export type BrowserSmokeRepresentativeConfig = {
  readonly kind: string;
  /** Site route, e.g. `/docs/components/records/<slug>/`. */
  readonly path: string;
  readonly slug: string;
  readonly identity: string;
  readonly availability?: string;
};

export type BrowserSmokeConfig = {
  readonly representatives: readonly BrowserSmokeRepresentativeConfig[];
};

export type CircuitConfig = {
  readonly configVersion: 1;
  /** Project data root (default `"."`); must be inside the config directory. */
  readonly root?: ConfigPath;
  readonly project: ProjectConfig;
  readonly docs: DocsConfig;
  readonly evidence: EvidenceConfig;
  readonly inventoryProvider: InventoryProviderConfig;
  readonly publication: PublicationConfig;
  readonly cad: CadConfig;
  readonly validation?: ValidationConfig;
  readonly scan?: ScanPolicyConfig;
  readonly browserSmoke?: BrowserSmokeConfig;
};

/** Optional identity helper; the canonical form is `satisfies CircuitConfig`. */
export function defineCircuitConfig<T extends CircuitConfig>(config: T): T {
  return config;
}
