/**
 * The canonical validator, run as a subprocess.
 *
 * This is the ONLY validation of component evidence. Nothing in TypeScript
 * re-implements any part of the frozen contract — a weaker second validator
 * that disagreed with the Python one would be worse than none, because the
 * projection would look validated while enforcing different rules.
 *
 * Invocation rules:
 *   - argument ARRAY, never a shell string: no quoting, no interpolation, no
 *     `shell: true`;
 *   - script path and cwd are always supplied by the caller: a package has no
 *     way to guess where a project keeps its validator;
 *   - `--online` is never passed: generation must work with no network, and
 *     the online mode mutates retained evidence.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ValidationOutcome, ValidationRunner } from "../../core/adapter.ts";

const execFileAsync = promisify(execFile);

export type PythonVersion = { readonly major: number; readonly minor: number };

/**
 * Upstream's minimum interpreter: the version its CI pinned. Kept as the
 * `minVersion` default so the extraction is behavior-identical; the validator
 * runner issue sets the configured floor.
 */
export const REQUIRED_PYTHON: PythonVersion = { major: 3, minor: 12 };

export type PythonValidatorOptions = {
  readonly pythonBin?: string;
  readonly scriptPath: string;
  readonly cwd: string;
  /** Extra arguments after the script path. Never a shell string. */
  readonly args?: readonly string[];
  /** Replaces the child environment when given (default: inherit). */
  readonly env?: NodeJS.ProcessEnv;
  readonly minVersion?: PythonVersion;
};

export function createPythonValidator(options: PythonValidatorOptions): ValidationRunner {
  const pythonBin = options.pythonBin ?? process.env.COMPONENT_DOCS_PYTHON ?? "python3";
  const { scriptPath, cwd, env } = options;
  const args = [scriptPath, ...(options.args ?? [])];
  const minVersion = options.minVersion ?? REQUIRED_PYTHON;

  return async (): Promise<ValidationOutcome> => {
    const versionCheck = await assertPythonVersion(pythonBin, cwd, minVersion, env);
    if (versionCheck) return versionCheck;

    const command = [pythonBin, ...args];
    try {
      const { stdout, stderr } = await execFileAsync(pythonBin, args, {
        cwd,
        env,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      });
      return { ok: true, command, exitCode: 0, stdout, stderr };
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {
        code?: number | string;
        stdout?: string;
        stderr?: string;
      };
      return {
        ok: false,
        command,
        exitCode: typeof failure.code === "number" ? failure.code : 1,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? String(failure.message ?? failure),
      };
    }
  };
}

/** Returns a failed outcome when the interpreter is missing or too old, else `null`. */
async function assertPythonVersion(
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
      stderr: `cannot run ${pythonBin}: ${(error as Error).message}`,
    };
  }

  // Python 2 printed the version to stderr; accept either stream.
  const match = /Python (\d+)\.(\d+)/u.exec(`${stdout}${stderr}`);
  if (!match) {
    return { ok: false, command, exitCode: 1, stdout, stderr: `unrecognised: ${stdout}${stderr}` };
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const tooOld =
    major < minVersion.major || (major === minVersion.major && minor < minVersion.minor);

  if (tooOld) {
    return {
      ok: false,
      command,
      exitCode: 1,
      stdout,
      stderr:
        `${pythonBin} is ${major}.${minor}; component evidence requires ` +
        `>= ${minVersion.major}.${minVersion.minor} (set COMPONENT_DOCS_PYTHON to override the interpreter)`,
    };
  }

  return null;
}
