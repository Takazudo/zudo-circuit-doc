// Strict, hand-written validation of `circuit.config.ts` (zod is not in the
// peer set). It collects every issue with its field path instead of stopping
// at the first one. Path checks are lexical only: existence is checked by the
// adapter/CLI, so that "absent file" and "empty file" stay distinguishable in
// one place.
import { posix } from "node:path";

import {
  CONFIG_VERSION,
  EVIDENCE_CONTRACT_VERSION,
  INVENTORY_PROVIDER_KINDS,
  type CircuitConfig,
} from "./define.ts";
import { ConfigError, type ConfigIssue } from "./errors.ts";

type Check = (value: unknown, path: string, issues: ConfigIssue[]) => void;
type Field = { readonly required: boolean; readonly check: Check };
type Shape = Readonly<Record<string, Field>>;

const MIN_PYTHON_VERSION: readonly [number, number] = [3, 10];

/** Returns why `value` is not an acceptable config-relative path, or `undefined` when it is. */
export function configPathProblem(value: unknown): string | undefined {
  if (typeof value !== "string") return `must be a string path (got ${describe(value)})`;
  if (value === "") return "must not be empty";
  if (value.includes("\0")) return "must not contain NUL";
  if (value.includes("\\")) return "must use forward slashes";
  if (value.startsWith("/") || /^[A-Za-z]:/u.test(value)) {
    return "must be relative to the config file's directory, not absolute";
  }
  const normalized = posix.normalize(value);
  if (normalized === ".." || normalized.startsWith("../")) {
    return "must stay inside the config file's directory (`..` escape)";
  }
  return undefined;
}

export function collectCircuitConfigIssues(value: unknown): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  object(CIRCUIT_CONFIG_SHAPE)(value, "", issues);
  return issues;
}

export function validateCircuitConfig(value: unknown, options: { configPath?: string } = {}): CircuitConfig {
  const issues = collectCircuitConfigIssues(value);
  if (issues.length > 0) {
    throw new ConfigError("CONFIG_INVALID", issues, { configPath: options.configPath });
  }
  return value as CircuitConfig;
}

// ---------------------------------------------------------------------------
// Primitive checks

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return typeof value;
}

function join(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function required(check: Check): Field {
  return { required: true, check };
}

function optional(check: Check): Field {
  return { required: false, check };
}

function object(shape: Shape): Check {
  return (value, path, issues) => {
    if (!isPlainObject(value)) {
      issues.push({ path, message: `must be an object (got ${describe(value)})` });
      return;
    }
    for (const [key, field] of Object.entries(shape)) {
      const child = value[key];
      if (child === undefined) {
        if (field.required) issues.push({ path: join(path, key), message: "is required" });
        continue;
      }
      field.check(child, join(path, key), issues);
    }
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(shape, key)) {
        issues.push({
          path: join(path, key),
          message: `unknown key (allowed: ${Object.keys(shape).join(", ")})`,
        });
      }
    }
  };
}

function literal(expected: number): Check {
  return (value, path, issues) => {
    if (value !== expected) issues.push({ path, message: `must be ${expected} (got ${describe(value)})` });
  };
}

const text: Check = (value, path, issues) => {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push({ path, message: `must be a non-empty string (got ${describe(value)})` });
  }
};

const singleLineText: Check = (value, path, issues) => {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/u.test(value)) {
    issues.push({ path, message: `must be a non-empty single-line string (got ${describe(value)})` });
  }
};

const segment: Check = (value, path, issues) => {
  if (typeof value !== "string" || value === "" || value === "." || value === ".." || /[/\\\0]/u.test(value)) {
    issues.push({ path, message: `must be a single directory name (got ${describe(value)})` });
  }
};

const boolean: Check = (value, path, issues) => {
  if (typeof value !== "boolean") issues.push({ path, message: `must be a boolean (got ${describe(value)})` });
};

const nonNegativeInteger: Check = (value, path, issues) => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    issues.push({ path, message: `must be a non-negative integer (got ${describe(value)})` });
  }
};

const positiveInteger: Check = (value, path, issues) => {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    issues.push({ path, message: `must be a positive integer (got ${describe(value)})` });
  }
};

const configPath: Check = (value, path, issues) => {
  const problem = configPathProblem(value);
  if (problem !== undefined) issues.push({ path, message: problem });
};

const route: Check = (value, path, issues) => {
  if (typeof value !== "string" || !value.startsWith("/") || /\s/u.test(value)) {
    issues.push({ path, message: `must be a site route starting with "/" (got ${describe(value)})` });
  }
};

function nullable(check: Check): Check {
  return (value, path, issues) => {
    if (value !== null) check(value, path, issues);
  };
}

function array(item: Check, options: { nonEmpty?: boolean } = {}): Check {
  return (value, path, issues) => {
    if (!Array.isArray(value)) {
      issues.push({ path, message: `must be an array (got ${describe(value)})` });
      return;
    }
    if (options.nonEmpty === true && value.length === 0) {
      issues.push({ path, message: "must not be empty" });
    }
    value.forEach((entry, index) => item(entry, `${path}[${index}]`, issues));
  };
}

