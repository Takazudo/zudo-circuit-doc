#!/usr/bin/env node
// Lock, verify and (re-)materialize fixtures/led/upstream — the pinned zudo-led-lamp
// regression corpus. See fixtures/led/README.md for the modes below and
// _temp-resource/1-circuit-doc-seed/planning/explore/led-fixture-ci.md for how the
// vendored path set was derived and verified.
//
// Modes:
//   (default) --check                          offline: verify committed files against fixture.lock.json
//   --materialize-step [--from-git <clone> | --from-github]
//                                               write the 25 STEP files from the pinned commit
//   --write --from-git <clone> | --from-github  re-derive the whole file set and lock
//   --verify-upstream                           network: compare lock gitBlobs against the GitHub tree API
//
// No dependencies beyond Node >=22 and (for --from-git/--write/--materialize-step) git,
// or (for --from-github) network access to codeload.github.com.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

export const REPOSITORY = "Takazudo/zudo-led-lamp";
export const COMMIT = "194d8a297e3545588197342130c3111a66c10973";
export const SOURCE_URL = `https://github.com/${REPOSITORY}/tree/${COMMIT}`;

// The path derivation rules, recorded verbatim in every generated lock's `derivation` field.
export const DERIVATION_TEXT =
  "Fixed prefixes .claude/skills/, doc/public/assets/component-previews/ and " +
  "doc/src/content/docs/components/; explicit scripts/schgen/*.py, symbols/zudo-led-lamp.kicad_sym, " +
  "doc/component-docs/preflight.json and doc/component-docs/adapters/circuit/selection.ts; and, for " +
  "each package in doc/public/assets/component-previews/footprints/manifest.json, the master and " +
  ".pretty kicad_mod plus the .wrl/.step pair named by the .pretty footprint's (model \"...\") entry.";

export const EXPLICIT_FILES = [
  "scripts/schgen/board_p_spec.py",
  "scripts/schgen/board_l_spec.py",
  "scripts/schgen/swd_adapter_spec.py",
  "scripts/schgen/verify_power_switch.py",
  "scripts/schgen/schgen_core.py",
  "scripts/schgen/sexp.py",
  "symbols/zudo-led-lamp.kicad_sym",
  "doc/component-docs/preflight.json",
  "doc/component-docs/adapters/circuit/selection.ts",
];

export const PREFIXES = [
  ".claude/skills/",
  "doc/public/assets/component-previews/",
  "doc/src/content/docs/components/",
];

export const MANIFEST_PATH = "doc/public/assets/component-previews/footprints/manifest.json";

// Allowlist of fixture-local files/dirs not derived from upstream (checked against
// fixtures/led's own top level, not fixtures/led/upstream/).
export const LOCAL_FILES = [
  "README.md",
  "NOTICE.md",
  "fixture.lock.json",
  ".gitignore",
  "circuit.config.ts",
  "circuit/**",
  "expected/**",
  "EXPECTED-CHANGES.md",
];

export const FIXTURE_DIR = path.join(REPO_ROOT, "fixtures/led");
export const UPSTREAM_DIR = path.join(FIXTURE_DIR, "upstream");
export const LOCK_PATH = path.join(FIXTURE_DIR, "fixture.lock.json");

// ---- hashing ----

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Matches `git hash-object`: sha1("blob " + size + "\0" + bytes).
export function sha1GitBlob(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

// ---- allowlist matching (no glob dependency: only "**" suffix and "*" segments are needed) ----

export function matchesPattern(relPath, pattern) {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return relPath === prefix || relPath.startsWith(`${prefix}/`);
  }
  if (pattern.includes("*")) {
    const escaped = pattern
      .split("*")
      .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join("[^/]*");
    return new RegExp(`^${escaped}$`).test(relPath);
  }
  return relPath === pattern;
}

export function isAllowedLocal(relPath, patterns) {
  return patterns.some((pattern) => matchesPattern(relPath, pattern));
}

// ---- filesystem walk ----

export function walk(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, base, out);
    } else {
      out.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return out;
}

// ---- source adapters ----
// A source exposes listPaths()/has(path)/readBytes(path) over the pinned commit's tree,
// whether backed by a local clone (git cat-file) or a downloaded GitHub tarball.

export function gitSource(clonePath, commit = COMMIT) {
  const git = (...args) =>
    execFileSync("git", ["-C", clonePath, ...args], { maxBuffer: 1 << 30 });
  git("cat-file", "-e", `${commit}^{commit}`);
  const treeText = git("ls-tree", "-r", "-l", commit).toString("utf8");
  const byPath = new Map();
  for (const line of treeText.split("\n")) {
    if (!line) continue;
    const [meta, filePath] = line.split("\t");
    const parts = meta.trim().split(/\s+/);
    byPath.set(filePath, { blob: parts[2], size: Number(parts[3]) });
  }
  return {
    listPaths: () => [...byPath.keys()],
    has: (filePath) => byPath.has(filePath),
    readBytes: (filePath) => {
      const entry = byPath.get(filePath);
      if (!entry) throw new Error(`not found in source clone: ${filePath}`);
      return git("cat-file", "blob", entry.blob);
    },
  };
}

