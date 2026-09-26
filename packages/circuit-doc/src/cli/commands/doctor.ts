/**
 * `zudo-circuit-doc doctor`: a capability table. Exit 0 unless a REQUIRED item
 * fails; optional tools (Docker + the pinned KiCad image, Chrome,
 * easyeda2kicad) are reported with an install hint and never fail the run.
 */

import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

import { DEFAULT_PYTHON_MIN_VERSION } from "../../config/define.ts";
import { ConfigError } from "../../config/errors.ts";
import { loadCircuitConfig } from "../../config/load.ts";
import { configRelative, mapCircuitConfig, missingProjectFiles } from "../../config/map.ts";
import { resolveCircuitConfig, type ResolvedCircuitConfig } from "../../config/resolve.ts";
import { resolvePythonBin } from "../../validate/python.ts";
import { EXIT, type CommandContext, type CommandModule } from "../command.ts";
import { packageInfo } from "../package-info.ts";
import { errorMessage } from "../watch.ts";

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 15_000;
const CHROME_NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];

export type DoctorLevel = "required" | "optional" | "info";
export type DoctorStatus = "ok" | "FAIL" | "missing" | "n/a";

export type DoctorRow = {
  readonly name: string;
  readonly level: DoctorLevel;
  readonly status: DoctorStatus;
  readonly detail: string;
};

export const command: CommandModule = {
  meta: {
    name: "doctor",
    summary: "report required and optional tools, config validity and required files",
    exitCodes: [
      { code: EXIT.PASS, meaning: "every required item is present (optional tools may be missing)" },
      { code: EXIT.FAILED, meaning: "a required item failed" },
      { code: EXIT.USAGE, meaning: "usage error" },
    ],
  },
  run,
};

async function run(context: CommandContext): Promise<number> {
  const rows = await collectDoctorRows(context);
  context.io.stdout.write(renderDoctorTable(rows));
  const failed = rows.filter((row) => row.level === "required" && row.status !== "ok");
  context.io.stdout.write(
    failed.length === 0
      ? "doctor: every required item is present\n"
      : `doctor: ${failed.length} required item(s) failed: ${failed.map((row) => row.name).join(", ")}\n`,
  );
  return failed.length === 0 ? EXIT.PASS : EXIT.FAILED;
}

export function renderDoctorTable(rows: readonly DoctorRow[]): string {
  const header = { name: "ITEM", level: "LEVEL", status: "STATUS", detail: "DETAIL" };
  const all = [header, ...rows];
  const width = (key: "name" | "level" | "status") => Math.max(...all.map((row) => row[key].length)) + 2;
  const [nameWidth, levelWidth, statusWidth] = [width("name"), width("level"), width("status")];
  return `${all
    .map((row) =>
      `${row.name.padEnd(nameWidth)}${row.level.padEnd(levelWidth)}${row.status.padEnd(statusWidth)}${row.detail}`.trimEnd(),
    )
    .join("\n")}\n`;
}

export async function collectDoctorRows(context: CommandContext): Promise<readonly DoctorRow[]> {
  const { io } = context;
  const rows: DoctorRow[] = [nodeRow()];

  let config: ResolvedCircuitConfig | null = null;
  try {
    const loaded = await loadCircuitConfig({ cwd: io.cwd, configPath: context.configPath });
    config = resolveCircuitConfig(loaded.config, loaded.configDir);
    rows.push({ name: "config", level: "required", status: "ok", detail: configRelative(config, loaded.configPath) });
  } catch (error) {
    const detail =
      error instanceof ConfigError
        ? `${error.code}: ${error.errors.map((issue) => `${issue.path || "<root>"} ${issue.message}`).join("; ")}`
        : errorMessage(error);
    rows.push({ name: "config", level: "required", status: "FAIL", detail });
  }
  rows.push(await filesRow(config));
  rows.push(await pythonRow(config, io.cwd, io.env));

  const docker = await which("docker", io.env);
  rows.push(
    docker === null
      ? { name: "docker", level: "optional", status: "missing", detail: "install Docker (needed only for `footprints generate`)" }
      : { name: "docker", level: "optional", status: "ok", detail: docker },
  );
  rows.push(await kicadImageRow(config, docker, io.env));
  rows.push(await chromeRow(io.env));
  const easyeda = await which("easyeda2kicad", io.env);
  rows.push(
    easyeda === null
      ? {
          name: "easyeda2kicad",
          level: "optional",
          status: "missing",
          detail: "`pipx install easyeda2kicad` (optional helper for importing LCSC CAD)",
        }
      : { name: "easyeda2kicad", level: "optional", status: "ok", detail: easyeda },
  );
  rows.push(await gitRow(config?.configDir ?? io.cwd, io.env));
  return rows;
}

