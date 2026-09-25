// Loads `circuit.config.ts` by native dynamic import (Node type stripping) and
// validates it. `fresh` appends a cache-busting query: Node caches ESM by URL,
// so `generate --watch` would otherwise keep seeing the first version.
import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { DEFAULT_CONFIG_FILENAME, type CircuitConfig } from "./define.ts";
import { ConfigError } from "./errors.ts";
import { validateCircuitConfig } from "./schema.ts";

/** First Node release with unflagged type stripping on the 22.x line. */
export const MIN_NODE_VERSION = "22.18.0";

const PACKAGE_NAME = "@takazudo/zudo-circuit-doc";
const IMPORT_TYPE_HINT =
  `use \`import type { CircuitConfig } from "${PACKAGE_NAME}/config"\` with \`satisfies CircuitConfig\`; ` +
  `values from ${PACKAGE_NAME} are not available while the config loads`;
const MODULE_TYPE_HINT =
  'circuit.config.ts is an ES module: set "type": "module" in the project package.json next to it';

export type LoadCircuitConfigOptions = {
  readonly cwd: string;
  /** Relative to `cwd`; default `<cwd>/circuit.config.ts`. */
  readonly configPath?: string;
  /** Bypass Node's ESM cache (watch mode). */
  readonly fresh?: boolean;
};

export type LoadedCircuitConfig = {
  readonly config: CircuitConfig;
  /** Absolute path of the config file. */
  readonly configPath: string;
  /** Absolute directory every config path is relative to. */
  readonly configDir: string;
};

let freshCounter = 0;

export function assertSupportedNodeVersion(version: string = process.versions.node): void {
  if (compareVersions(version, MIN_NODE_VERSION) >= 0) return;
  throw new ConfigError(
    "NODE_VERSION_UNSUPPORTED",
    [{ path: "", message: `Node ${version} cannot load circuit.config.ts; Node >= ${MIN_NODE_VERSION} is required` }],
    { hint: `upgrade to Node ${MIN_NODE_VERSION} or newer (native TypeScript type stripping)` },
  );
}

export async function loadCircuitConfig(options: LoadCircuitConfigOptions): Promise<LoadedCircuitConfig> {
  assertSupportedNodeVersion();
  const configPath = resolve(options.cwd, options.configPath ?? DEFAULT_CONFIG_FILENAME);

  let mtimeMs: number;
  try {
    const info = await stat(configPath);
    if (!info.isFile()) throw new Error("not a file");
    mtimeMs = info.mtimeMs;
  } catch (cause) {
    throw new ConfigError("CONFIG_NOT_FOUND", [{ path: "", message: `config file not found: ${configPath}` }], {
      configPath,
      cause,
    });
  }

  let url = pathToFileURL(configPath).href;
  if (options.fresh === true) {
    freshCounter += 1;
    url += `?v=${Math.trunc(mtimeMs)}-${freshCounter}`;
  }

  let module: Record<string, unknown>;
  try {
    module = (await import(url)) as Record<string, unknown>;
  } catch (cause) {
    throw mapLoadError(cause, configPath);
  }

  if (!("default" in module) || module.default === undefined) {
    throw new ConfigError("CONFIG_INVALID", [{ path: "", message: "the config file has no default export" }], {
      configPath,
      hint: "export the config object with `export default { … } satisfies CircuitConfig;`",
    });
  }
  const config = validateCircuitConfig(module.default, { configPath });
  return { config, configPath, configDir: dirname(configPath) };
}

export function mapLoadError(cause: unknown, configPath: string): ConfigError {
  const message = cause instanceof Error ? cause.message : String(cause);
  const code = typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;

  let hint: string | undefined;
  if (message.includes("does not provide an export named")) {
    hint = IMPORT_TYPE_HINT;
  } else if (code === "ERR_MODULE_NOT_FOUND" && message.includes(`'${PACKAGE_NAME}'`)) {
    hint = IMPORT_TYPE_HINT;
  } else if (
    message.includes("Cannot use import statement outside a module") ||
    message.includes("Unexpected token 'export'") ||
    code === "ERR_REQUIRE_ESM"
  ) {
    hint = MODULE_TYPE_HINT;
  }
  return new ConfigError("CONFIG_LOAD_FAILED", [{ path: "", message: `failed to load: ${message}` }], {
    configPath,
    hint,
    cause,
  });
}

function compareVersions(a: string, b: string): number {
  const parse = (version: string) => version.replace(/^v/u, "").split(/[.-]/u).slice(0, 3).map(Number);
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
