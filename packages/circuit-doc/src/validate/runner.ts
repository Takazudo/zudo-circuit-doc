/**
 * The canonical validator, run as a subprocess against the packaged
 * `circuit_validate.py` (ADR-007).
 *
 * Transport: the resolved-config JSON is piped on stdin (`--config -`) by
 * default. No fixed path is ever written under the project — `generate
 * --watch` and `check` can run concurrently, and the LED fixture tree is
 * hash-locked — so a caller that has a proven reason to prefer a file gets one
 * created with `mkdtemp` under the OS temp directory and removed in a
 * `finally`, never a fixed name.
 *
 * `--online` is never passed unless the caller explicitly asks for it
 * (`runValidateCommand({ online: true })`); `createPackageValidator` alone
 * never adds it, so a plain build/generate run is always offline.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ValidationOutcome, ValidationRunner } from "../core/adapter.ts";
import type { PythonVersion } from "../provider/v1/validate.ts";
import {
  assertPythonVersion,
  DEFAULT_VALIDATOR_PYTHON_MIN_VERSION,
  requirePackagedValidatorScript,
  resolvePythonBin,
} from "./python.ts";
import {
  buildResolvedValidatorConfig,
  type ResolvedValidatorConfig,
  type ValidatorInput,
} from "./resolved-config.ts";

const execFileAsync = promisify(execFile);
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const TEMP_FILE_PREFIX = "zcd-validate-";

export type ValidatorTransport = "stdin" | "tempfile";

export type CreatePackageValidatorOptions = {
  /** Config `validation.python?.bin`; overridden by `CIRCUIT_DOC_PYTHON`/`COMPONENT_DOCS_PYTHON`. */
  readonly pythonBin?: string;
  readonly pythonMinVersion?: PythonVersion;
  /** Extra CLI args after `--config <transport>`. Never `--online`/`--refresh-source` unless the caller builds them explicitly. */
  readonly extraArgs?: readonly string[];
  /** Replaces the child environment when given (default: inherit + `PYTHONDONTWRITEBYTECODE=1`). */
  readonly env?: NodeJS.ProcessEnv;
  /** `"stdin"` (default) pipes the JSON; `"tempfile"` writes a unique `mkdtemp` file, deleted in a `finally`. */
  readonly transport?: ValidatorTransport;
};

/** The core `ValidationRunner` seam, backed by the packaged Python validator. */
export function createPackageValidator(
  input: ValidatorInput,
  opts: CreatePackageValidatorOptions = {},
): ValidationRunner {
  const resolved = buildResolvedValidatorConfig(input);
  return () => runResolvedConfig(resolved, opts.extraArgs ?? [], opts);
}

async function runResolvedConfig(
  resolved: ResolvedValidatorConfig,
  extraArgs: readonly string[],
  opts: CreatePackageValidatorOptions,
): Promise<ValidationOutcome> {
  const pythonBin = resolvePythonBin(opts.pythonBin, opts.env ?? process.env);
  const minVersion = opts.pythonMinVersion ?? DEFAULT_VALIDATOR_PYTHON_MIN_VERSION;
  const cwd = resolved.projectRoot;
  const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env), PYTHONDONTWRITEBYTECODE: "1" };

  const versionFailure = await assertPythonVersion(pythonBin, cwd, minVersion, env);
  if (versionFailure) return versionFailure;

  let script: string;
  try {
    script = requirePackagedValidatorScript();
  } catch (error) {
    return {
      ok: false,
      command: [pythonBin],
      exitCode: 127,
      stdout: "",
      stderr: (error as Error).message,
    };
  }

  const json = JSON.stringify(resolved);
  const transport = opts.transport ?? "stdin";
  return transport === "tempfile"
    ? runWithTempFile(pythonBin, script, json, cwd, env, extraArgs)
    : runWithStdin(pythonBin, script, json, cwd, env, extraArgs);
}

async function runWithStdin(
  pythonBin: string,
  script: string,
  json: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  extraArgs: readonly string[],
): Promise<ValidationOutcome> {
  const args = ["-B", script, "--config", "-", ...extraArgs];
  const command = [pythonBin, ...args];
  try {
    const invocation = execFileAsync(pythonBin, args, {
      cwd,
      env,
      maxBuffer: MAX_BUFFER_BYTES,
      windowsHide: true,
    });
    // `child_process.execFile`'s custom `util.promisify` attaches the live
    // `ChildProcess` as `.child` on the returned promise (Node docs), so the
    // config can be written to stdin without a second process handle.
    invocation.child.stdin?.end(json);
    const { stdout, stderr } = await invocation;
    return { ok: true, command, exitCode: 0, stdout, stderr };
  } catch (error) {
    return outcomeFromExecError(command, error);
  }
}

async function runWithTempFile(
  pythonBin: string,
  script: string,
  json: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  extraArgs: readonly string[],
): Promise<ValidationOutcome> {
  const dir = await mkdtemp(join(tmpdir(), TEMP_FILE_PREFIX));
  const configPath = join(dir, "config.json");
  try {
    await writeFile(configPath, json, "utf8");
    const args = ["-B", script, "--config", configPath, ...extraArgs];
    const command = [pythonBin, ...args];
    try {
      const { stdout, stderr } = await execFileAsync(pythonBin, args, {
        cwd,
        env,
        maxBuffer: MAX_BUFFER_BYTES,
        windowsHide: true,
      });
      return { ok: true, command, exitCode: 0, stdout, stderr };
    } catch (error) {
      return outcomeFromExecError(command, error);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function outcomeFromExecError(command: readonly string[], error: unknown): ValidationOutcome {
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

export type RunValidateCommandOptions = {
  readonly online?: boolean;
  readonly refreshSources?: readonly string[];
  readonly json?: boolean;
  readonly pythonBin?: string;
  readonly pythonMinVersion?: PythonVersion;
  readonly env?: NodeJS.ProcessEnv;
  readonly transport?: ValidatorTransport;
  /** Defaults to `process.stdout`/`process.stderr`; overridable for tests. */
  readonly stdout?: Pick<NodeJS.WritableStream, "write">;
  readonly stderr?: Pick<NodeJS.WritableStream, "write">;
};

/**
 * The CLI `validate` subcommand's implementation (#18): streams the
 * validator's stdout/stderr and maps its exit code, 0 -> 0, 1 -> 1, 2 -> 2. Any
 * other outcome (the interpreter/script gate, exit 127) is reported as a
 * check failure (1), never a silent pass.
 */
export async function runValidateCommand(
  input: ValidatorInput,
  options: RunValidateCommandOptions = {},
): Promise<number> {
  const extraArgs: string[] = [];
  if (options.online === true) extraArgs.push("--online");
  for (const sourceId of options.refreshSources ?? []) extraArgs.push("--refresh-source", sourceId);
  if (options.json === true) extraArgs.push("--json");

  const validator = createPackageValidator(input, {
    extraArgs,
    pythonBin: options.pythonBin,
    pythonMinVersion: options.pythonMinVersion,
    env: options.env,
    transport: options.transport,
  });
  const outcome = await validator();

  const out = options.stdout ?? process.stdout;
  const err = options.stderr ?? process.stderr;
  if (outcome.stdout !== "") out.write(outcome.stdout);
  if (outcome.stderr !== "") err.write(outcome.stderr);

  if (outcome.ok) return 0;
  return outcome.exitCode === 2 ? 2 : 1;
}
