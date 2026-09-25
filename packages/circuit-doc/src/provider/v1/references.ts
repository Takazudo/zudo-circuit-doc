/**
 * Fail-closed construction of the circuit's reviewed document and KiCad
 * preview contract. Network verification is deliberately NOT performed here:
 * it is a human audit that changes committed selection, while generation must
 * remain deterministic and offline.
 */

import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative } from "node:path";

import { fail } from "../../core/errors.ts";
import type { InstanceSelection } from "../../core/publication.ts";
import type { EvidenceIndex, IndexedRecord, ProviderSource } from "./evidence.ts";
import type { CircuitProjectPaths } from "./paths.ts";

export type ReferenceLimits = {
  readonly footprintBytes: number;
  readonly modelBytes: number;
  readonly aggregateModelBytes: number;
};

export const REFERENCE_LIMITS: ReferenceLimits = {
  footprintBytes: 512 * 1024,
  modelBytes: 2 * 1024 * 1024,
  aggregateModelBytes: 8 * 1024 * 1024,
};

export type Transform3d = { readonly x: number; readonly y: number; readonly z: number };

export type CircuitDocumentReference = {
  readonly recordId: string;
  readonly source: ProviderSource;
  readonly documentKind: "datasheet" | "specification" | "drawing";
};

export type CircuitPackageReference = {
  readonly packageId: string;
  readonly footprintName: string;
  readonly footprintPath: string;
  readonly modelPath: string;
  readonly offset: Transform3d;
  readonly rotation: Transform3d;
  readonly scale: Transform3d;
  readonly recordIds: readonly string[];
};

export type CircuitReferenceContract = {
  readonly documentsByRecordId: ReadonlyMap<string, CircuitDocumentReference>;
  readonly packages: readonly CircuitPackageReference[];
  readonly packageByRecordId: ReadonlyMap<string, CircuitPackageReference>;
};

/** The project roots the reference contract reads from. */
export type CircuitReferenceRoots = Pick<
  CircuitProjectPaths,
  "projectRoot" | "footprintLibraryRoot" | "modelRoot"
>;

/**
 * Upstream (zudo-led-lamp) value, kept as the option default so a project that
 * does not override it gets the same fail-closed behavior the extraction
 * started from. The package-count lock has no such default any more (ADR-012):
 * it is a project-reviewed value that lives on `InstanceSelection.expect`.
 */
export const UPSTREAM_MODEL_PREFIX = "${KIPRJMOD}/../../footprints/kicad/zudo-led-lamp.3dshapes/";
/** Documents the upstream literal this issue replaced; no longer used as a default. */
export const UPSTREAM_EXPECTED_PACKAGES = 25;

export type CircuitReferenceOptions = {
  /**
   * CAD capability flag (config `cad.enabled`). Defaults to `true`, matching
   * upstream (CAD was always available). `false` is a capability that must be
   * respected: a selected PCB-mounted record still requiring a footprint is a
   * fatal `ADAPTER_CONTRACT`, never a silent skip. An `external` (non-PCB)
   * record is unaffected either way.
   */
  readonly enabled?: boolean;
  /** The only footprint model locator prefix accepted as a local WRL. */
  readonly modelLocatorPrefix?: string;
  /**
   * Base directory the recorded `footprintPath`/`modelPath` are computed
   * relative to (config `cad.footprintPathBase`). Defaults to `projectRoot`.
   */
  readonly footprintPathBase?: string;
  /** Overridable size limits; any field left unset falls back to `REFERENCE_LIMITS`. */
  readonly limits?: Partial<ReferenceLimits>;
};

const SAFE_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u;
const ALLOWED_VRML_NODES = new Set([
  "Appearance",
  "Coordinate",
  "IndexedFaceSet",
  "Material",
  "Shape",
]);

