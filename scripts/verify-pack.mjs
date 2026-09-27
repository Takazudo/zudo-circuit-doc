#!/usr/bin/env node
// Pack-and-install verifier (#28): proves the initializer and runtime work
// from their PACKED TARBALLS, installed into a consumer OUTSIDE this
// monorepo, with no workspace link back here. A workspace resolving an
// unpublished path is not evidence (epic #1, START-HERE) — this script is
// the decisive portability test for M5.
//
// Adapted from zudo-sg's scripts/verify-create-zudo-sg.mjs +
// verify-styleguide-install.mjs @ b9b36ce35d98d6abc641d84e8535552eac0dbded
// (see the epic #1 planning note planning/explore/sg-pattern.md, removed from the
// tree in #34 and kept in git history).
// Generic run/pack/extract/dev-boot primitives live in scripts/lib/verify-helpers.mjs;
// everything below is circuit-doc-specific.
//
// Usage:
//   pnpm verify:pack [--keep] [--fixture empty|minimal|led] [--published-runtime]
//
// --keep leaves every temp directory in place and prints their paths instead
// of removing them. --fixture accepts:
//   - "empty" (default): the M5 scaffold-and-install proof (#28).
//   - "minimal" (#31): overlays examples/minimal (one CAD-enabled record, the
//     TMP1075DR footprint SVG + WRL viewer) onto a tarball-installed consumer
//     outside the monorepo, then runs check/build/check:site and check-browser.
//   - "led" (#31): drives scripts/lib/fixture-site.mjs (#23) in tarball mode
//     — the 35-record LED corpus, byte-identical generation — then
//     check-browser against the built site.
// --published-runtime is valid with the default/empty fixture only: it probes
// npm first, then verifies the packed initializer installs its template's
// published runtime range from the registry.
//
// Every scenario below prints one `PASS: <ID> ...` or `FAIL: <ID> ...` line.
// A scenario that cannot run because a DIFFERENT sub-issue has not landed yet
// (see the check-browser note) prints `SKIP: <ID> ...` instead of a fabricated
// PASS — see the Verification policy in issue #28 ("no fabricated evidence").

import { cp, mkdir, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PNPM,
  VerifyError,
  assert,
  assertForeignPackage,
  copyWithLinkedNodeModules,
  copyWithoutNodeModules,
  createdShimMirrorDirs,
  extractTarball,
  fail,
  freePort,
  hashTree,
  installLocalTarball,
  listFiles,
  mkdtempIn,
  packWorkspacePackage,
  removeAll,
  run,
  runCapture,
  runHeavy,
  runStreamed,
  shimmedPath,
  stopProcessGroup,
  tarList,
  waitForOk,
  writeShim,
} from "./lib/verify-helpers.mjs";
import { spawn } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_SELECTOR = "@takazudo/zudo-circuit-doc";
const RUNTIME_NAME = "@takazudo/zudo-circuit-doc";
const INIT_SELECTOR = "create-zudo-circuit-doc";
const REGISTRY_URL = "https://registry.npmjs.org/";
const PUBLISHED_RUNTIME_PROBE_TIMEOUT_MS = 20_000;

const KNOWN_FIXTURES = new Set(["empty", "minimal", "led"]);

/** Parse the verifier's CLI args without performing any work, so the usage contract can be unit-tested. */
export function parseVerifyPackArgs(args) {
  const options = { keep: false, fixture: "empty", publishedRuntime: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--keep") {
      options.keep = true;
    } else if (argument === "--published-runtime") {
      options.publishedRuntime = true;
    } else if (argument === "--fixture") {
      options.fixture = args[index + 1];
      index += 1;
    } else {
      throw new VerifyError(`verify-pack: unknown argument ${JSON.stringify(argument)}.`);
    }
  }

  if (!KNOWN_FIXTURES.has(options.fixture)) {
    throw new VerifyError(
      `verify-pack: unknown --fixture ${JSON.stringify(options.fixture)}; expected one of ${[...KNOWN_FIXTURES].join(", ")}.`,
    );
  }
  if (options.publishedRuntime && options.fixture !== "empty") {
    throw new VerifyError("verify-pack: --published-runtime is only valid with --fixture empty.");
  }
  return options;
}

function parseStableVersion(version) {
  if (typeof version !== "string") return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z.-]+)?$/u.exec(version);
  return match ? match.slice(1, 4).map(Number) : null;
}

/** True when a stable x.y.z version satisfies the stable caret range used by the template. */
export function versionSatisfiesCaretRange(version, range) {
  if (typeof range !== "string" || !range.startsWith("^")) return false;
  const lower = parseStableVersion(range.slice(1));
  const candidate = parseStableVersion(version);
  if (!lower || !candidate) return false;
  const [major, minor, patch] = lower;
  const [candidateMajor, candidateMinor, candidatePatch] = candidate;
  const atLeastLower =
    candidateMajor > major ||
    (candidateMajor === major && candidateMinor > minor) ||
    (candidateMajor === major && candidateMinor === minor && candidatePatch >= patch);
  if (!atLeastLower) return false;

  if (major > 0) return candidateMajor === major;
  if (minor > 0) return candidateMajor === 0 && candidateMinor === minor;
  return candidateMajor === 0 && candidateMinor === 0 && candidatePatch === patch;
}

function probeVersions(stdout) {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || parsed === "") return [];
    if (Array.isArray(parsed)) return parsed.filter((version) => typeof version === "string");
    if (typeof parsed === "string") return [parsed];
    return null;
  } catch {
    // npm normally emits JSON here; tolerate a plain semver string for npm versions
    // that omit JSON quoting for a single result.
    return parseStableVersion(trimmed) ? [trimmed] : null;
  }
}

/** Classify npm view results independently of the network process for deterministic tests. */
export function classifyPublishedRuntimeProbe(result, range) {
  if (result.timedOut) {
    return { verdict: "inconclusive", detail: `npm view timed out after ${result.timeoutMs}ms` };
  }
  if (result.error) {
    return { verdict: "inconclusive", detail: `npm view could not run: ${result.error}` };
  }

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (/\bE404\b|404\s+Not\s+Found/iu.test(output)) {
    return { verdict: "not-published", detail: "npm registry returned E404" };
  }

  const versions = probeVersions(result.stdout ?? "");
  if (versions?.length === 0 && result.status === 0) {
    return { verdict: "not-published", detail: "npm registry returned an empty result" };
  }
  if (result.status !== 0) {
    const detail = output.trim().replace(/\s+/gu, " ").slice(0, 500) || `npm view exited ${result.status}`;
    return { verdict: "inconclusive", detail };
  }
  if (versions === null) {
    return { verdict: "inconclusive", detail: "npm view returned an unrecognized response" };
  }

  const satisfyingVersions = versions.filter((version) => versionSatisfiesCaretRange(version, range));
  if (satisfyingVersions.length === 0) {
    return { verdict: "not-published", detail: `npm registry returned no versions satisfying ${range}` };
  }
  return { verdict: "found", versions: satisfyingVersions };
}

function runPublishedRuntimeProbe(range, timeoutMs = PUBLISHED_RUNTIME_PROBE_TIMEOUT_MS) {
  const selector = `${RUNTIME_NAME}@${range}`;
  const args = ["view", selector, "version", "--json", `--registry=${REGISTRY_URL}`];
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn("npm", args, { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({ status: null, stdout, stderr, timedOut: true, timeoutMs });
    }, timeoutMs);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, ...result });
    };
    child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    child.once("error", (error) => finish({ status: null, error: error.message }));
    child.once("close", (status, signal) => finish({ status, signal }));
  });
}

