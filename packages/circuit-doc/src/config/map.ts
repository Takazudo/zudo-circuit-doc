// Maps a resolved `circuit.config.ts` onto the inputs every engine seam takes:
// provider paths, the committed selection, the publication matrix, the
// validator's resolved-config input, render options and CAD reference options.
//
// This is also where declared files are proven present. A declared file that
// is missing fails here with its config-relative path — never later as a
// silently empty corpus — while an explicitly empty file (`lines: []`,
// `rules: []`, `assets: []`) is a valid zero state.
import { readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import type { ValidationRunner } from "../core/adapter.ts";
import { fail } from "../core/errors.ts";
import { LEGACY_MARKERS } from "../core/page.ts";
import type { PipelineRenderOptions } from "../core/pipeline.ts";
import {
  FIELD_KEYS,
  type FieldDecision,
  type InstanceSelection,
  type PublicationMatrix,
} from "../core/publication.ts";
import { FOOTPRINT_ASSET_BASE, MODEL_ASSET_BASE } from "../core/site.ts";
import { CIRCUIT_PUBLICATION_MATRIX_PRESETS } from "../provider/v1/matrix.ts";
import type { CircuitProjectPaths } from "../provider/v1/paths.ts";
import type { CircuitReferenceOptions } from "../provider/v1/references.ts";
import type { PythonVersion } from "../provider/v1/validate.ts";
import { parsePythonVersion } from "../validate/python.ts";
import type { ValidatorInput } from "../validate/resolved-config.ts";
import { createPackageValidator } from "../validate/runner.ts";
import { DEFAULT_PUBLICATION_MATRIX_PRESET } from "./define.ts";
import type { ResolvedCircuitConfig } from "./resolve.ts";

export const SELECTION_SCHEMA_VERSION = 1;
export const ASSETS_SCHEMA_VERSION = 1;

const DOCUMENT_KINDS = ["datasheet", "specification", "drawing", "source-record"] as const;

/** One entry of `publication.assets` (ADR-018's deliberate-publication allowlist). */
export type PublicationAsset = {
  /** Relative to `docs.publicRoot`. */
  readonly path: string;
  readonly reason: string;
  readonly source_id?: string;
};

export type PublicationAssets = {
  readonly schema_version: 1;
  readonly assets: readonly PublicationAsset[];
};

/** A file or directory the config declares and the project must therefore contain. */
export type DeclaredProjectFile = {
  /** The config field that declares it, e.g. `evidence.inventory`. */
  readonly field: string;
  /** Absolute path. */
  readonly path: string;
  readonly kind: "file" | "directory";
};

export type CircuitProjectMapping = {
  readonly config: ResolvedCircuitConfig;
  readonly paths: CircuitProjectPaths;
  readonly selection: InstanceSelection;
  readonly matrix: PublicationMatrix;
  /** `preset:<name>` or the config-relative override path, for messages. */
  readonly matrixSource: string;
  readonly assets: PublicationAssets;
  readonly validatorInput: ValidatorInput;
  readonly pythonMinVersion: PythonVersion;
  readonly render: PipelineRenderOptions;
  readonly reference: CircuitReferenceOptions;
  readonly integrationOwnerSkill: string;
};

/** A path relative to the config directory, with forward slashes, for user-facing messages. */
export function configRelative(config: Pick<ResolvedCircuitConfig, "configDir">, path: string): string {
  const rel = relative(config.configDir, path);
  return rel === "" ? "." : rel.split(sep).join("/");
}

/** Every file/directory the resolved config declares, in a stable order. */
export function declaredProjectFiles(config: ResolvedCircuitConfig): readonly DeclaredProjectFile[] {
  const files: DeclaredProjectFile[] = [
    { field: "evidence.bundlesRoot", path: config.evidence.bundlesRoot, kind: "directory" },
    { field: "evidence.inventory", path: config.evidence.inventory, kind: "file" },
    { field: "evidence.integrationRules", path: config.evidence.integrationRules, kind: "file" },
    { field: "evidence.directRouting", path: config.evidence.directRouting, kind: "file" },
    { field: "evidence.vendorQualifiers", path: config.evidence.vendorQualifiers, kind: "file" },
    { field: "publication.selection", path: config.publication.selection, kind: "file" },
    { field: "publication.assets", path: config.publication.assets, kind: "file" },
  ];
  const optional: [string, string | null][] = [
    ["evidence.forwardTests", config.evidence.forwardTests],
    ["docs.integrationGloss", config.docs.integrationGloss],
    ["validation.policy", config.validation.policy],
    ["publication.matrix", matrixOverridePath(config)],
  ];
  for (const [field, path] of optional) {
    if (path !== null) files.push({ field, path, kind: "file" });
  }
  if (config.inventoryProvider.kind === "led-generator-v1") {
    config.inventoryProvider.specs.forEach((spec, index) =>
      files.push({ field: `inventoryProvider.specs[${index}].path`, path: spec.path, kind: "file" }),
    );
  }
  if (config.cad.enabled) {
    config.cad.symbolLibraries.forEach((path, index) =>
      files.push({ field: `cad.symbolLibraries[${index}]`, path, kind: "file" }),
    );
    files.push(
      { field: "cad.footprintMasterRoot", path: config.cad.footprintMasterRoot, kind: "directory" },
      { field: "cad.footprintLibraryRoot", path: config.cad.footprintLibraryRoot, kind: "directory" },
      { field: "cad.modelRoot", path: config.cad.modelRoot, kind: "directory" },
    );
  }
  return files;
}

/** The declared files that are absent (or of the wrong kind). */
export async function missingProjectFiles(config: ResolvedCircuitConfig): Promise<readonly DeclaredProjectFile[]> {
  const missing: DeclaredProjectFile[] = [];
  for (const entry of declaredProjectFiles(config)) {
    const info = await stat(entry.path).catch(() => null);
    const ok = info !== null && (entry.kind === "file" ? info.isFile() : info.isDirectory());
    if (!ok) missing.push(entry);
  }
  return missing;
}

export async function mapCircuitConfig(config: ResolvedCircuitConfig): Promise<CircuitProjectMapping> {
  const missing = await missingProjectFiles(config);
  if (missing.length > 0) {
    fail("ADAPTER_CONTRACT", "declared project file is missing (an absent file is not an empty one)", {
      missing: missing.map((entry) => `${entry.field}: ${configRelative(config, entry.path)} (${entry.kind})`),
    });
  }

  const [selection, assets, matrix, gloss] = await Promise.all([
    readSelection(config),
    readAssets(config),
    readMatrix(config),
    readGloss(config),
  ]);

  const deniedOwnerSkillFields = (["record.ownerSkill", "integration.ownerSkill"] as const).filter(
    (field) => matrix.value[field] === "DENY",
  );
  if (config.docs.agentResources && deniedOwnerSkillFields.length > 0) {
    fail(
      "ADAPTER_CONTRACT",
      "docs.agentResources: true publishes /docs/claude-skills/<owner>/ and the owner-skill inventory, so owner-skill DENY cannot hold; set docs.agentResources: false or publish the denied field",
      { fields: deniedOwnerSkillFields, matrixSource: matrix.source },
    );
  }

  const generatedMarker = config.docs.generatedMarker ?? undefined;
  const render: PipelineRenderOptions = {
    agentResources: config.docs.agentResources,
    integrationDomainGloss: gloss,
    // `docs.generatedNotice` wins when set explicitly. Left unset, a project
    // that keeps a legacy marker is reproducing pre-extraction output
    // byte-for-byte (the LED fixture, ADR-011/ADR-020), which never carried
    // the notice — so the fallback infers it off from the marker.
    generatedNotice:
      config.docs.generatedNotice ?? (generatedMarker === undefined || !LEGACY_MARKERS.includes(generatedMarker)),
    ...(generatedMarker === undefined ? {} : { generatedMarker }),
  };

  return {
    config,
    paths: projectPathsFor(config),
    selection,
    matrix: matrix.value,
    matrixSource: matrix.source,
    assets,
    validatorInput: validatorInputFor(config),
    pythonMinVersion: parsePythonVersion(config.validation.pythonMinVersion),
    render,
    reference: referenceOptionsFor(config),
    integrationOwnerSkill: config.evidence.integrationSkill,
  };
}

/** The package validator for a mapped project (offline; never passes `--online`). */
export function createProjectValidator(
  mapping: Pick<CircuitProjectMapping, "validatorInput" | "pythonMinVersion">,
  env?: NodeJS.ProcessEnv,
): ValidationRunner {
  return createPackageValidator(mapping.validatorInput, { pythonMinVersion: mapping.pythonMinVersion, env });
}

export function projectPathsFor(config: ResolvedCircuitConfig): CircuitProjectPaths {
  // With CAD disabled the CAD roots are never read: a selected PCB-mounted
  // record fails the reference contract before any footprint/model lookup, and
  // zero packages publish nothing. They point at the data root so every key
  // stays a contained absolute path.
  const cad = config.cad.enabled
    ? config.cad
    : { footprintMasterRoot: config.root, footprintLibraryRoot: config.root, modelRoot: config.root };
  return Object.freeze({
    projectRoot: config.root,
    bundlesRoot: config.evidence.bundlesRoot,
    inventoryFile: config.evidence.inventory,
    integrationRulesFile: config.evidence.integrationRules,
    generatedRoot: config.docs.generatedContent,
    preflightFile: config.docs.preflight,
    distRoot: config.docs.dist,
    publicRoot: config.docs.publicRoot,
    footprintMasterRoot: cad.footprintMasterRoot,
    footprintLibraryRoot: cad.footprintLibraryRoot,
    modelRoot: cad.modelRoot,
    modelPublicRoot: resolve(config.docs.publicRoot, `.${MODEL_ASSET_BASE}`),
    footprintPreviewRoot: resolve(config.docs.publicRoot, `.${FOOTPRINT_ASSET_BASE}`),
  });
}

export function validatorInputFor(config: ResolvedCircuitConfig): ValidatorInput {
  const { evidence } = config;
  return {
    projectRoot: config.root,
    bundles: {
      root: evidence.bundlesRoot,
      ownerPrefix: evidence.ownerPrefix,
      // Skill dirs that happen to match the owner prefix are not owner bundles.
      reservedDirs: [evidence.auditSkill, evidence.integrationSkill].filter((name) =>
        name.startsWith(evidence.ownerPrefix),
      ),
      auditSkillDir: join(evidence.bundlesRoot, evidence.auditSkill),
      requireSkillMd: true,
    },
    inventory: {
      path: evidence.inventory,
      provider:
        config.inventoryProvider.kind === "manual"
          ? { kind: "manual" }
          : { kind: "led-generator-v1", specs: config.inventoryProvider.specs.map((spec) => ({ path: spec.path })) },
    },
    routing: { directRouting: evidence.directRouting, vendorQualifiers: evidence.vendorQualifiers },
    cad: config.cad.enabled
      ? {
          enabled: true,
          symbolLibraries: config.cad.symbolLibraries,
          footprintDirs: [config.cad.footprintMasterRoot],
        }
      : { enabled: false },
    integration: {
      rulesPath: evidence.integrationRules,
      forwardTests: evidence.forwardTests,
      integrationSkillDir: join(evidence.bundlesRoot, evidence.integrationSkill),
    },
    policy: { path: config.validation.policy },
    online: {
      tempRoot: evidence.sourceCache,
      ...(config.validation.userAgent === null ? {} : { userAgent: config.validation.userAgent }),
    },
    output: { json: false },
  };
}

export function referenceOptionsFor(config: ResolvedCircuitConfig): CircuitReferenceOptions {
  if (!config.cad.enabled) return { enabled: false };
  return {
    enabled: true,
    modelLocatorPrefix: config.cad.modelLocatorPrefix,
    footprintPathBase: config.cad.footprintPathBase,
    limits: config.cad.limits,
  };
}

// ---------------------------------------------------------------------------
// Declared JSON files

async function readDeclaredJson(config: ResolvedCircuitConfig, field: string, path: string): Promise<unknown> {
  const label = configRelative(config, path);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    fail("ADAPTER_CONTRACT", "cannot read declared project file", {
      field,
      path: label,
      reason: (error as Error).message,
    });
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail("ADAPTER_CONTRACT", "declared project file is not valid JSON", {
      field,
      path: label,
      reason: (error as Error).message,
    });
  }
}