export async function readCircuitReferenceContract(
  index: EvidenceIndex,
  selection: InstanceSelection,
  roots: CircuitReferenceRoots,
  options: CircuitReferenceOptions = {},
): Promise<CircuitReferenceContract> {
  const enabled = options.enabled ?? true;
  const modelLocatorPrefix = options.modelLocatorPrefix ?? UPSTREAM_MODEL_PREFIX;
  const limits = resolveLimits(options.limits);
  // Asset paths are reported relative to the canonical path base, because the
  // files themselves are canonicalised before the relative path is taken.
  const canonicalPathBase = await realpath(options.footprintPathBase ?? roots.projectRoot);
  const documentsByRecordId = selectDocuments(index, selection);
  const packageByRecordId = new Map<string, CircuitPackageReference>();
  const packagesByName = new Map<string, CircuitPackageReference>();
  let aggregateModelBytes = 0;

  for (const recordId of selection.recordIds) {
    const entry = index.recordById.get(recordId);
    if (entry === undefined) fail("STALE_SELECTION", `missing record ${recordId}`, { recordId });
    if (entry.line.mounting === "external") {
      if (entry.line.lcsc !== "" || entry.pinMaps.length !== 1 || entry.pinMaps[0]?.footprint !== "") {
        fail("ADAPTER_CONTRACT", "external component has a PCB identity or footprint", { recordId });
      }
      continue;
    }
    if (!enabled) {
      fail(
        "ADAPTER_CONTRACT",
        `CAD capability disabled but record ${recordId} requires a footprint/model reference`,
        { recordId },
      );
    }
    const footprintName = canonicalFootprint(entry);
    let packageReference = packagesByName.get(footprintName);
    if (packageReference === undefined) {
      packageReference = await readPackage(
        footprintName,
        recordId,
        roots,
        canonicalPathBase,
        modelLocatorPrefix,
        limits,
      );
      aggregateModelBytes += await fileSize(
        join(canonicalPathBase, packageReference.modelPath),
        "model",
        recordId,
      );
      assertReferenceSize("aggregate", aggregateModelBytes, recordId, limits);
      packagesByName.set(footprintName, packageReference);
    }
    const recordIds = [...packageReference.recordIds, recordId];
    packageReference = { ...packageReference, recordIds };
    packagesByName.set(footprintName, packageReference);
    packageByRecordId.set(recordId, packageReference);
    // Replace earlier record lookups with the immutable descriptor carrying the
    // complete shared-record list.
    for (const sharedRecordId of recordIds) packageByRecordId.set(sharedRecordId, packageReference);
  }

  const packages = [...packagesByName.values()];
  const expectedPackages = selection.expect.packages;
  if (expectedPackages !== undefined && packages.length !== expectedPackages) {
    fail("ADAPTER_CONTRACT", `preview manifest must contain exactly ${expectedPackages} packages`, {
      expected: expectedPackages,
      actual: packages.length,
    });
  }
  return { documentsByRecordId, packages, packageByRecordId };
}

function selectDocuments(
  index: EvidenceIndex,
  selection: InstanceSelection,
): ReadonlyMap<string, CircuitDocumentReference> {
  const result = new Map<string, CircuitDocumentReference>();
  for (const selected of selection.documentSelections) {
    const record = index.recordById.get(selected.recordId);
    const source = record?.sources.find((candidate) => candidate.source_id === selected.sourceId);
    if (record === undefined || source === undefined || source.record_id !== selected.recordId) {
      fail("STALE_SELECTION", "document selection does not resolve within its record", {
        recordId: selected.recordId,
        sourceId: selected.sourceId,
      });
    }
    if (!/^https?:\/\//u.test(source.authoritative_url)) {
      fail("PUBLICATION_POLICY", "selected document does not have an allowed public URL", {
        recordId: selected.recordId,
        sourceId: selected.sourceId,
      });
    }
    result.set(selected.recordId, {
      recordId: selected.recordId,
      source,
      documentKind: selected.documentKind,
    });
  }
  return result;
}

