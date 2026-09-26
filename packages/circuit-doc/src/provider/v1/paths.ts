/**
 * Every filesystem location this provider is allowed to touch, injected by the
 * caller as absolute paths.
 *
 * Upstream resolved these from its own module-URL depth, which only works while
 * the engine sits inside the project it documents. As a package the engine
 * lives under `node_modules`, so the project's layout is data: the config
 * loader (or a test) builds one `CircuitProjectPaths` and threads it through.
 */

import { isAbsolute, resolve } from "node:path";

import { fail } from "../../core/errors.ts";

export type CircuitProjectPaths = {
  /** The project data root: validator cwd, base of repo-relative asset paths. */
  readonly projectRoot: string;
  /** The only directory evidence is read from (`.claude/skills` in v1). */
  readonly bundlesRoot: string;
  readonly inventoryFile: string;
  readonly integrationRulesFile: string;
  /** The exclusively-owned generated page tree. */
  readonly generatedRoot: string;
  /** Committed, deterministic publication preflight report. */
  readonly preflightFile: string;
  /** The built site the publication-safety scan reads. */
  readonly distRoot: string;
  readonly publicRoot: string;
  /** Master footprint files and the mirrored KiCad library used by previews. */
  readonly footprintMasterRoot: string;
  readonly footprintLibraryRoot: string;
  readonly modelRoot: string;
  /** Where selected WRL models are published for the viewer. */
  readonly modelPublicRoot: string;
  /** Where footprint preview SVGs and their manifest are published. */
  readonly footprintPreviewRoot: string;
};

export type CircuitProjectPathKey = keyof CircuitProjectPaths;

export const CIRCUIT_PROJECT_PATH_KEYS: readonly CircuitProjectPathKey[] = [
  "projectRoot",
  "bundlesRoot",
  "inventoryFile",
  "integrationRulesFile",
  "generatedRoot",
  "preflightFile",
  "distRoot",
  "publicRoot",
  "footprintMasterRoot",
  "footprintLibraryRoot",
  "modelRoot",
  "modelPublicRoot",
  "footprintPreviewRoot",
];

/**
 * Build a `CircuitProjectPaths` from a root and root-relative entries. Every
 * key is required, so a caller cannot silently fall back to a guessed layout.
 */
export function projectPaths(
  root: string,
  relative: Readonly<Record<CircuitProjectPathKey, string>>,
): CircuitProjectPaths {
  if (!isAbsolute(root)) {
    fail("PATH_CONTAINMENT", "project root must be an absolute path", { root });
  }
  const entries = CIRCUIT_PROJECT_PATH_KEYS.map((key) => {
    const value = relative[key];
    if (typeof value !== "string") {
      fail("ADAPTER_CONTRACT", "project path is missing", { key });
    }
    return [key, resolve(root, value)] as const;
  });
  return Object.freeze(Object.fromEntries(entries)) as CircuitProjectPaths;
}

/** Per-record bundle files, in the order a record page consumes them. */
export const BUNDLE_FILES = [
  "manifest.json",
  "sources.json",
  "facts.json",
  "coverage.json",
  "routing.json",
  "interactions.json",
  "pin-map.json",
] as const;

export type BundleFile = (typeof BUNDLE_FILES)[number];