const pythonVersion: Check = (value, path, issues) => {
  const match = typeof value === "string" ? /^(\d+)\.(\d+)$/u.exec(value) : null;
  if (match === null) {
    issues.push({ path, message: `must be a "MAJOR.MINOR" version string (got ${describe(value)})` });
    return;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const [floorMajor, floorMinor] = MIN_PYTHON_VERSION;
  if (major < floorMajor || (major === floorMajor && minor < floorMinor)) {
    issues.push({ path, message: `must be at least ${floorMajor}.${floorMinor} (got ${describe(value)})` });
  }
};

// ---------------------------------------------------------------------------
// Sections

const PROJECT_SHAPE: Shape = {
  name: required(text),
  title: required(text),
};

const DOCS_SHAPE: Shape = {
  root: required(configPath),
  generatedContent: required(configPath),
  preflight: required(configPath),
  publicRoot: required(configPath),
  dist: required(configPath),
  agentResources: optional(boolean),
  generatedMarker: optional(singleLineText),
  integrationGloss: optional(configPath),
};

const EVIDENCE_SHAPE: Shape = {
  contractVersion: required(literal(EVIDENCE_CONTRACT_VERSION)),
  bundlesRoot: required(configPath),
  ownerPrefix: required(segment),
  auditSkill: required(segment),
  integrationSkill: required(segment),
  inventory: required(configPath),
  integrationRules: required(configPath),
  directRouting: required(configPath),
  vendorQualifiers: required(configPath),
  forwardTests: optional(nullable(configPath)),
  sourceCache: required(configPath),
};

const MANUAL_PROVIDER_SHAPE: Shape = {
  kind: required(() => {}),
};

const LED_GENERATOR_PROVIDER_SHAPE: Shape = {
  kind: required(() => {}),
  specs: required(array(object({ path: required(configPath) }), { nonEmpty: true })),
};

const inventoryProvider: Check = (value, path, issues) => {
  if (!isPlainObject(value)) {
    issues.push({ path, message: `must be an object (got ${describe(value)})` });
    return;
  }
  switch (value.kind) {
    case "manual":
      object(MANUAL_PROVIDER_SHAPE)(value, path, issues);
      return;
    case "led-generator-v1":
      object(LED_GENERATOR_PROVIDER_SHAPE)(value, path, issues);
      return;
    default:
      issues.push({
        path: join(path, "kind"),
        message:
          value.kind === undefined
            ? `is required (one of: ${INVENTORY_PROVIDER_KINDS.join(", ")})`
            : `must be a registered inventory provider kind (one of: ${INVENTORY_PROVIDER_KINDS.join(", ")}; got ${describe(value.kind)})`,
      });
  }
};

const PUBLICATION_SHAPE: Shape = {
  selection: required(configPath),
  assets: required(configPath),
  matrix: optional(configPath),
};

const PREVIEW_RENDERER_SHAPE: Shape = {
  image: required(text),
  version: required(text),
  platform: required(text),
  layers: required(array(text, { nonEmpty: true })),
  theme: required(text),
  options: required(array(text)),
};

const LIMITS_SHAPE: Shape = {
  footprintBytes: optional(positiveInteger),
  modelBytes: optional(positiveInteger),
  aggregateModelBytes: optional(positiveInteger),
};

const CAD_DISABLED_SHAPE: Shape = {
  enabled: required(boolean),
  libraryName: optional(text),
};

const CAD_ENABLED_SHAPE: Shape = {
  enabled: required(boolean),
  libraryName: required(text),
  symbolLibraries: required(array(configPath, { nonEmpty: true })),
  footprintMasterRoot: required(configPath),
  footprintLibraryRoot: required(configPath),
  modelRoot: required(configPath),
  modelLocatorPrefix: required(text),
  footprintPathBase: optional(configPath),
  previewRenderer: required(object(PREVIEW_RENDERER_SHAPE)),
  limits: optional(object(LIMITS_SHAPE)),
};

const cad: Check = (value, path, issues) => {
  if (!isPlainObject(value)) {
    issues.push({ path, message: `must be an object (got ${describe(value)})` });
    return;
  }
  if (value.enabled === true) {
    object(CAD_ENABLED_SHAPE)(value, path, issues);
  } else if (value.enabled === false) {
    object(CAD_DISABLED_SHAPE)(value, path, issues);
  } else {
    issues.push({
      path: join(path, "enabled"),
      message: value.enabled === undefined ? "is required" : `must be a boolean (got ${describe(value.enabled)})`,
    });
  }
};

const VALIDATION_SHAPE: Shape = {
  pythonMinVersion: optional(pythonVersion),
  policy: optional(nullable(configPath)),
  userAgent: optional(singleLineText),
};

const SCAN_SHAPE: Shape = {
  minimumOwnedCanaries: optional(nonNegativeInteger),
  minimumOwnedFiles: optional(nonNegativeInteger),
  minimumSiteCanaries: optional(nonNegativeInteger),
  minimumSiteFiles: optional(nonNegativeInteger),
  expectedWithheld: optional(nonNegativeInteger),
  positiveControlRecord: optional(nullable(text)),
};

const BROWSER_SMOKE_SHAPE: Shape = {
  representatives: required(
    array(
      object({
        kind: required(text),
        path: required(route),
        slug: required(segment),
        identity: required(text),
        availability: optional(text),
      }),
    ),
  ),
};

const CIRCUIT_CONFIG_SHAPE: Shape = {
  configVersion: required(literal(CONFIG_VERSION)),
  root: optional(configPath),
  project: required(object(PROJECT_SHAPE)),
  docs: required(object(DOCS_SHAPE)),
  evidence: required(object(EVIDENCE_SHAPE)),
  inventoryProvider: required(inventoryProvider),
  publication: required(object(PUBLICATION_SHAPE)),
  cad: required(cad),
  validation: optional(object(VALIDATION_SHAPE)),
  scan: optional(object(SCAN_SHAPE)),
  browserSmoke: optional(object(BROWSER_SMOKE_SHAPE)),
};