// A grep list of upstream (zudo-led-lamp) identifiers that must never survive
// into a generated project — the whole point of the generic/empty template.
const LAMP_STRINGS = ["AL8860", "STM32", "STUSB", "zudo-led-lamp", "15 V", "JLCPCB", "EXAMPLE-MPN", "C000000"];

// Module-scoped so `main()`'s `finally` can stop it even though it is only
// ever assigned inside `emptyFixtureFlow()` (the "empty" fixture's own dev
// server boot) — `minimal` and `led` never assign it.
let devServer;

let failures = 0;
let scenarioSuffix = "";
function taggedScenarioId(id) {
  return `${id}${scenarioSuffix}`;
}
function pass(id, message) {
  console.log(`PASS: ${taggedScenarioId(id)} — ${message}`);
}
function scenarioFail(id, message) {
  failures += 1;
  console.log(`FAIL: ${taggedScenarioId(id)} — ${message}`);
}
function skip(id, message) {
  console.log(`SKIP: ${taggedScenarioId(id)} — ${message}`);
}
/** Runs one named scenario; a thrown error becomes a FAIL for that scenario without aborting the others. */
async function scenario(id, description, body) {
  try {
    await body();
  } catch (error) {
    scenarioFail(id, `${description}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

// --- tarball shape ---------------------------------------------------------

const BINARY_TARBALL_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".wrl", ".step", ".stp", ".pdf", ".woff", ".woff2", ".ttf", ".otf", ".eot"]);

function forbiddenEntry(entry) {
  if (entry === "fixtures" || entry.startsWith("fixtures/")) return "fixtures/ must never be packed";
  if (entry === "examples" || entry.startsWith("examples/")) return "examples/ must never be packed";
  if (entry === "test" || entry.startsWith("test/")) return "test/ must never be packed";
  if (entry === "python/tests" || entry.startsWith("python/tests/")) return "python/tests must never be packed";
  if (entry.includes("__pycache__")) return "__pycache__ must never be packed";
  if (/\.(step|stp|pdf)$/iu.test(entry)) return "no .step/.stp/.pdf file may be packed";
  if (/(^|\/)\.claude\/skills\/component-[^/]+/u.test(entry) && !entry.startsWith("templates/default/.claude/skills/")) {
    return ".claude/skills/component-* may only appear inside templates/default";
  }
  return null;
}

function allowedTopLevel(manifest) {
  const top = new Set(["package.json"]);
  for (const entry of manifest.files ?? []) {
    if (entry.startsWith("!")) continue;
    top.add(entry.split("/")[0]);
  }
  return top;
}

function assertTarballEntries(label, entries, manifest) {
  const allowedTop = allowedTopLevel(manifest);
  for (const entry of entries) {
    const top = entry.split("/")[0];
    assert(allowedTop.has(top), `${label}: unexpected top-level tarball entry "${top}" (from "${entry}")`);
    const reason = forbiddenEntry(entry);
    assert(reason === null, `${label}: forbidden tarball entry "${entry}" — ${reason}`);
  }
}

function walkExportsTargets(node, subpath, onTarget) {
  if (typeof node === "string") {
    onTarget(subpath, node);
    return;
  }
  if (node && typeof node === "object") {
    for (const value of Object.values(node)) walkExportsTargets(value, subpath, onTarget);
  }
}

function assertExportsPresent(label, manifest, extractedRoot) {
  assert(manifest.exports && typeof manifest.exports === "object", `${label}: package.json has no exports map`);
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    walkExportsTargets(target, subpath, (sp, value) => {
      assert(value.startsWith("./"), `${label}: exports["${sp}"] target "${value}" must start with "./"`);
      if (value.includes("*")) return;
      assert(existsSync(path.join(extractedRoot, value)), `${label}: exports["${sp}"] target "${value}" is missing from the tarball`);
    });
  }
}

const SPECIFIER_PATTERN = /(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])([^"'\n]+)\1/gu;

async function jsFilesUnder(directory) {
  const all = await listFiles(directory).catch(() => []);
  return all.filter((relative) => relative.endsWith(".js"));
}

async function assertNoTsSpecifiers(label, buildDir) {
  for (const relative of await jsFilesUnder(buildDir)) {
    const source = await readFile(path.join(buildDir, relative), "utf8");
    for (const match of source.matchAll(SPECIFIER_PATTERN)) {
      const specifier = match[2];
      if (/\.tsx?$/u.test(specifier)) {
        fail(`${label}: ${relative} imports "${specifier}" (a .ts/.tsx specifier survived the build)`);
      }
    }
  }
}

async function assertIslandsUseClient(label, islandsDir, roots) {
  for (const root of roots) {
    const filePath = path.join(islandsDir, root);
    assert(existsSync(filePath), `${label}: ${filePath} is missing from the tarball`);
    const source = await readFile(filePath, "utf8");
    assert(/^["']use client["'];?\s*\n/u.test(source), `${label}: ${root} does not start with "use client"`);
  }
}

async function tarballShapeChecks(root, artifacts, extraction) {
  console.log("Building create-zudo-circuit-doc and @takazudo/zudo-circuit-doc.");
  await runHeavy("verify-pack:build-runtime", PNPM[0], [...PNPM.slice(1), "--filter", RUNTIME_SELECTOR, "build"], root);
  await runHeavy("verify-pack:build-init", PNPM[0], [...PNPM.slice(1), "--filter", INIT_SELECTOR, "build"], root);

  console.log(`Packing both packages -> ${artifacts}`);
  const runtimeTarball = await packWorkspacePackage(RUNTIME_SELECTOR, artifacts, root);
  const initTarball = await packWorkspacePackage(INIT_SELECTOR, artifacts, root);

  const runtimeEntries = await tarList(runtimeTarball, root);
  const initEntries = await tarList(initTarball, root);
  const runtimeExtract = await extractTarball(runtimeTarball, path.join(extraction, "runtime"));
  const initExtract = await extractTarball(initTarball, path.join(extraction, "init"));
  const runtimeManifest = await readJson(path.join(runtimeExtract, "package.json"));
  const initManifest = await readJson(path.join(initExtract, "package.json"));

  await scenario("TARBALL-RUNTIME-SHAPE", "@takazudo/zudo-circuit-doc tarball shape", async () => {
    assertTarballEntries("runtime", runtimeEntries, runtimeManifest);
    assertExportsPresent("runtime", runtimeManifest, runtimeExtract);
    await assertNoTsSpecifiers("runtime", path.join(runtimeExtract, "lib"));
    await assertIslandsUseClient("runtime", path.join(runtimeExtract, "lib", "islands"), [
      "footprint-preview-island.js",
      "package-model-viewer-island.js",
      "preview-enlarge-dialog.js",
    ]);
    assert(runtimeEntries.includes("python/circuit_validate.py"), "runtime tarball is missing python/circuit_validate.py");
    assert(
      runtimeEntries.some((entry) => entry.startsWith("templates/component-skill-template/")),
      "runtime tarball is missing templates/component-skill-template",
    );
    assert(runtimeEntries.includes("CHANGELOG.md"), "runtime tarball is missing CHANGELOG.md");
    pass("TARBALL-RUNTIME-SHAPE", `${runtimeEntries.length} entries, exports resolved, no stray .ts specifiers, islands carry "use client"`);
  });

  await scenario("TARBALL-INIT-SHAPE", "create-zudo-circuit-doc tarball shape", async () => {
    assertTarballEntries("init", initEntries, initManifest);
    assert(initEntries.includes("bin/create-zudo-circuit-doc.js"), "init tarball is missing bin/create-zudo-circuit-doc.js");
    assert(
      initEntries.some((entry) => entry.startsWith("templates/default/")),
      "init tarball is missing templates/default",
    );
    assert(initEntries.includes("templates/default/_gitignore"), "init tarball's templates/default is missing _gitignore");
    assert(initEntries.includes("CHANGELOG.md"), "initializer tarball is missing CHANGELOG.md");
    await assertNoTsSpecifiers("init", path.join(initExtract, "dist"));
    pass("TARBALL-INIT-SHAPE", `${initEntries.length} entries, templates/default present with _gitignore`);
  });

  return { runtimeTarball, initTarball, runtimeExtract, initExtract, runtimeManifest, initManifest };
}

// --- consumer scaffold + install + build -----------------------------------

async function assertScaffoldShape(id, projectDir, packedTemplateDir) {
  // Rename _gitignore -> .gitignore BEFORE sorting: "." (0x2E) sorts before
  // "_" (0x5F), so renaming after the sort would leave it in the wrong
  // position relative to `actual`, which lists the real (already-renamed)
  // scaffolded tree.
  const expected = (await listFiles(packedTemplateDir))
    .map((file) => (file === "_gitignore" ? ".gitignore" : file))
    .sort();
  const actual = await listFiles(projectDir);
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `scaffold file set differs from the packed template:\nexpected: ${expected.join(", ")}\nactual: ${actual.join(", ")}`,
  );
  assert(existsSync(path.join(projectDir, ".gitignore")), "scaffold is missing .gitignore");
  assert(!existsSync(path.join(projectDir, "_gitignore")), "scaffold left the package-safe _gitignore name behind");

  const placeholders = ["__PROJECT_NAME__", "__SITE_TITLE__", "__LIBRARY_NAME__"];
  for (const relative of actual) {
    if (BINARY_TARBALL_EXTENSIONS.has(path.extname(relative).toLowerCase()) || relative.endsWith(".svg")) continue;
    const content = await readFile(path.join(projectDir, relative), "utf8");
    for (const token of placeholders) {
      assert(!content.includes(token), `scaffold left placeholder ${token} in ${relative}`);
    }
    for (const lamp of LAMP_STRINGS) {
      assert(!content.includes(lamp), `scaffold contains a lamp-fixture string "${lamp}" in ${relative}`);
    }
  }
  return { expected, actual };
}

async function assertPublishedTemplateDependencySpecs(packedTemplateDir, expectedRuntimeRange) {
  const manifestPaths = (await listFiles(packedTemplateDir)).filter((relative) => path.basename(relative) === "package.json");
  assert(manifestPaths.length > 0, "packed template contains no package.json manifests");
  for (const relative of manifestPaths) {
    const manifest = await readJson(path.join(packedTemplateDir, relative));
    for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
        assert(
          typeof spec !== "string" || !/^(?:workspace:|file:|link:)/u.test(spec),
          `${relative}: ${field}.${name} uses a non-registry dependency spec ${JSON.stringify(spec)}`,
        );
      }
    }
  }

  const rootManifest = await readJson(path.join(packedTemplateDir, "package.json"));
  assert(
    rootManifest.devDependencies?.[RUNTIME_NAME] === expectedRuntimeRange,
    `packed template package.json's ${RUNTIME_NAME} spec is ${JSON.stringify(rootManifest.devDependencies?.[RUNTIME_NAME])}, expected ${expectedRuntimeRange}`,
  );
  const docManifest = await readJson(path.join(packedTemplateDir, "doc", "package.json"));
  assert(
    docManifest.dependencies?.[RUNTIME_NAME] === expectedRuntimeRange,
    `packed template doc/package.json's ${RUNTIME_NAME} spec is ${JSON.stringify(docManifest.dependencies?.[RUNTIME_NAME])}, expected ${expectedRuntimeRange}`,
  );
}

async function assertTemplatePermissions(projectDir, packedTemplateDir, files) {
  for (const relative of files) {
    const templatePath = path.join(packedTemplateDir, relative === ".gitignore" ? "_gitignore" : relative);
    const projectPath = path.join(projectDir, relative);
    const templateMode = (await stat(templatePath)).mode & 0o777;
    const projectMode = (await stat(projectPath)).mode & 0o777;
    assert(
      templateMode === projectMode,
      `${relative}: mode ${projectMode.toString(8)} does not match the packed template's ${templateMode.toString(8)}`,
    );
  }
}

/**
 * Proves the scaffold's own `.gitignore` covers every cache/build path the
 * later install+build steps are about to create, using disposable probe
 * files that are removed again immediately — this runs BEFORE `pnpm install`
 * and must never leave stray content under `node_modules/`, `doc/.zfb/`, etc.
 * for the real install/build to trip over.
 */
async function assertGitignoreWorks(projectDir) {
  await run("git", ["init", "--quiet", "-b", "main"], projectDir);
  const probes = [
    "node_modules/.verify-probe",
    "doc/dist/.verify-probe",
    "doc/.zfb/.verify-probe",
    "doc/.zfb-build/.verify-probe",
    ".circuit-cache/.verify-probe",
  ];
  try {
    for (const relative of probes) {
      const target = path.join(projectDir, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, "verify-pack probe\n");
      const check = await runCapture("git", ["check-ignore", "--no-index", "--quiet", "--", relative], projectDir);
      assert(check.status === 0, `.gitignore does not ignore ${relative}`);
    }
  } finally {
    // Remove only the probe files themselves — several share a top-level
    // segment ("doc") with real scaffolded content, so removing by directory
    // would be destructive.
    await Promise.all(probes.map((relative) => unlink(path.join(projectDir, relative)).catch(() => {})));
  }
  const trackedCheck = await runCapture("git", ["check-ignore", "--no-index", "--quiet", "--", "package.json"], projectDir);
  assert(trackedCheck.status === 1, ".gitignore unexpectedly ignores package.json");
}

// #58 dropped the literal ``` fences from the initializer's "Next steps:"
// block, so the block is now found by its header and its two-space
// indentation instead: the commands are every indented, nonblank line
// directly after the header (stopping at the first blank line — any
// trailing paragraph, e.g. the --runtime-spec notice, is not indented and is
// never part of this block).
function parseNextSteps(stdout) {
  const headerIndex = stdout.indexOf("Next steps:");
  assert(headerIndex !== -1, `could not find the "Next steps:" header in initializer output:\n${stdout}`);
  const lines = stdout.slice(headerIndex + "Next steps:".length).split("\n");

  let i = 0;
  while (i < lines.length && lines[i].trim().length === 0) i += 1;

  const commands = [];
  while (i < lines.length && lines[i].startsWith("  ") && lines[i].trim().length > 0) {
    commands.push(lines[i].trim());
    i += 1;
  }
  assert(commands.length > 0, `could not find the indented "Next steps" commands in initializer output:\n${stdout}`);
  return commands;
}

async function main(options) {
  scenarioSuffix = options.publishedRuntime ? "-PUB" : "";
  let runtimeRange;
  if (options.publishedRuntime) {
    const runtimeManifest = await readJson(path.join(ROOT, "packages", "circuit-doc", "package.json"));
    runtimeRange = `^${runtimeManifest.version}`;
    console.log(`npm view ${RUNTIME_NAME}@${runtimeRange} version --json --registry=${REGISTRY_URL} (timeout ${PUBLISHED_RUNTIME_PROBE_TIMEOUT_MS}ms)`);
    const probe = classifyPublishedRuntimeProbe(await runPublishedRuntimeProbe(runtimeRange), runtimeRange);
    if (probe.verdict !== "found") {
      const message =
        probe.verdict === "not-published"
          ? `published runtime not on registry — release ${RUNTIME_NAME} first (${runtimeRange})`
          : `published runtime probe inconclusive — ${probe.detail}`;
      scenarioFail("PUBLISHED-RUNTIME-PROBE", message);
      console.error(`FAIL: verify-pack; ${failures} scenario(s) failed`);
      process.exitCode = 1;
      return;
    }
    pass("PUBLISHED-RUNTIME-PROBE", `registry returned ${probe.versions.join(", ")} for ${runtimeRange}`);
  }

  const artifacts = await mkdtempIn("circuit-doc-verify-pack-artifacts-");
  const extraction = await mkdtempIn("circuit-doc-verify-pack-extract-");
  const scratch = await mkdtempIn("circuit-doc-verify-pack-host-");
  const tempRoots = [artifacts, extraction, scratch];

  try {
    const { runtimeTarball, initExtract, runtimeExtract } = await tarballShapeChecks(ROOT, artifacts, extraction);
    const packedTemplateDir = path.join(initExtract, "templates", "default");
    const initBin = path.join(initExtract, "bin", "create-zudo-circuit-doc.js");
    const runtimeBin = path.join(runtimeExtract, "bin", "zudo-circuit-doc.js");

    if (options.fixture === "minimal") {
      await minimalFixtureFlow(ROOT, runtimeTarball, scratch);
    } else if (options.fixture === "led") {
      const ledOutDir = path.join(scratch, "led-fixture-site");
      await ledFixtureFlow(ROOT, runtimeTarball, scratch, ledOutDir);
    } else {
      await emptyFixtureFlow({
        scratch,
        initBin,
        runtimeTarball,
        packedTemplateDir,
        initExtract,
        runtimeExtract,
        publishedRuntime: options.publishedRuntime,
        runtimeRange,
      });
    }
  } finally {
    if (devServer) stopProcessGroup(devServer);
    if (options.keep) {
      console.log(`--keep: left artifacts at ${artifacts}, extraction at ${extraction}, scratch host at ${scratch}.`);
      await removeAll(createdShimMirrorDirs()); // never useful to keep — just symlink mirrors of the real PATH
    } else {
      await removeAll([...tempRoots, ...createdShimMirrorDirs()]);
    }
  }

  if (failures > 0) {
    console.error(`FAIL: verify-pack; ${failures} scenario(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log("PASS: verify-pack; every scenario passed");
}

/** The original #28 "empty" scaffold-and-install flow, unchanged apart from being extracted into its own function so `main()` can branch on `--fixture`. `devServer` is a module-scoped variable so `main()`'s `finally` can still stop it if this throws mid-flow. */
async function emptyFixtureFlow({
  scratch,
  initBin,
  runtimeTarball,
  packedTemplateDir,
  initExtract,
  runtimeExtract,
  publishedRuntime,
  runtimeRange,
}) {
  // --- INIT-05: destination with spaces, name/title/library distinct from the dir basename ---
  const hostDir = path.join(scratch, "my circuit");
  let scaffoldStdout = "";
  let scaffoldFiles = [];
  await scenario("INIT-05", "packed initializer scaffolds a spaced destination with explicit --name/--title", async () => {
    if (publishedRuntime) await assertPublishedTemplateDependencySpecs(packedTemplateDir, runtimeRange);
    const scaffoldArgs = [
      initBin,
      hostDir,
      "--name",
      "my-circuit",
      "--title",
      "My Circuit",
      "--yes",
      "--no-install",
      "--no-git",
    ];
    const expectedRuntimeSpec = publishedRuntime ? runtimeRange : `file:${runtimeTarball}`;
    if (!publishedRuntime) {
      // #58: point the scaffolded dependency straight at the packed runtime
      // tarball instead of verify-pack rewriting both manifests itself.
      scaffoldArgs.push("--runtime-spec", expectedRuntimeSpec);
    }
    scaffoldStdout = await runStreamed(process.execPath, scaffoldArgs, scratch);
    const { actual } = await assertScaffoldShape("INIT-05", hostDir, packedTemplateDir);
    scaffoldFiles = actual;
    const manifest = await readJson(path.join(hostDir, "package.json"));
    assert(manifest.name === "my-circuit", `package.json name is ${manifest.name}, expected my-circuit`);
    assert(
      manifest.devDependencies?.[RUNTIME_NAME] === expectedRuntimeSpec,
      `package.json's ${RUNTIME_NAME} spec is ${manifest.devDependencies?.[RUNTIME_NAME]}, expected ${expectedRuntimeSpec}`,
    );
    const docManifest = await readJson(path.join(hostDir, "doc", "package.json"));
    assert(docManifest.name === "my-circuit-doc", `doc/package.json name is ${docManifest.name}, expected my-circuit-doc`);
    assert(
      docManifest.dependencies?.[RUNTIME_NAME] === expectedRuntimeSpec,
      `doc/package.json's ${RUNTIME_NAME} spec is ${docManifest.dependencies?.[RUNTIME_NAME]}, expected ${expectedRuntimeSpec}`,
    );
    const circuitConfig = await readFile(path.join(hostDir, "circuit.config.ts"), "utf8");
    assert(circuitConfig.includes('title: "My Circuit"'), "circuit.config.ts project.title is not \"My Circuit\"");
    const zfbConfig = await readFile(path.join(hostDir, "doc", "zfb.config.ts"), "utf8");
    assert(zfbConfig.includes('siteName: "My Circuit"'), "doc/zfb.config.ts siteName is not \"My Circuit\"");
    const readme = await readFile(path.join(hostDir, "README.md"), "utf8"); // #60: README's line 1 uses the site title
    assert(readme.startsWith("# My Circuit\n"), `README.md does not start with the site-title heading:\n${readme.split("\n")[0]}`);
    await assertGitignoreWorks(hostDir); // also proves ADR-002's zfb/circuit-cache ignore rules
    await assertTemplatePermissions(hostDir, packedTemplateDir, scaffoldFiles);
    pass(
      "INIT-05",
      `scaffolded ${scaffoldFiles.length} files at a spaced destination with distinct name/title, no placeholder or lamp string, .gitignore proven, modes match the template, ${publishedRuntime ? `${runtimeRange} retained in both manifests` : "--runtime-spec applied to both manifests"}`,
    );
  });
  if (failures > 0) fail("INIT-05 scaffold failed; the rest of the packed-consumer flow depends on it");

  console.log("corepack pnpm install --config.strict-dep-builds=true (CI-like strictness; this machine's user config sets strictDepBuilds:false)");
  await runHeavy(
    "verify-pack:install",
    PNPM[0],
    [...PNPM.slice(1), "install", "--config.strict-dep-builds=true"],
    hostDir,
  );
  await assertForeignPackage(hostDir, RUNTIME_NAME);

  const frozenHostDir = path.join(scratch, "my-circuit-frozen");
  console.log(`Copying the installed host without node_modules to ${frozenHostDir}.`);
  await copyWithoutNodeModules(hostDir, frozenHostDir);
  assert(existsSync(path.join(frozenHostDir, "pnpm-lock.yaml")), "first install did not create pnpm-lock.yaml");
  console.log("corepack pnpm install --frozen-lockfile --config.strict-dep-builds=true (generated-lockfile proof)");
  await runHeavy(
    "verify-pack:install-frozen",
    PNPM[0],
    [...PNPM.slice(1), "install", "--frozen-lockfile", "--config.strict-dep-builds=true"],
    frozenHostDir,
  );
  await assertForeignPackage(frozenHostDir, RUNTIME_NAME);
  pass("INSTALL-FOREIGN", "the packed runtime installs under the consumer's own node_modules (root + doc/) and survives a --frozen-lockfile reinstall from a clean copy");

  // --- git init + commit (spec item 3.6) --------------------------------
  await run("git", ["add", "-A"], hostDir);
  await run(
    "git",
    ["-c", "user.name=verify-pack", "-c", "user.email=verify-pack@localhost", "commit", "--quiet", "-m", "verify-pack: initial commit"],
    hostDir,
  );

  // --- execute the printed "Next steps" block verbatim, except `pnpm dev` ---
  const nextSteps = parseNextSteps(scaffoldStdout);
  assert(nextSteps.some((line) => line === "pnpm dev"), `printed next steps did not include "pnpm dev":\n${nextSteps.join("\n")}`);
  let checkOutput = "";
  await scenario("NEXTSTEPS", "the initializer's printed Next steps block runs verbatim (pnpm dev substituted with a timed zfb dev boot)", async () => {
    for (const line of nextSteps) {
      if (line.startsWith("cd ")) continue;
      if (line === "pnpm dev") continue; // substituted below
      const [command, ...rest] = line.split(" ");
      await runHeavy(`verify-pack:next-step:${command}`, command, rest, hostDir);
    }
    const port = await freePort();
    let log = "";
    devServer = spawn(PNPM[0], [...PNPM.slice(1), "--dir", "doc", "exec", "zfb", "dev", "--port", String(port)], {
      cwd: hostDir,
      env: { ...process.env, CI: process.env.CI ?? "true", NO_COLOR: "1" },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    devServer.once("error", (error) => {
      devServer.spawnError = error;
      log += `\n${error.message}`;
    });
    devServer.stdout?.on("data", (chunk) => (log += String(chunk)));
    devServer.stderr?.on("data", (chunk) => (log += String(chunk)));
    try {
      await waitForOk(`http://127.0.0.1:${port}/docs/project/`, 300_000, devServer, () => log);
      assert(devServer.exitCode === null, `zfb dev exited unexpectedly after serving /docs/project/ (${devServer.exitCode}):\n${log}`);
    } finally {
      stopProcessGroup(devServer);
      devServer = undefined;
    }
    pass("NEXTSTEPS", "pnpm install / pnpm circuit:doctor ran verbatim; zfb dev booted on a free port and served /docs/project/ with 200");
  });

  // --- pnpm check / build / check:site ------------------------------------
  await scenario("BUILD-CHECK", "pnpm check, pnpm build and pnpm check:site all pass on the packed consumer", async () => {
    checkOutput = await runStreamed(PNPM[0], [...PNPM.slice(1), "run", "check"], hostDir);
    await runHeavy("verify-pack:build", PNPM[0], [...PNPM.slice(1), "run", "build"], hostDir);
    await runHeavy("verify-pack:check-site", PNPM[0], [...PNPM.slice(1), "run", "check:site"], hostDir);
    pass("BUILD-CHECK", "pnpm check, pnpm build and pnpm check:site all passed");
  });

  await scenario("INIT-04", "the canonical Python validator ran from node_modules (SCOPE: line present in `pnpm check` output)", async () => {
    assert(/^SCOPE: /mu.test(checkOutput), `no "SCOPE:" line found in \`pnpm check\` output:\n${checkOutput}`);
    pass("INIT-04", "`pnpm check` output includes a SCOPE: line from the packaged Python validator");
  });

  await scenario("INIT-01", "the built site shows the honest zero-state catalog copy with no record pages", async () => {
    const distComponents = path.join(hostDir, "doc", "dist", "docs", "components");
    const indexHtml = await readFile(path.join(distComponents, "index.html"), "utf8");
    assert(indexHtml.includes("No component record is published yet."), "built /docs/components/ page is missing the zero-state catalog copy");
    const recordsDir = path.join(distComponents, "records");
    if (existsSync(recordsDir)) {
      const recordEntries = await listFiles(recordsDir);
      const onlyIndex = recordEntries.every((entry) => entry === "index.html");
      assert(onlyIndex, `unexpected record pages under doc/dist/docs/components/records: ${recordEntries.join(", ")}`);
    }
    pass("INIT-01", "the built /docs/components/ page carries the zero-state catalog copy and no record detail pages");
  });

  await scenario("INIT-02", "/docs/claude-skills/ exists and no component-preview assets were published", async () => {
    const claudeSkillsDir = path.join(hostDir, "doc", "dist", "docs", "claude-skills");
    assert(existsSync(claudeSkillsDir), "doc/dist/docs/claude-skills/ was not built");
    // The models step keeps a stable (possibly empty) directory structure
    // even at zero selections, so the honest zero-component assertion is
    // "no preview asset files exist", not "the directory is absent".
    const previewsDir = path.join(hostDir, "doc", "dist", "assets", "component-previews");
    const previewFiles = existsSync(previewsDir) ? await listFiles(previewsDir) : [];
    assert(previewFiles.length === 0, `an empty project must not publish any component-preview asset files, found: ${previewFiles.join(", ")}`);
    pass("INIT-02", "/docs/claude-skills/ was built and no component-preview asset files were published");
  });

  // --- negative scenarios (fresh copies) ----------------------------------
  await scenario("NEG-INIT-03", "scaffolding into an existing non-empty destination fails with every byte unchanged", async () => {
    const destDir = path.join(scratch, "init-03-dest");
    await mkdir(destDir, { recursive: true });
    await writeFile(path.join(destDir, "keep.txt"), "pre-existing\n");
    const before = await hashTree(destDir);
    const result = await runCapture(process.execPath, [initBin, destDir, "--yes", "--no-install", "--no-git"], scratch);
    assert(result.status !== null && result.status !== 0, `expected a nonzero exit scaffolding into a non-empty destination, got ${result.status}`);
    const after = await hashTree(destDir);
    assert(before === after, "the existing destination's contents changed even though scaffolding failed");
    pass("NEG-INIT-03", `exit ${result.status}, destination byte-for-byte unchanged`);
  });

  await scenario("NEG-CONFIG", "a malformed circuit.config.ts fails `pnpm check` with exit 2", async () => {
    const dir = path.join(scratch, "neg-config");
    await copyWithLinkedNodeModules(hostDir, dir);
    await writeFile(path.join(dir, "circuit.config.ts"), "export default { this is not valid TypeScript (((\n");
    const result = await runCapture(PNPM[0], [...PNPM.slice(1), "run", "check"], dir);
    assert(result.status === 2, `expected exit 2, got ${result.status}\n${result.stdout}\n${result.stderr}`);
    pass("NEG-CONFIG", "malformed circuit.config.ts exits 2 (usage/config error)");
  });

  await scenario("NEG-INVENTORY", "a deleted inventory.json fails naming its configured path", async () => {
    const dir = path.join(scratch, "neg-inventory");
    await copyWithLinkedNodeModules(hostDir, dir);
    const inventoryRelative = ".claude/skills/component-spec-audit/references/inventory.json";
    await unlink(path.join(dir, inventoryRelative));
    const result = await runCapture(PNPM[0], [...PNPM.slice(1), "run", "circuit:check"], dir);
    assert(result.status !== null && result.status !== 0, `expected a nonzero exit, got ${result.status}`);
    assert(
      (result.stdout + result.stderr).includes(inventoryRelative),
      `failure did not name the configured path ${inventoryRelative}:\n${result.stdout}\n${result.stderr}`,
    );
    pass("NEG-INVENTORY", `exit ${result.status}, error names ${inventoryRelative}`);
  });

  await scenario("NEG-SELECTION", "a selection naming an unknown record fails STALE_SELECTION", async () => {
    const dir = path.join(scratch, "neg-selection");
    await copyWithLinkedNodeModules(hostDir, dir);
    await writeFile(
      path.join(dir, "circuit/publication/selection.json"),
      `${JSON.stringify(
        {
          schema_version: 1,
          recordIds: ["rec-ghost"],
          sourceIds: ["src-ghost"],
          linkableSourceIds: ["src-ghost"],
          documentSelections: [{ recordId: "rec-ghost", sourceId: "src-ghost", documentKind: "datasheet" }],
          expect: { records: 1, sources: 1, integrationRules: 0, packages: 0 },
        },
        null,
        2,
      )}\n`,
    );
    const result = await runCapture(PNPM[0], [...PNPM.slice(1), "run", "circuit:generate"], dir);
    assert(result.status !== null && result.status !== 0, `expected a nonzero exit, got ${result.status}`);
    assert((result.stdout + result.stderr).includes("STALE_SELECTION"), `expected STALE_SELECTION in output:\n${result.stdout}\n${result.stderr}`);
    pass("NEG-SELECTION", `exit ${result.status}, STALE_SELECTION reported`);
  });

  await scenario("MISSING-TOOLS", "with docker and chrome hidden from PATH: doctor exits 0, footprints generate needs no Docker, check-browser handled honestly", async () => {
    const dir = path.join(scratch, "missing-tools");
    await copyWithLinkedNodeModules(hostDir, dir);
    const hiddenPath = await shimmedPath(
      process.env,
      ["docker", "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"],
      ["node", "corepack", "pnpm", "git", "python3"],
    );
    const shimmedEnv = { ...process.env, PATH: hiddenPath, CI: "true" };
    delete shimmedEnv.CHROME_BIN;

    const doctor = await runCapture(PNPM[0], [...PNPM.slice(1), "run", "circuit:doctor"], dir, { env: shimmedEnv });
    assert(
      doctor.status === 0,
      `doctor should exit 0 when only optional tools are missing, got ${doctor.status}\nstdout:\n${doctor.stdout}\nstderr:\n${doctor.stderr}`,
    );
    assert(/docker\s+optional\s+missing/u.test(doctor.stdout), `doctor did not report docker as optional/missing:\n${doctor.stdout}`);
    assert(/chrome\s+optional\s+missing/u.test(doctor.stdout), `doctor did not report chrome as optional/missing:\n${doctor.stdout}`);
    pass("DOCTOR-OPTIONAL", "doctor exits 0 with docker and chrome reported as missing optional tools");

    const footprints = await runCapture(PNPM[0], [...PNPM.slice(1), "exec", "zudo-circuit-doc", "footprints", "generate"], dir, { env: shimmedEnv });
    assert(footprints.status === 0, `footprints generate on a zero-package project should exit 0, got ${footprints.status}\n${footprints.stdout}\n${footprints.stderr}`);
    pass("CAD-05", "footprints generate exits 0 on the empty project without invoking Docker (zero selections need no renderer)");

    const checkBrowser = await runCapture(PNPM[0], [...PNPM.slice(1), "exec", "zudo-circuit-doc", "check-browser"], dir, { env: shimmedEnv });
    if (/not implemented yet \(tracked in #27\)/u.test(checkBrowser.stderr)) {
      skip("CHECK-BROWSER", "check-browser is still the #18 stub (exit 2, \"not implemented yet\") — #27 (browser smoke) has not landed on this base yet; the exit-4 \"not run: Chrome not found\" contract is asserted once it does");
    } else {
      assert(checkBrowser.status === 4, `expected exit 4, got ${checkBrowser.status}\n${checkBrowser.stdout}\n${checkBrowser.stderr}`);
      assert((checkBrowser.stdout + checkBrowser.stderr).includes("not run: Chrome not found"), `expected "not run: Chrome not found":\n${checkBrowser.stdout}\n${checkBrowser.stderr}`);
      pass("CHECK-BROWSER", "check-browser exits 4 with \"not run: Chrome not found\" when Chrome is hidden from PATH");
    }
  });

  await scenario("NEG-INTERRUPTED-INSTALL", "the initializer WITH install against a failing pnpm shim exits 1, prints recovery, keeps the files", async () => {
    const shimDir = path.join(scratch, "failing-pnpm-shim");
    writeShim(shimDir, "pnpm", "echo \"pnpm: simulated install failure\" >&2\nexit 7");
    const destDir = path.join(scratch, "interrupted-install");
    const env = { ...process.env, PATH: `${shimDir}${path.delimiter}${process.env.PATH ?? ""}`, CI: "true" };
    const result = await runCapture(process.execPath, [initBin, destDir, "--yes", "--no-git"], scratch, { env });
    assert(result.status === 1, `expected exit 1, got ${result.status}\n${result.stdout}\n${result.stderr}`);
    assert(!result.stdout.includes("Created "), `success banner printed despite the install failure:\n${result.stdout}`);
    assert(result.stdout.includes("Recovery:"), `no Recovery: block printed:\n${result.stdout}`);
    assert(result.stdout.includes("pnpm install"), `Recovery block did not include "pnpm install":\n${result.stdout}`);
    assert(existsSync(path.join(destDir, "package.json")), "scaffolded files were not kept after the install failure");
    pass("NEG-INTERRUPTED-INSTALL", `exit 1, no success banner, recovery commands printed, scaffolded files kept at ${path.relative(scratch, destDir)}`);
  });

  await scenario(
    "VERSION-MATCH",
    publishedRuntime
      ? "the initializer version matches the installed published runtime and the runtime satisfies the template caret range"
      : "--version of both packed bins equals their own package.json version",
    async () => {
      // create-zudo-circuit-doc has zero runtime dependencies, so its extracted
      // (uninstalled) tarball copy runs standalone. @takazudo/zudo-circuit-doc
      // does not: its CLI module graph eagerly imports real dependencies
      // (three, mdast-util-*), so it can only run from an INSTALLED copy —
      // the already-installed hostDir, via `pnpm exec`.
      const initResult = await runCapture(process.execPath, [initBin, "--version"], scratch);
      const initVersion = initResult.stdout.trim();
      assert(initResult.status === 0, `create-zudo-circuit-doc --version exited ${initResult.status}:\n${initResult.stderr}`);
      assert(
        initVersion === (await readJson(path.join(initExtract, "package.json"))).version,
        `create-zudo-circuit-doc --version printed ${JSON.stringify(initVersion)} (exit ${initResult.status})\n${initResult.stderr}`,
      );
      const runtimeResult = await runCapture(PNPM[0], [...PNPM.slice(1), "exec", "zudo-circuit-doc", "--version"], hostDir);
      // `pnpm exec` can print its own reporter lines ("Scope: …", "Recreating
      // …/node_modules", "Progress: …") to stdout ahead of the invoked
      // command's own output whenever it reconciles node_modules against this
      // call's effective config (e.g. after an earlier install ran with a
      // different --config.strict-dep-builds value, as NEXTSTEPS's verbatim
      // "pnpm install" does versus this scenario's ambient config) — take the
      // last non-blank line as the actual --version output.
      const runtimeLines = runtimeResult.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
      const runtimeVersion = runtimeLines.at(-1) ?? "";
      assert(runtimeResult.status === 0, `zudo-circuit-doc --version exited ${runtimeResult.status}:\n${runtimeResult.stderr}`);
      const installedRuntimeManifest = await readJson(path.join(hostDir, "node_modules", ...RUNTIME_NAME.split("/"), "package.json"));
      if (publishedRuntime) {
        assert(
          versionSatisfiesCaretRange(installedRuntimeManifest.version, runtimeRange),
          `installed runtime version ${installedRuntimeManifest.version} does not satisfy ${runtimeRange}`,
        );
      }
      const expectedRuntimeVersion = publishedRuntime
        ? installedRuntimeManifest.version
        : (await readJson(path.join(runtimeExtract, "package.json"))).version;
      assert(
        runtimeVersion === expectedRuntimeVersion,
        `zudo-circuit-doc --version printed ${JSON.stringify(runtimeResult.stdout)}, expected installed runtime ${expectedRuntimeVersion}\n${runtimeResult.stderr}`,
      );
      pass(
        "VERSION-MATCH",
        publishedRuntime
          ? `create-zudo-circuit-doc --version=${initVersion}, installed runtime --version=${runtimeVersion}, satisfies ${runtimeRange}`
          : `create-zudo-circuit-doc --version=${initVersion}, zudo-circuit-doc --version=${runtimeVersion}`,
      );
    },
  );

  await scenario("AGENT-VARIANTS", "--agent none/codex/claude produce the documented CLAUDE.md/AGENTS.md subsets; .claude/skills/** always stays", async () => {
    const matrix = [
      { agent: "none", claudeMd: false, agentsMd: false },
      { agent: "codex", claudeMd: false, agentsMd: true },
      { agent: "claude", claudeMd: true, agentsMd: false },
    ];
    for (const { agent, claudeMd, agentsMd } of matrix) {
      const dir = path.join(scratch, `agent-${agent}`);
      await run(process.execPath, [initBin, dir, "--yes", "--no-install", "--no-git", "--agent", agent], scratch);
      assert(existsSync(path.join(dir, "CLAUDE.md")) === claudeMd, `--agent ${agent}: CLAUDE.md presence should be ${claudeMd}`);
      assert(existsSync(path.join(dir, "AGENTS.md")) === agentsMd, `--agent ${agent}: AGENTS.md presence should be ${agentsMd}`);
      assert(
        existsSync(path.join(dir, ".claude/skills/component-spec-audit/SKILL.md")),
        `--agent ${agent}: .claude/skills/** must always be present`,
      );
    }
    pass("AGENT-VARIANTS", "none removes both thin entries, codex keeps only AGENTS.md, claude keeps only CLAUDE.md; .claude/skills/** always stays");
  });
}

// --- "minimal" fixture (#31): examples/minimal (one CAD-enabled record) ----

const MINIMAL_BROWSER_REPRESENTATIVES = {
  representatives: [{ kind: "IC", path: "/docs/components/records/tmp1075dr/", slug: "tmp1075dr", identity: "TMP1075DR" }],
};

/**
 * Overlays examples/minimal onto a tarball-installed consumer OUTSIDE the
 * monorepo — the same out-of-workspace proof #28 runs for "empty", seeded
 * with a real CAD-enabled project (the TMP1075DR footprint SVG + WRL model)
 * instead of the generic template. examples/minimal's own
 * package.json/doc/package.json already declare `@takazudo/zudo-circuit-doc`
 * as a dependency (`workspace:*` inside this monorepo); `installLocalTarball`
 * rewrites that one field to the local tarball, exactly like the "empty"
 * flow's `hostDir`, and every `pnpm` script it needs (`check`, `build`,
 * `check:site`, `circuit:*`) is already defined in examples/minimal's own
 * package.json.
 */
async function minimalFixtureFlow(root, runtimeTarball, scratch) {
  const hostDir = path.join(scratch, "minimal-consumer");
  await copyWithoutNodeModules(path.join(root, "examples/minimal"), hostDir);
  await installLocalTarball(hostDir, runtimeTarball, "package.json", RUNTIME_NAME);
  await installLocalTarball(hostDir, runtimeTarball, "doc/package.json", RUNTIME_NAME, "../");
  // examples/minimal has no pnpm-workspace.yaml of its own — inside the
  // monorepo it inherits the root's `allowBuilds: esbuild: true` (zfb's
  // esbuild dependency needs its install script to run). Outside the
  // monorepo it needs its own, same as the initializer's own scaffolded
  // templates/default/pnpm-workspace.yaml.
  await writeFile(
    path.join(hostDir, "pnpm-workspace.yaml"),
    'packages: ["doc"]\nminimumReleaseAge: 0\nallowBuilds:\n  esbuild: true\n',
  );

  console.log("corepack pnpm install --config.strict-dep-builds=true (examples/minimal, packed runtime)");
  await runHeavy("verify-pack:minimal-install", PNPM[0], [...PNPM.slice(1), "install", "--config.strict-dep-builds=true"], hostDir);
  await assertForeignPackage(hostDir, RUNTIME_NAME);
  pass("INSTALL-FOREIGN", "examples/minimal installs the packed runtime under its own node_modules (root + doc/)");

  let checkOutput = "";
  await scenario(
    "BUILD-CHECK",
    "pnpm check, pnpm build and pnpm check:site all pass on the packed minimal consumer",
    async () => {
      checkOutput = await runStreamed(PNPM[0], [...PNPM.slice(1), "run", "check"], hostDir);
      await runHeavy("verify-pack:minimal-build", PNPM[0], [...PNPM.slice(1), "run", "build"], hostDir);
      await runHeavy("verify-pack:minimal-check-site", PNPM[0], [...PNPM.slice(1), "run", "check:site"], hostDir);
      pass(
        "BUILD-CHECK",
        "pnpm check, pnpm build and pnpm check:site all passed (check-built 1/1/1, scan, authored→generated links under --strict-broken/--strict-anchors)",
      );
    },
  );

  await scenario("INIT-04", "the canonical Python validator ran from node_modules (SCOPE: line present in `pnpm check` output)", async () => {
    assert(/^SCOPE: /mu.test(checkOutput), `no "SCOPE:" line found in \`pnpm check\` output:\n${checkOutput}`);
    pass("INIT-04", "`pnpm check` output includes a SCOPE: line from the packaged Python validator");
  });

  const recordHtmlPath = path.join(hostDir, "doc", "dist", "docs", "components", "records", "tmp1075dr", "index.html");
  const recordHtml = await readFile(recordHtmlPath, "utf8");

  await scenario(
    "ISLANDS-MINIMAL",
    "the built TMP1075DR record page carries both island markers, and a built client script's islands manifest lists both components",
    async () => {
      for (const island of ["FootprintPreviewIsland", "PackageModelViewerIsland"]) {
        assert(
          new RegExp(`data-zfb-island=(?:"${island}"|${island})(?:\\s|>)`, "u").test(recordHtml),
          `record page is missing the ${island} island marker (also enforced by \`check-built\`, run above)`,
        );
      }
      const distJsFiles = (await listFiles(path.join(hostDir, "doc", "dist"))).filter((entry) => entry.endsWith(".js"));
      let manifestHasBoth = false;
      for (const relative of distJsFiles) {
        const source = await readFile(path.join(hostDir, "doc", "dist", relative), "utf8");
        if (source.includes("FootprintPreviewIsland") && source.includes("PackageModelViewerIsland")) {
          manifestHasBoth = true;
          break;
        }
      }
      assert(manifestHasBoth, "no built client script registers both FootprintPreviewIsland and PackageModelViewerIsland in its islands manifest");
      pass("ISLANDS-MINIMAL", "record page carries both island markers; the built islands manifest lists both components");
    },
  );

  await scenario("CAD-01", "the family label (fidelity family, not TI CAD) is visible on the minimal record", async () => {
    assert(recordHtml.includes("fidelity family"), 'built tmp1075dr record page does not mention "fidelity family"');
    pass("CAD-01", 'built record page shows the "fidelity family" CAD fidelity label');
  });

  await scenario("PART-02", "a non-LCSC generic inventory line renders on the minimal record", async () => {
    assert(
      recordHtml.includes("Not assigned; order by exact manufacturer part number"),
      "built tmp1075dr record page does not render the non-LCSC generic-inventory line",
    );
    pass("PART-02", 'built record page shows the non-LCSC "Not assigned; order by exact manufacturer part number" line');
  });

  await scenario("CAD-COVERAGE", "coverage badges show cad-assets COVERED and cad-physical-fit OPEN on the minimal record", async () => {
    assert(recordHtml.includes("cov-tmp1075-cad-assets"), "built record page is missing the cad-assets coverage domain");
    assert(recordHtml.includes("cov-tmp1075-cad-physical-fit"), "built record page is missing the cad-physical-fit coverage domain");
    assert(recordHtml.includes("COVERED"), "built record page has no COVERED coverage status");
    assert(recordHtml.includes("OPEN"), "built record page has no OPEN coverage status");
    pass("CAD-COVERAGE", "record page renders cad-assets (COVERED) and cad-physical-fit (OPEN) coverage domains");
  });

  const representativesPath = path.join(scratch, "minimal-browser-representatives.json");
  await writeFile(representativesPath, `${JSON.stringify(MINIMAL_BROWSER_REPRESENTATIVES, null, 2)}\n`);
  await scenario(
    "M4",
    "check-browser on the packed minimal site: footprint dialog, WRL viewer hydration, SPA dispose/remount after client navigation, direct reload, system appearance, no-JS fallback, forced failures",
    async () => {
      const result = await runCapture(
        PNPM[0],
        [
          ...PNPM.slice(1),
          "exec",
          "zudo-circuit-doc",
          "check-browser",
          "--representatives",
          representativesPath,
          "--shell-assertions",
          "--search-assertions",
        ],
        hostDir,
      );
      if (result.status === 4 && !process.env.CI) {
        skip("M4", `check-browser: not run: Chrome not found (${(result.stdout + result.stderr).trim()})`);
        return;
      }
      assert(result.status === 0, `check-browser failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
      pass("M4", `check-browser passed on the TMP1075DR record: ${result.stdout.trim().split("\n").at(-1)}`);
    },
  );

  console.log(
    "MANUAL VERIFICATION STILL NEEDED (not asserted by check-browser or the static checks above): the exact " +
      '"shared footprint package" notice copy under the model viewer reads correctly in context, and the ' +
      "cad-assets/cad-physical-fit coverage reasons read sensibly to a human — check-browser's generic " +
      "reference-page inspection proves hydration, dialogs, geometry and theming, not fixture-specific prose.",
  );

  // --- Docker-missing case (CAD enabled), spec item 1 -----------------------
  const dockerMissingDir = path.join(scratch, "minimal-docker-missing");
  await copyWithLinkedNodeModules(hostDir, dockerMissingDir);
  await scenario(
    "CAD-DOCKER-MISSING",
    "with Docker hidden from PATH, footprints generate exits 4 with the targeted message and footprints check still passes",
    async () => {
      const hiddenPath = await shimmedPath(process.env, ["docker"], ["node", "corepack", "pnpm", "git", "python3"]);
      const shimmedEnv = { ...process.env, PATH: hiddenPath, CI: "true" };

      const generateResult = await runCapture(
        PNPM[0],
        [...PNPM.slice(1), "exec", "zudo-circuit-doc", "footprints", "generate"],
        dockerMissingDir,
        { env: shimmedEnv },
      );
      assert(
        generateResult.status === 4,
        `expected exit 4 with Docker hidden, got ${generateResult.status}\n${generateResult.stdout}\n${generateResult.stderr}`,
      );
      assert(
        (generateResult.stdout + generateResult.stderr).includes("not run: Docker is required for footprint preview generation"),
        `expected the targeted Docker-missing message:\n${generateResult.stdout}\n${generateResult.stderr}`,
      );

      const checkResult = await runCapture(
        PNPM[0],
        [...PNPM.slice(1), "exec", "zudo-circuit-doc", "footprints", "check"],
        dockerMissingDir,
        { env: shimmedEnv },
      );
      assert(
        checkResult.status === 0,
        `footprints check should pass without Docker, got ${checkResult.status}\n${checkResult.stdout}\n${checkResult.stderr}`,
      );
      pass("CAD-DOCKER-MISSING", "footprints generate exits 4 with the targeted Docker message; footprints check passes with no Docker");
    },
  );
}

// --- "led" fixture (#31): the 35-record LED corpus in tarball mode ---------

/**
 * Drives `scripts/build-fixture-site.mjs --fixture led` (#23) with
 * `--tarballs`, pointing it at THIS run's already-packed
 * `@takazudo/zudo-circuit-doc` tarball instead of packing a second one —
 * the `--tarballs` mode #23 reserved for #31 (`findPrebuiltTarball` in
 * `scripts/lib/fixture-site.mjs`). That harness already asserts zero
 * generate/models drift against the pinned goldens and runs check:site
 * (check-built 35/25, scan against the fixture's re-baselined policy,
 * check-links --strict-anchors --strict-broken); this function only adds the
 * check-browser pass on top, the same way `.github/workflows/ci-browser.yml`
 * drives it against the (non-tarball) fixture site build.
 */
async function ledFixtureFlow(root, runtimeTarball, scratch, ledOutDir) {
  const tarballsDir = path.join(scratch, "led-tarballs");
  await mkdir(tarballsDir, { recursive: true });
  await cp(runtimeTarball, path.join(tarballsDir, path.basename(runtimeTarball)));

  await scenario(
    "LED-SITE-BUILD",
    "the LED fixture site builds from the local runtime tarball with zero generate/models drift, and check:site passes (check-built 35/25, scan, check-links --strict-anchors --strict-broken)",
    async () => {
      await runHeavy(
        "verify-pack:led-site",
        process.execPath,
        ["scripts/build-fixture-site.mjs", "--fixture", "led", "--tarballs", tarballsDir, "--out", ledOutDir, "--keep"],
        root,
      );
      pass(
        "LED-SITE-BUILD",
        "build-fixture-site.mjs --fixture led --tarballs <dir> passed: pnpm install / build / check:site with zero drift against the pinned LED goldens",
      );
    },
  );

  await scenario(
    "M4",
    "check-browser on the packed LED fixture site: 4 representatives (passive/IC/connector/unavailable-history), footprint dialogs, WRL viewers, SPA dispose/remount, shell + search assertions",
    async () => {
      // #41: must run through the tarball-installed CLI (ledOutDir's own
      // node_modules/.bin), not the monorepo's packages/circuit-doc/bin —
      // otherwise a `files` packaging gap would never surface on this leg.
      // ledOutDir already carries its own circuit.config.ts (docs.dist ==
      // "doc/dist", matching the site build's actual output) and
      // circuit/browser-representatives.json, both derived from the fixture
      // by build-fixture-site.mjs, so no --config/--dist override is needed
      // — mirrors the `minimal` leg's `pnpm exec zudo-circuit-doc` call above.
      await assertForeignPackage(ledOutDir, RUNTIME_NAME);
      const cliRealpath = await realpath(path.join(ledOutDir, "node_modules", ".bin", "zudo-circuit-doc"));
      const rootRealpath = `${await realpath(root)}${path.sep}`;
      assert(
        !cliRealpath.startsWith(rootRealpath),
        `check-browser would run the monorepo's own CLI instead of the packed one: ${cliRealpath}`,
      );
      const scratchRealpath = `${await realpath(ledOutDir)}${path.sep}`;
      assert(
        cliRealpath.startsWith(scratchRealpath),
        `resolved CLI path is not inside the scratch consumer (${ledOutDir}): ${cliRealpath}`,
      );

      const result = await runCapture(
        PNPM[0],
        [
          ...PNPM.slice(1),
          "exec",
          "zudo-circuit-doc",
          "check-browser",
          "--representatives",
          "circuit/browser-representatives.json",
          "--shell-assertions",
          "--search-assertions",
        ],
        ledOutDir,
      );
      if (result.status === 4 && !process.env.CI) {
        skip("M4", `check-browser: not run: Chrome not found (${(result.stdout + result.stderr).trim()})`);
        return;
      }
      assert(result.status === 0, `check-browser failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
      pass("M4", `check-browser passed on the LED fixture site: ${result.stdout.trim().split("\n").at(-1)}`);
    },
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  let options;
  try {
    options = parseVerifyPackArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
  if (options) {
    main(options).catch((error) => {
      console.error(error instanceof VerifyError || error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