function canonicalFootprint(entry: IndexedRecord): string {
  const names = new Set(entry.pinMaps.map((pinMap) => pinMap.footprint));
  if (names.size !== 1) {
    fail("ADAPTER_CONTRACT", "record must resolve to exactly one footprint", {
      recordId: entry.record.record_id,
      footprints: [...names],
    });
  }
  const name = [...names][0];
  if (name === undefined || !SAFE_BASENAME.test(name)) {
    fail("PATH_CONTAINMENT", "record has an unsafe footprint name", {
      recordId: entry.record.record_id,
      footprint: name ?? "",
    });
  }
  return name;
}

async function readPackage(
  footprintName: string,
  recordId: string,
  roots: CircuitReferenceRoots,
  canonicalPathBase: string,
  modelLocatorPrefix: string,
  limits: ReferenceLimits,
): Promise<CircuitPackageReference> {
  const footprintFile = await containedFile(roots.footprintLibraryRoot, `${footprintName}.kicad_mod`, recordId, roots.projectRoot);
  const footprintStat = await lstat(footprintFile);
  assertReferenceSize("footprint", footprintStat.size, recordId, limits);
  const footprint = await readFile(footprintFile, "utf8");
  const models = [...footprint.matchAll(/\(model\s+"([^"]+)"/gu)];
  if (models.length !== 1) {
    fail("ADAPTER_CONTRACT", "footprint must reference exactly one model", {
      recordId,
      footprint: footprintName,
      modelCount: models.length,
    });
  }
  const modelLocator = models[0]?.[1] ?? "";
  if (!modelLocator.startsWith(modelLocatorPrefix)) {
    fail("PATH_CONTAINMENT", "footprint model is not a safe local WRL", {
      recordId,
      footprint: footprintName,
      model: modelLocator,
    });
  }
  const modelName = modelLocator.slice(modelLocatorPrefix.length);
  if (!SAFE_BASENAME.test(modelName) || extname(modelName).toLowerCase() !== ".wrl") {
    fail("PATH_CONTAINMENT", "footprint model has an unsafe WRL name", {
      recordId,
      footprint: footprintName,
      model: modelLocator,
    });
  }
  const modelFile = await containedFile(roots.modelRoot, modelName, recordId, roots.projectRoot);
  const modelStat = await lstat(modelFile);
  assertReferenceSize("model", modelStat.size, recordId, limits);
  const stepName = `${modelName.slice(0, -4)}.step`;
  assertSameBasenamePair(modelName, stepName, recordId);
  await containedFile(roots.modelRoot, stepName, recordId, roots.projectRoot);
  validateVrml(await readFile(modelFile, "utf8"), recordId, modelName);

  return {
    packageId: footprintName,
    footprintName,
    footprintPath: relative(canonicalPathBase, footprintFile),
    modelPath: relative(canonicalPathBase, modelFile),
    offset: transform(footprint, "offset", recordId, footprintName),
    rotation: transform(footprint, "rotate", recordId, footprintName),
    scale: transform(footprint, "scale", recordId, footprintName),
    recordIds: [],
  };
}

export function validateVrml(contents: string, recordId: string, modelName: string): void {
  const withoutComments = contents.replace(/^\s*#.*$/gmu, "");
  if (!/^\s*#VRML V2\.0 utf8/mu.test(contents)) {
    fail("ADAPTER_CONTRACT", "model is not supported VRML 2.0", { recordId, model: modelName });
  }
  if (/\.\.[/\\]/u.test(withoutComments)) {
    fail("PATH_CONTAINMENT", "model contains a traversal sequence", {
      recordId,
      model: modelName,
    });
  }
  if (/(?:https?:|file:|javascript:|data:)|\burl\s|\b(?:Inline|Script|EXTERNPROTO|PROTO|ImageTexture|MovieTexture|AudioClip|Anchor|WWWInline|LoadSensor|ROUTE|IMPORT|EXPORT|USE|IS)\b/iu.test(withoutComments)) {
    fail("PUBLICATION_POLICY", "model contains a resource-loading or executable VRML construct", {
      recordId,
      model: modelName,
    });
  }
  for (const match of withoutComments.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*\{/gu)) {
    const node = match[1] as string;
    if (!ALLOWED_VRML_NODES.has(node)) {
      fail("PUBLICATION_POLICY", `model contains loader-unsupported VRML node ${node}`, {
        recordId,
        model: modelName,
        node,
      });
    }
  }
}

export function assertSafePreviewAssetName(name: string, recordId: string): void {
  if (isAbsolute(name) || name.includes("/") || name.includes("\\") || !SAFE_BASENAME.test(name)) {
    fail("PATH_CONTAINMENT", "preview asset name is not a safe basename", { recordId, path: name });
  }
}

export function assertSameBasenamePair(wrlName: string, stepName: string, recordId: string): void {
  if (extname(wrlName).toLowerCase() !== ".wrl" || extname(stepName).toLowerCase() !== ".step" || basename(wrlName, extname(wrlName)) !== basename(stepName, extname(stepName))) {
    fail("ADAPTER_CONTRACT", "WRL and STEP preview assets must have the same basename", {
      recordId,
      wrl: wrlName,
      step: stepName,
    });
  }
}

export function assertReferenceSize(
  kind: "footprint" | "model" | "aggregate",
  actual: number,
  recordId: string,
  limits: ReferenceLimits = REFERENCE_LIMITS,
): void {
  const limit = kind === "footprint"
    ? limits.footprintBytes
    : kind === "model"
      ? limits.modelBytes
      : limits.aggregateModelBytes;
  if (!Number.isSafeInteger(actual) || actual < 0 || actual > limit) sizeFailure(kind, recordId, actual, limit);
}

function resolveLimits(overrides: Partial<ReferenceLimits> | undefined): ReferenceLimits {
  return {
    footprintBytes: overrides?.footprintBytes ?? REFERENCE_LIMITS.footprintBytes,
    modelBytes: overrides?.modelBytes ?? REFERENCE_LIMITS.modelBytes,
    aggregateModelBytes: overrides?.aggregateModelBytes ?? REFERENCE_LIMITS.aggregateModelBytes,
  };
}

function transform(body: string, key: string, recordId: string, footprint: string): Transform3d {
  const match = new RegExp(`\\(${key}\\s+\\(xyz\\s+([^\\s)]+)\\s+([^\\s)]+)\\s+([^\\s)]+)\\)\\)`, "u").exec(body);
  if (match === null) {
    fail("ADAPTER_CONTRACT", `footprint model has no ${key} transform`, { recordId, footprint });
  }
  const values = match.slice(1).map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    fail("ADAPTER_CONTRACT", `footprint model has invalid ${key} transform`, { recordId, footprint });
  }
  return { x: values[0] as number, y: values[1] as number, z: values[2] as number };
}

async function containedFile(
  root: string,
  name: string,
  recordId: string,
  projectRoot: string,
): Promise<string> {
  assertSafePreviewAssetName(name, recordId);
  let canonicalRoot: string;
  let canonicalFile: string;
  try {
    canonicalRoot = await realpath(root);
    canonicalFile = await realpath(join(root, name));
  } catch (error) {
    fail("ADAPTER_CONTRACT", "preview asset is missing", {
      recordId,
      path: relative(projectRoot, join(root, name)),
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const rel = relative(canonicalRoot, canonicalFile);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    fail("PATH_CONTAINMENT", "preview asset escapes its allowed root", { recordId, path: name });
  }
  const stat = await lstat(join(root, name));
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("PATH_CONTAINMENT", "preview asset must be a regular non-symlink file", { recordId, path: name });
  }
  return canonicalFile;
}

async function fileSize(path: string, kind: string, recordId: string): Promise<number> {
  try {
    return (await lstat(path)).size;
  } catch {
    fail("ADAPTER_CONTRACT", `${kind} asset is missing`, { recordId, path });
  }
}

function sizeFailure(kind: string, recordId: string, actual: number, limit: number): never {
  fail("PUBLICATION_POLICY", `${kind} exceeds preview size limit`, {
    recordId,
    actualBytes: actual,
    limitBytes: limit,
  });
}