export function githubSource(repository = REPOSITORY, commit = COMMIT) {
  const tmp = mkdtempSync(path.join(tmpdir(), "led-github-src-"));
  const tarPath = path.join(tmp, "src.tar.gz");
  execFileSync("curl", [
    "-fsSL",
    "--retry",
    "3",
    "-o",
    tarPath,
    `https://codeload.github.com/${repository}/tar.gz/${commit}`,
  ]);
  const extractDir = path.join(tmp, "extract");
  mkdirSync(extractDir, { recursive: true });
  execFileSync("tar", ["-xzf", tarPath, "-C", extractDir, "--strip-components=1"]);
  return {
    listPaths: () => walk(extractDir),
    has: (filePath) => existsSync(path.join(extractDir, filePath)),
    readBytes: (filePath) => readFileSync(path.join(extractDir, filePath)),
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
  };
}

// ---- derivation ----

export function deriveFileList(source, opts = {}) {
  const explicitFiles = opts.explicitFiles ?? EXPLICIT_FILES;
  const prefixes = opts.prefixes ?? PREFIXES;
  const manifestPath = opts.manifestPath ?? MANIFEST_PATH;

  const want = new Set(explicitFiles);
  for (const p of source.listPaths()) {
    if (prefixes.some((prefix) => p.startsWith(prefix))) want.add(p);
  }

  const manifest = JSON.parse(source.readBytes(manifestPath).toString("utf8"));
  const stepPaths = new Set();
  for (const pkg of manifest.packages) {
    want.add(`footprints/kicad/${pkg.footprintName}.kicad_mod`);
    want.add(pkg.footprintPath);
    const prettyText = source.readBytes(pkg.footprintPath).toString("utf8");
    const match = /\(model\s+"[^"]*\/([^/"]+)"/u.exec(prettyText);
    if (!match) throw new Error(`no (model "...") reference found in ${pkg.footprintPath}`);
    const wrlName = match[1];
    const wrlPath = `footprints/kicad/zudo-led-lamp.3dshapes/${wrlName}`;
    const stepPath = wrlPath.replace(/\.wrl$/u, ".step");
    want.add(wrlPath);
    want.add(stepPath);
    stepPaths.add(stepPath);
  }

  return { paths: [...want].sort(), stepPaths };
}

export function buildLockFromSource(source, opts = {}) {
  const repository = opts.repository ?? REPOSITORY;
  const commit = opts.commit ?? COMMIT;
  const localFiles = opts.localFiles ?? LOCAL_FILES;
  const { paths, stepPaths } = deriveFileList(source, opts);

  const files = paths.map((p) => {
    const bytes = source.readBytes(p);
    const entry = {
      path: p,
      size: bytes.length,
      sha256: sha256Hex(bytes),
      gitBlob: sha1GitBlob(bytes),
    };
    if (stepPaths.has(p)) entry.materialized = true;
    return entry;
  });

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  return {
    lockVersion: 1,
    source: { repository, commit, url: opts.sourceUrl ?? SOURCE_URL },
    derivation: opts.derivationText ?? DERIVATION_TEXT,
    fileCount: files.length,
    totalBytes,
    files,
    localFiles,
  };
}

// ---- write / materialize ----

export function writeUpstreamFiles(source, lock, upstreamDir = UPSTREAM_DIR) {
  for (const f of lock.files) {
    if (f.materialized) continue; // STEP files are not committed
    const bytes = source.readBytes(f.path);
    const dest = path.join(upstreamDir, f.path);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
  }
}

export function materializeStep(source, lock, upstreamDir = UPSTREAM_DIR) {
  const stepFiles = lock.files.filter((f) => f.materialized);
  let count = 0;
  for (const f of stepFiles) {
    const dest = path.join(upstreamDir, f.path);
    if (existsSync(dest)) {
      const existing = readFileSync(dest);
      if (sha256Hex(existing) === f.sha256) {
        count += 1;
        continue;
      }
    }
    const bytes = source.readBytes(f.path);
    if (bytes.length !== f.size || sha256Hex(bytes) !== f.sha256) {
      throw new Error(`materialize: hash mismatch for ${f.path}`);
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
    count += 1;
  }
  return { count, total: stepFiles.length };
}

// ---- check ----

function isIgnorableUpstreamExtra(relPath) {
  return (
    relPath.endsWith(".step") ||
    relPath === "tmp" ||
    relPath.startsWith("tmp/") ||
    relPath.includes("__pycache__")
  );
}

export function checkFixture(opts = {}) {
  const fixtureDir = opts.fixtureDir ?? FIXTURE_DIR;
  const upstreamDir = opts.upstreamDir ?? path.join(fixtureDir, "upstream");
  const lockPath = opts.lockPath ?? path.join(fixtureDir, "fixture.lock.json");

  if (!existsSync(lockPath)) {
    return { ok: false, problems: [`missing lock file: ${lockPath}`], materializedCount: 0, materializedTotal: 0 };
  }
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const localFiles = lock.localFiles ?? LOCAL_FILES;
  const problems = [];
  const expectedRelPaths = new Set();
  let materializedCount = 0;
  const materializedTotal = lock.files.filter((f) => f.materialized).length;

  for (const f of lock.files) {
    expectedRelPaths.add(f.path);
    const dest = path.join(upstreamDir, f.path);
    if (f.materialized) {
      if (existsSync(dest)) {
        const bytes = readFileSync(dest);
        if (bytes.length !== f.size || sha256Hex(bytes) !== f.sha256) {
          problems.push(`STEP drift: ${f.path}`);
        } else {
          materializedCount += 1;
        }
      }
      continue; // absence is fine: STEP is materialized on demand, not committed
    }
    if (!existsSync(dest)) {
      problems.push(`missing committed file: ${f.path}`);
      continue;
    }
    const bytes = readFileSync(dest);
    if (bytes.length !== f.size || sha256Hex(bytes) !== f.sha256 || sha1GitBlob(bytes) !== f.gitBlob) {
      problems.push(`hash drift: ${f.path}`);
    }
  }

  for (const relPath of walk(upstreamDir)) {
    if (isIgnorableUpstreamExtra(relPath)) continue;
    if (!expectedRelPaths.has(relPath)) {
      problems.push(`extra file outside the lock: upstream/${relPath}`);
    }
  }

  if (existsSync(fixtureDir)) {
    for (const entry of readdirSync(fixtureDir, { withFileTypes: true })) {
      if (entry.name === "upstream") continue;
      const relPath = entry.isDirectory() ? `${entry.name}/**` : entry.name;
      const check = entry.isDirectory()
        ? walk(path.join(fixtureDir, entry.name)).every((p) =>
            isAllowedLocal(`${entry.name}/${p}`, localFiles),
          )
        : isAllowedLocal(entry.name, localFiles);
      if (!check) problems.push(`extra file outside the allowlist: ${relPath}`);
    }
  }

  return { ok: problems.length === 0, problems, materializedCount, materializedTotal, lock };
}

// ---- verify-upstream (network) ----

export async function verifyUpstreamRemote(lock) {
  const res = await fetch(
    `https://api.github.com/repos/${lock.source.repository}/git/trees/${lock.source.commit}?recursive=1`,
    { headers: { "User-Agent": "zudo-circuit-doc-fixture-sync", Accept: "application/vnd.github+json" } },
  );
  if (!res.ok) throw new Error(`GitHub tree API request failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data.truncated) throw new Error("GitHub tree API response was truncated; cannot verify fully");
  const byPath = new Map(data.tree.map((entry) => [entry.path, entry.sha]));
  const problems = [];
  for (const f of lock.files) {
    const sha = byPath.get(f.path);
    if (!sha) problems.push(`missing on GitHub: ${f.path}`);
    else if (sha !== f.gitBlob) problems.push(`drifted on GitHub: ${f.path}`);
  }
  return { ok: problems.length === 0, problems };
}

// ---- CLI ----

function resolveSource(args) {
  if (args.includes("--from-git")) {
    const i = args.indexOf("--from-git");
    const next = args[i + 1];
    const clonePath =
      next && !next.startsWith("--") ? next : path.join(homedir(), "repos/circuits/zudo-led-lamp");
    return gitSource(clonePath);
  }
  return githubSource();
}

async function runCli() {
  const args = process.argv.slice(2);

  if (args.includes("--verify-upstream")) {
    const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
    const result = await verifyUpstreamRemote(lock);
    for (const p of result.problems) console.error(`FAIL ${p}`);
    console.log(result.ok ? "verify-upstream: OK" : `verify-upstream: ${result.problems.length} problem(s)`);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (args.includes("--materialize-step")) {
    const source = resolveSource(args);
    const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
    const { count, total } = materializeStep(source, lock);
    source.cleanup?.();
    console.log(`STEP files materialized ${count}/${total}`);
    return;
  }

  if (args.includes("--write")) {
    if (!args.includes("--from-git") && !args.includes("--from-github")) {
      throw new Error("--write requires --from-git <clone> or --from-github");
    }
    const source = resolveSource(args);
    const lock = buildLockFromSource(source);
    mkdirSync(UPSTREAM_DIR, { recursive: true });
    writeUpstreamFiles(source, lock, UPSTREAM_DIR);
    writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`);
    source.cleanup?.();
    console.log(`wrote fixture.lock.json: ${lock.fileCount} files, ${lock.totalBytes} bytes`);
    return;
  }

  // default: --check (offline)
  const result = checkFixture();
  for (const p of result.problems) console.error(`FAIL ${p}`);
  console.log(`materialized ${result.materializedCount}/${result.materializedTotal}`);
  if (!result.ok) {
    console.error("fixtures/led: CHECK FAILED");
    process.exitCode = 1;
    return;
  }
  if (result.materializedCount < result.materializedTotal) {
    console.log("STEP files not materialized: run pnpm fixtures:led:materialize");
  }
  console.log(`fixtures/led: OK (${result.lock.fileCount} files verified)`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runCli().catch((err) => {
    console.error(err.stack ?? String(err));
    process.exitCode = 1;
  });
}
