// Generic, project-agnostic primitives for scripts/verify-pack.mjs (#28),
// adapted from zudo-sg's scripts/verify-create-zudo-sg.mjs and
// verify-styleguide-install.mjs @ b9b36ce35d98d6abc641d84e8535552eac0dbded.
//
// Nothing here knows about circuit-doc's config shape, CLI commands or
// fixtures — that lives in verify-pack.mjs. This module only knows how to
// run commands, pack/extract tarballs, boot a dev server, and manipulate a
// scratch project directory.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

export const PNPM = ["corepack", "pnpm"];

export class VerifyError extends Error {}

export function fail(message) {
  throw new VerifyError(message);
}

export function assert(condition, message) {
  if (!condition) fail(message);
}

/** Run a command, streaming its output live. Throws on a nonzero exit. */
export function run(command, args, cwd, options = {}) {
  const env = options.env ?? { ...process.env, CI: process.env.CI ?? "true" };
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: options.detached ?? false,
      stdio: options.stdio ?? "inherit",
    });
    child.on("error", (error) => reject(new VerifyError(`${command} could not start: ${error.message}`)));
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new VerifyError(
          `${command} ${args.join(" ")} failed (${signal ? `signal ${signal}` : `exit code ${code}`})`,
        ),
      );
    });
  });
}

/** Run a command, streaming AND capturing combined stdout+stderr. Throws on a nonzero exit. */
export function runStreamed(command, args, cwd, options = {}) {
  const env = options.env ?? { ...process.env, CI: process.env.CI ?? "true" };
  return new Promise((resolvePromise, reject) => {
    let output = "";
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
      process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      output += String(chunk);
      process.stderr.write(chunk);
    });
    child.on("error", (error) => reject(new VerifyError(`${command} could not start: ${error.message}`)));
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolvePromise(output);
        return;
      }
      reject(
        new VerifyError(
          `${command} ${args.join(" ")} failed (${signal ? `signal ${signal}` : `exit code ${code}`}):\n${output}`,
        ),
      );
    });
  });
}

/** Run a command and return {status, stdout, stderr} without throwing — for negative-path assertions. */
export function runCapture(command, args, cwd, options = {}) {
  const env = options.env ?? { ...process.env, CI: process.env.CI ?? "true" };
  return new Promise((resolvePromise, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", (error) => reject(new VerifyError(`${command} could not start: ${error.message}`)));
    child.on("close", (code, signal) => resolvePromise({ status: code, signal, stdout, stderr }));
  });
}

/**
 * Runs a command through `bash $HOME/.claude/scripts/heavy-guard.sh` when
 * that guard is installed on this machine (local agent sessions); falls back
 * to running directly otherwise (CI runners, or a machine without the
 * cross-session guard). A nested guarded call is safe: heavy-guard.sh itself
 * no-ops the slot/memory admission check when `HEAVY_GUARD_HELD=1` is already
 * set in the environment (i.e. this whole script was itself launched under
 * `heavy-guard.sh -- pnpm verify:pack`).
 */
export function runHeavy(label, command, args, cwd, options = {}) {
  const guard = path.join(os.homedir(), ".claude", "scripts", "heavy-guard.sh");
  if (existsSync(guard)) {
    return run("bash", [guard, "--label", label, "--", command, ...args], cwd, options);
  }
  return run(command, args, cwd, options);
}

export function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePort(typeof address === "object" && address ? address.port : 0));
    });
  });
}