function nodeRow(): DoctorRow {
  const range = packageInfo().engines.node ?? "";
  const floor = /^>=\s*(\d+(?:\.\d+){0,2})$/u.exec(range.trim())?.[1];
  const version = process.versions.node;
  const ok = floor === undefined || compareVersions(version, floor) >= 0;
  return {
    name: "node",
    level: "required",
    status: ok ? "ok" : "FAIL",
    detail: `v${version} (engines ${range || "unspecified"})`,
  };
}

async function filesRow(config: ResolvedCircuitConfig | null): Promise<DoctorRow> {
  const name = "required files";
  if (config === null) return { name, level: "required", status: "FAIL", detail: "not checked: the config did not load" };
  const missing = await missingProjectFiles(config);
  if (missing.length > 0) {
    return {
      name,
      level: "required",
      status: "FAIL",
      detail: `missing ${missing.map((entry) => `${entry.field}=${configRelative(config, entry.path)}`).join(", ")}`,
    };
  }
  try {
    await mapCircuitConfig(config);
  } catch (error) {
    return { name, level: "required", status: "FAIL", detail: errorMessage(error) };
  }
  return { name, level: "required", status: "ok", detail: "every declared file is present and well-formed" };
}

async function pythonRow(config: ResolvedCircuitConfig | null, cwd: string, env: NodeJS.ProcessEnv): Promise<DoctorRow> {
  const minimum = config?.validation.pythonMinVersion ?? DEFAULT_PYTHON_MIN_VERSION;
  const bin = resolvePythonBin(undefined, env);
  const output = await probe(bin, ["--version"], cwd, env);
  const found = output === null ? null : /Python (\d+\.\d+(?:\.\d+)?)/u.exec(output)?.[1];
  if (found === undefined || found === null) {
    return {
      name: "python",
      level: "required",
      status: "FAIL",
      detail: `no usable \`${bin}\` (need Python >= ${minimum}; set CIRCUIT_DOC_PYTHON)`,
    };
  }
  const ok = compareVersions(found, minimum) >= 0;
  return {
    name: "python",
    level: "required",
    status: ok ? "ok" : "FAIL",
    detail: `${bin} ${found} (need >= ${minimum}${ok ? "" : "; set CIRCUIT_DOC_PYTHON"})`,
  };
}

async function kicadImageRow(
  config: ResolvedCircuitConfig | null,
  docker: string | null,
  env: NodeJS.ProcessEnv,
): Promise<DoctorRow> {
  const name = "kicad image";
  if (config === null || !config.cad.enabled) {
    return { name, level: "optional", status: "n/a", detail: "cad disabled: no footprint previews to render" };
  }
  const image = config.cad.previewRenderer.image;
  if (docker === null) return { name, level: "optional", status: "missing", detail: `needs Docker; then \`docker pull ${image}\`` };
  const inspected = await probe(docker, ["image", "inspect", "--format", "{{.Id}}", image], config.configDir, env);
  return inspected === null
    ? { name, level: "optional", status: "missing", detail: `\`docker pull ${image}\` (needed only for \`footprints generate\`)` }
    : { name, level: "optional", status: "ok", detail: image };
}

async function chromeRow(env: NodeJS.ProcessEnv): Promise<DoctorRow> {
  const configured = env.CHROME_BIN;
  if (configured !== undefined && configured !== "") {
    return (await isExecutable(configured))
      ? { name: "chrome", level: "optional", status: "ok", detail: `CHROME_BIN=${configured}` }
      : { name: "chrome", level: "optional", status: "missing", detail: `CHROME_BIN=${configured} is not an executable file` };
  }
  for (const candidate of CHROME_NAMES) {
    const found = await which(candidate, env);
    if (found !== null) return { name: "chrome", level: "optional", status: "ok", detail: found };
  }
  return {
    name: "chrome",
    level: "optional",
    status: "missing",
    detail: "install Google Chrome or set CHROME_BIN (needed only for `check-browser`)",
  };
}

async function gitRow(dir: string, env: NodeJS.ProcessEnv): Promise<DoctorRow> {
  const git = await which("git", env);
  if (git === null) return { name: "git", level: "info", status: "missing", detail: "git not found; the project is not version-controlled here" };
  const version = (await probe(git, ["--version"], dir, env))?.trim() ?? "git";
  const inside = (await probe(git, ["rev-parse", "--is-inside-work-tree"], dir, env))?.trim() === "true";
  return { name: "git", level: "info", status: "ok", detail: `${version}; ${inside ? "inside a git repository" : "not a git repository"}` };
}

/** `PATH` lookup against the given environment (not the parent process's). */
export async function which(name: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, name);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** stdout+stderr of a successful run, or `null` when it could not run or exited nonzero. */
async function probe(bin: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, { cwd, env, timeout: PROBE_TIMEOUT_MS, windowsHide: true });
    return `${stdout}${stderr}`;
  } catch {
    return null;
  }
}

function compareVersions(a: string, b: string): number {
  const parse = (version: string) => version.replace(/^v/u, "").split(".").map(Number);
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