function invalid(config: ResolvedCircuitConfig, field: string, path: string, problems: readonly string[]): never {
  fail("ADAPTER_CONTRACT", `${field} is malformed`, { path: configRelative(config, path), problems });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkKeys(
  value: Record<string, unknown>,
  where: string,
  required: readonly string[],
  optional: readonly string[],
  problems: string[],
): void {
  for (const key of required) if (!(key in value)) problems.push(`${where}${key}: is required`);
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) problems.push(`${where}${key}: unknown key`);
  }
}

function stringArray(value: unknown, where: string, problems: string[]): readonly string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry !== "")) {
    problems.push(`${where}: must be an array of non-empty strings`);
    return [];
  }
  if (new Set(value).size !== value.length) problems.push(`${where}: must not contain duplicates`);
  return value as string[];
}

function count(value: unknown, where: string, problems: string[]): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    problems.push(`${where}: must be a non-negative integer`);
    return 0;
  }
  return value as number;
}

/** `selection.json`: `{schema_version: 1, recordIds, sourceIds, linkableSourceIds, documentSelections, documentExceptions?, expect}`. */
export async function readSelection(config: ResolvedCircuitConfig): Promise<InstanceSelection> {
  const path = config.publication.selection;
  const data = await readDeclaredJson(config, "publication.selection", path);
  const problems: string[] = [];
  if (!isPlainObject(data)) invalid(config, "publication.selection", path, ["must be a JSON object"]);

  checkKeys(
    data,
    "",
    ["schema_version", "recordIds", "sourceIds", "linkableSourceIds", "documentSelections", "expect"],
    ["comment", "documentExceptions"],
    problems,
  );
  if ("schema_version" in data && data.schema_version !== SELECTION_SCHEMA_VERSION) {
    problems.push(`schema_version: must be ${SELECTION_SCHEMA_VERSION}`);
  }
  const recordIds = stringArray(data.recordIds ?? [], "recordIds", problems);
  const sourceIds = stringArray(data.sourceIds ?? [], "sourceIds", problems);
  const linkableSourceIds = stringArray(data.linkableSourceIds ?? [], "linkableSourceIds", problems);

  const documentSelections: InstanceSelection["documentSelections"][number][] = [];
  const rawDocuments = data.documentSelections ?? [];
  if (!Array.isArray(rawDocuments)) {
    problems.push("documentSelections: must be an array");
  } else {
    rawDocuments.forEach((entry: unknown, index) => {
      const where = `documentSelections[${index}]`;
      if (!isPlainObject(entry)) {
        problems.push(`${where}: must be an object`);
        return;
      }
      checkKeys(entry, `${where}.`, ["recordId", "sourceId", "documentKind"], [], problems);
      const { recordId, sourceId, documentKind } = entry;
      if ("recordId" in entry && (typeof recordId !== "string" || recordId === "")) {
        problems.push(`${where}.recordId: must be a non-empty string`);
      }
      if ("sourceId" in entry && (typeof sourceId !== "string" || sourceId === "")) {
        problems.push(`${where}.sourceId: must be a non-empty string`);
      }
      if ("documentKind" in entry && !DOCUMENT_KINDS.includes(documentKind as (typeof DOCUMENT_KINDS)[number])) {
        problems.push(`${where}.documentKind: must be one of ${DOCUMENT_KINDS.join(", ")}`);
      }
      documentSelections.push({
        recordId: String(recordId),
        sourceId: String(sourceId),
        documentKind: documentKind as (typeof DOCUMENT_KINDS)[number],
      });
    });
  }

  const documentExceptions = readDocumentExceptions(data.documentExceptions, problems);

  let expect: InstanceSelection["expect"] = { records: 0, sources: 0, integrationRules: 0, packages: 0 };
  if (!isPlainObject(data.expect)) {
    if ("expect" in data) problems.push("expect: must be an object");
  } else {
    checkKeys(data.expect, "expect.", ["records", "sources", "integrationRules", "packages"], [], problems);
    expect = {
      records: count(data.expect.records, "expect.records", problems),
      sources: count(data.expect.sources, "expect.sources", problems),
      integrationRules: count(data.expect.integrationRules, "expect.integrationRules", problems),
      packages: count(data.expect.packages, "expect.packages", problems),
    };
  }

  if (problems.length > 0) invalid(config, "publication.selection", path, problems);
  return { recordIds, sourceIds, linkableSourceIds, documentSelections, documentExceptions, expect };
}