export async function waitForOk(url, timeoutMs, child, log) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.spawnError) fail(`process could not start: ${child.spawnError.message}`);
    if (child.exitCode !== null) fail(`process exited (${child.exitCode}) before answering ${url}:\n${log()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  fail(`${url} did not answer within ${timeoutMs}ms:\n${log()}`);
}

export function stopProcessGroup(child) {
  if (!child || child.exitCode !== null || child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

/** Sorted, forward-slash, relative file paths under `directory` (files only; throws on anything else). */
export async function listFiles(directory) {
  const result = [];
  async function visit(current, prefix) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath, relative);
      } else if (entry.isFile()) {
        result.push(relative);
      } else {
        fail(`unexpected non-file entry: ${relative}`);
      }
    }
  }
  await visit(directory, "");
  return result.sort();
}

/** A stable hash of an entire directory tree's relative paths + contents + mode bits, for byte-unchanged proofs. */
export async function hashTree(directory) {
  const files = await listFiles(directory);
  const hash = createHash("sha256");
  for (const relative of files) {
    const filePath = path.join(directory, relative);
    const stats = await stat(filePath);
    const contents = await readFile(filePath);
    hash.update(relative);
    hash.update("\0");
    hash.update(String(stats.mode & 0o777));
    hash.update("\0");
    hash.update(contents);
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * `corepack pnpm --filter <selector> pack --pack-destination <destination>`,
 * returning the absolute path of the one tarball it created (detected by
 * directory diff, since pnpm does not print the filename in a stable way).
 */
export async function packWorkspacePackage(selector, destination, root) {
  await mkdir(destination, { recursive: true });
  const before = new Set((await readdir(destination)).filter((entry) => entry.endsWith(".tgz")));
  await runStreamed(
    PNPM[0],
    [...PNPM.slice(1), "--filter", selector, "pack", "--pack-destination", destination],
    root,
  );
  const after = (await readdir(destination)).filter((entry) => entry.endsWith(".tgz"));
  const created = after.filter((entry) => !before.has(entry));
  assert(created.length === 1, `expected one ${selector} tarball in ${destination}, found ${created.length}`);
  return path.join(destination, created[0]);
}

/** `package/foo/bar` -> `foo/bar` listing of a tarball's entries (files and directories alike, as tar prints them). */
export async function tarList(tarballPath, cwd) {
  const listing = await runCapture("tar", ["-tzf", tarballPath], cwd);
  if (listing.status !== 0) fail(`tar -tzf ${tarballPath} failed:\n${listing.stderr}`);
  return listing.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^package\//u, "").replace(/\/$/u, ""));
}

export async function extractTarball(tarballPath, destination) {
  await mkdir(destination, { recursive: true });
  await run("tar", ["-xzf", tarballPath, "-C", destination], destination);
  return path.join(destination, "package");
}

export async function copyWithoutNodeModules(sourceDir, targetDir) {
  const nodeModulesDir = path.join(sourceDir, "node_modules");
  assert(!existsSync(targetDir), `destination already exists: ${targetDir}`);
  await cp(sourceDir, targetDir, {
    recursive: true,
    filter(sourcePath) {
      return sourcePath !== nodeModulesDir && !sourcePath.startsWith(`${nodeModulesDir}${path.sep}`);
    },
  });
}

/**
 * A fresh copy of `sourceDir` for a negative-scenario mutation, reusing the
 * source's already-installed `node_modules` via a symlink instead of copying
 * it (copying a full foreign install for every scenario would dominate the
 * script's runtime). Never mutate `node_modules` through the returned path.
 */
export async function copyWithLinkedNodeModules(sourceDir, targetDir) {
  await copyWithoutNodeModules(sourceDir, targetDir);
  const realNodeModules = await realpath(path.join(sourceDir, "node_modules"));
  await symlink(realNodeModules, path.join(targetDir, "node_modules"), "dir");
}

export async function assertForeignPackage(hostDir, packageName) {
  const installed = await realpath(path.join(hostDir, "node_modules", ...packageName.split("/")));
  const modules = `${await realpath(path.join(hostDir, "node_modules"))}${path.sep}`;
  assert(installed.startsWith(modules), `${packageName} resolves outside the scratch node_modules: ${installed}`);
}

/**
 * Rewrites `manifest[field][packageName]` to `file:<relativePrefix>.tarball/<tgz>`
 * after copying the tarball into `<hostDir>/.tarball/`. `relativePrefix` lets a
 * nested manifest (e.g. `doc/package.json`) point back up at the shared
 * `.tarball` directory (spec #28 item 3.3: `file:.tarball/<tgz>` at the root,
 * `file:../.tarball/<tgz>` from `doc/`).
 */
export async function installLocalTarball(hostDir, tarball, manifestRelativePath, packageName, relativePrefix = "") {
  const tarballDir = path.join(hostDir, ".tarball");
  await mkdir(tarballDir, { recursive: true });
  const tarballName = path.basename(tarball);
  await cp(tarball, path.join(tarballDir, tarballName));

  const manifestPath = path.join(hostDir, manifestRelativePath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  let found = false;
  for (const field of ["dependencies", "devDependencies"]) {
    if (manifest[field]?.[packageName] !== undefined) {
      manifest[field][packageName] = `file:${relativePrefix}.tarball/${tarballName}`;
      found = true;
    }
  }
  assert(found, `${manifestRelativePath} has no dependency on ${packageName} to override`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Writes a tiny executable shell script at `<dir>/<name>` (used for shimmed-PATH scenarios). */
export function writeShim(dir, name, script) {
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  writeFileSync(target, `#!/bin/sh\n${script}\n`);
  chmodSync(target, 0o755);
  return target;
}

