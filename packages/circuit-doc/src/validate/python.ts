/**
 * Package-owned validator resources: locating the packaged `circuit_validate.py`
 * and selecting + version-gating the Python interpreter that runs it.
 *
 * No project data is ever located from here — only the package's own script
 * path and environment/config-supplied interpreter choices. `runner.ts` is the
 * only caller.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { ValidationOutcome } from "../core/adapter.ts";
// The provider's own Python validator (#11) already defines this shape; reused
// here rather than redeclared (and NOT re-exported), so the two modules don't
// both export an ambiguous `PythonVersion` through the root barrel's `export *`.
import type { PythonVersion } from "../provider/v1/validate.ts";

const execFileAsync = promisify(execFile);

/**
 * `circuit.config.ts` `validation.pythonMinVersion` default (ADR-019), as a
 * parsed `{major, minor}` (`config/define.ts` exports the same default as the
 * unparsed `"3.10"` string under a different subpath, `./config`).
 */
export const DEFAULT_VALIDATOR_PYTHON_MIN_VERSION: PythonVersion = { major: 3, minor: 10 };

/** Parses a `circuit.config.ts` `"MAJOR.MINOR"` string, e.g. the config-resolved `validation.pythonMinVersion`. */
export function parsePythonVersion(majorDotMinor: string): PythonVersion {
  const match = /^(\d+)\.(\d+)$/u.exec(majorDotMinor);
  if (match === null) {
    throw new Error(`not a "MAJOR.MINOR" python version: ${majorDotMinor}`);
  }
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/**
 * `<pkg>/python/circuit_validate.py`. The relative depth matches the dist
 * layout: `tsconfig.build.json` mirrors `rootDir: src` into `outDir: dist`
 * 1:1, so this file's `import.meta.url` sits at the same depth under `src/`
 * (native type stripping) and under the built `dist/`.
 */
export function packagedValidatorScriptPath(): string {
  return fileURLToPath(new URL("../../python/circuit_validate.py", import.meta.url));
}

/**
 * Locate the packaged script, asserting it exists. A missing file means a
 * broken tarball or an incomplete `files` list — never a project mistake — so
 * this throws a plain `Error` rather than a `ComponentDocsError`: the caller
 * (`runner.ts`) turns it into a failed `ValidationOutcome` before it ever
 * reaches `runPipeline`.
 */
export function requirePackagedValidatorScript(): string {
  const path = packagedValidatorScriptPath();
  if (!existsSync(path)) {
    throw new Error(
      `packaged validator script is missing: ${path} (a broken @takazudo/zudo-circuit-doc install)`,
    );
  }
  return path;
}

/**
 * Interpreter precedence: `CIRCUIT_DOC_PYTHON`, then the legacy
 * `COMPONENT_DOCS_PYTHON` (upstream's variable name), then the caller-supplied
 * (config `validation.python?.bin`) binary, then `python3`.
 */
export function resolvePythonBin(
  configuredBin: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.CIRCUIT_DOC_PYTHON || env.COMPONENT_DOCS_PYTHON || configuredBin || "python3";
}

function isAtLeast(actual: PythonVersion, floor: PythonVersion): boolean {
  return actual.major > floor.major || (actual.major === floor.major && actual.minor >= floor.minor);
}

function versionGateMessage(pythonBin: string, found: string, minVersion: PythonVersion): string {
  return (
    `Python >= ${minVersion.major}.${minVersion.minor} is required for canonical evidence ` +
    `validation (found ${found} at ${pythonBin}); set CIRCUIT_DOC_PYTHON`
  );
}

/**
 * Returns a failed `ValidationOutcome` (exit code 127, "command not found" in
 * spirit) when the interpreter cannot be run, cannot be parsed, or is older
 * than `minVersion`; `null` when it clears the gate.
 */
export async function assertPythonVersion(
  pythonBin: string,
  cwd: string,
  minVersion: PythonVersion,
  env: NodeJS.ProcessEnv | undefined,
): Promise<ValidationOutcome | null> {
  const command = [pythonBin, "--version"];
  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync(pythonBin, ["--version"], { cwd, env, windowsHide: true });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    return {
      ok: false,
      command,
      exitCode: 127,
      stdout: "",
      stderr: `${versionGateMessage(pythonBin, "no interpreter", minVersion)} (${(error as Error).message})`,
    };
  }

  // Python 2 printed the version to stderr; accept either stream.
  const match = /Python (\d+)\.(\d+)/u.exec(`${stdout}${stderr}`);
  if (match === null) {
    return {
      ok: false,
      command,
      exitCode: 127,
      stdout,
      stderr: versionGateMessage(pythonBin, `unrecognised (${stdout}${stderr})`.trim(), minVersion),
    };
  }

  const found: PythonVersion = { major: Number(match[1]), minor: Number(match[2]) };
  if (!isAtLeast(found, minVersion)) {
    return {
      ok: false,
      command,
      exitCode: 127,
      stdout,
      stderr: versionGateMessage(pythonBin, `${found.major}.${found.minor}`, minVersion),
    };
  }
  return null;
}