function readDocumentExceptions(
  value: unknown,
  problems: string[],
): NonNullable<InstanceSelection["documentExceptions"]>[number][] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    problems.push("documentExceptions: must be an array");
    return [];
  }

  const exceptions: NonNullable<InstanceSelection["documentExceptions"]>[number][] = [];
  value.forEach((entry: unknown, index) => {
    const where = `documentExceptions[${index}]`;
    if (!isPlainObject(entry)) {
      problems.push(`${where}: must be an object`);
      return;
    }
    checkKeys(entry, `${where}.`, ["recordId", "reason"], [], problems);
    const { recordId, reason } = entry;
    if ("recordId" in entry && (typeof recordId !== "string" || recordId === "")) {
      problems.push(`${where}.recordId: must be a non-empty string`);
    }
    if ("reason" in entry && (typeof reason !== "string" || reason === "")) {
      problems.push(`${where}.reason: must be a non-empty string`);
    }
    if (typeof recordId === "string" && recordId !== "" && typeof reason === "string" && reason !== "") {
      exceptions.push({ recordId, reason });
    }
  });
  return exceptions;
}

/** `assets.json`: `{schema_version: 1, assets: [{path, reason, source_id?}]}`. */
export async function readAssets(config: ResolvedCircuitConfig): Promise<PublicationAssets> {
  const path = config.publication.assets;
  const data = await readDeclaredJson(config, "publication.assets", path);
  if (!isPlainObject(data)) invalid(config, "publication.assets", path, ["must be a JSON object"]);
  const problems: string[] = [];
  checkKeys(data, "", ["schema_version", "assets"], ["comment"], problems);
  if ("schema_version" in data && data.schema_version !== ASSETS_SCHEMA_VERSION) {
    problems.push(`schema_version: must be ${ASSETS_SCHEMA_VERSION}`);
  }
  const assets: PublicationAsset[] = [];
  if ("assets" in data && !Array.isArray(data.assets)) problems.push("assets: must be an array");
  for (const [index, entry] of (Array.isArray(data.assets) ? data.assets : []).entries()) {
    const where = `assets[${index}]`;
    if (!isPlainObject(entry)) {
      problems.push(`${where}: must be an object`);
      continue;
    }
    checkKeys(entry, `${where}.`, ["path", "reason"], ["source_id"], problems);
    const assetPath = entry.path;
    if (
      "path" in entry &&
      (typeof assetPath !== "string" || assetPath === "" || assetPath.startsWith("/") || assetPath.split("/").includes(".."))
    ) {
      problems.push(`${where}.path: must be a non-empty path relative to docs.publicRoot`);
    }
    if ("reason" in entry && (typeof entry.reason !== "string" || entry.reason.trim() === "")) {
      problems.push(`${where}.reason: must be a non-empty string`);
    }
    if ("source_id" in entry && (typeof entry.source_id !== "string" || entry.source_id === "")) {
      problems.push(`${where}.source_id: must be a non-empty string`);
    }
    assets.push({
      path: String(assetPath),
      reason: String(entry.reason),
      ...(typeof entry.source_id === "string" ? { source_id: entry.source_id } : {}),
    });
  }
  if (problems.length > 0) invalid(config, "publication.assets", path, problems);
  return { schema_version: ASSETS_SCHEMA_VERSION, assets };
}