/**
 * Builds a PATH string with `hiddenNames` genuinely unresolvable, while every
 * OTHER binary a directory carries stays available. On a typical Linux
 * layout `docker`/`google-chrome` share a directory (e.g. `/usr/bin`) with
 * basic coreutils (`sed`, `dirname`, `uname`, ...) that pnpm's own generated
 * `.bin/*` shell shims and the build tooling need — dropping that whole
 * directory to hide two binaries breaks everything else in it. Instead, any
 * directory that carries a hidden name is replaced (in the same PATH
 * position) by a private mirror directory that symlinks every OTHER entry
 * from it; the hidden name(s) are simply never linked, so they are absent,
 * not merely inaccessible (an unreadable-but-present file would still count
 * as "installed" to a plain existence check). Verifies every `mustKeep` name
 * still resolves and every `hiddenNames` entry does not, so an over- or
 * under-aggressive filter fails loudly instead of silently breaking the
 * scenario it is meant to isolate.
 */
const shimMirrorDirs = [];

/** Every private mirror directory `shimmedPath` has created so far, for the caller to remove on cleanup. */
export function createdShimMirrorDirs() {
  return [...shimMirrorDirs];
}

export async function shimmedPath(env, hiddenNames, mustKeep) {
  const dirs = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const resultDirs = [];
  for (const dir of dirs) {
    let entries;
    try {
      entries = await readdir(dir);
    } catch {
      resultDirs.push(dir);
      continue;
    }
    if (!entries.some((entry) => hiddenNames.includes(entry))) {
      resultDirs.push(dir);
      continue;
    }
    const mirrorDir = await mkdtemp(path.join(os.tmpdir(), "circuit-doc-verify-pack-safe-path-"));
    shimMirrorDirs.push(mirrorDir);
    for (const entry of entries) {
      if (hiddenNames.includes(entry)) continue;
      await symlink(path.join(dir, entry), path.join(mirrorDir, entry)).catch(() => {}); // best-effort; a rare unlinkable entry just stays absent
    }
    resultDirs.push(mirrorDir);
  }

  const candidatePath = resultDirs.join(path.delimiter);
  for (const name of mustKeep) {
    assert(
      (await which(name, candidatePath)) !== null,
      `shimmed PATH lost "${name}" while trying to hide ${hiddenNames.join(", ")}`,
    );
  }
  for (const name of hiddenNames) {
    const found = await which(name, candidatePath);
    assert(found === null, `shimmed PATH still resolves "${name}" at ${found}`);
  }
  return candidatePath;
}

async function which(name, pathValue) {
  for (const dir of pathValue.split(path.delimiter)) {
    if (dir === "") continue;
    const candidate = path.join(dir, name);
    try {
      await access(candidate, fsConstants.X_OK);
      const stats = await stat(candidate);
      if (stats.isFile()) return candidate;
    } catch {
      // not here
    }
  }
  return null;
}

export async function mkdtempIn(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function removeAll(paths) {
  await Promise.all(paths.filter(Boolean).map((entry) => rm(entry, { recursive: true, force: true })));
}