/**
 * `publication.matrix` is either absent (the package preset), a preset name
 * (`"component-evidence-v1"`, which the config loader resolved like a path),
 * or a JSON file mapping every `FieldKey` to `"PUBLISH"`/`"DENY"`.
 */
function matrixOverridePath(config: ResolvedCircuitConfig): string | null {
  const path = config.publication.matrix;
  if (path === null) return null;
  return presetNamedBy(config, path) === null ? path : null;
}

function presetNamedBy(config: ResolvedCircuitConfig, path: string): string | null {
  const name = configRelative(config, path);
  return Object.hasOwn(CIRCUIT_PUBLICATION_MATRIX_PRESETS, name) ? name : null;
}

async function readMatrix(config: ResolvedCircuitConfig): Promise<{ value: PublicationMatrix; source: string }> {
  const path = config.publication.matrix;
  const preset = path === null ? DEFAULT_PUBLICATION_MATRIX_PRESET : presetNamedBy(config, path);
  if (preset !== null) {
    const value = CIRCUIT_PUBLICATION_MATRIX_PRESETS[preset];
    if (value === undefined) fail("ADAPTER_CONTRACT", `unknown publication matrix preset ${preset}`);
    return { value, source: `preset:${preset}` };
  }
  const override = path as string;
  const data = await readDeclaredJson(config, "publication.matrix", override);
  if (!isPlainObject(data)) invalid(config, "publication.matrix", override, ["must be a JSON object"]);
  const problems: string[] = [];
  const known = new Set<string>(FIELD_KEYS);
  for (const key of FIELD_KEYS) {
    const decision = data[key];
    if (decision !== "PUBLISH" && decision !== "DENY") problems.push(`${key}: must be "PUBLISH" or "DENY"`);
  }
  for (const key of Object.keys(data)) if (!known.has(key)) problems.push(`${key}: unknown field key`);
  if (problems.length > 0) invalid(config, "publication.matrix", override, problems);
  return {
    value: Object.fromEntries(FIELD_KEYS.map((key) => [key, data[key] as FieldDecision])) as PublicationMatrix,
    source: configRelative(config, override),
  };
}

async function readGloss(config: ResolvedCircuitConfig): Promise<Readonly<Record<string, string>>> {
  const path = config.docs.integrationGloss;
  if (path === null) return {};
  const data = await readDeclaredJson(config, "docs.integrationGloss", path);
  if (!isPlainObject(data)) invalid(config, "docs.integrationGloss", path, ["must be a JSON object {domain: text}"]);
  const problems = Object.entries(data)
    .filter(([, value]) => typeof value !== "string" || value.trim() === "")
    .map(([key]) => `${key}: must be a non-empty string`);
  if (problems.length > 0) invalid(config, "docs.integrationGloss", path, problems);
  return data as Record<string, string>;
}
