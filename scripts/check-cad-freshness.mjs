#!/usr/bin/env node
// CAD-03: a footprint edit must make the committed preview stale. On a
// throwaway copy of a CAD-enabled project, change one byte of a selected
// footprint (its master copy and its byte-identical `.pretty` copy) and assert
// `footprints check` fails until the preview is regenerated. #32 reuses this
// script unchanged.
//
// Requires `packages/circuit-doc` to be built first (`pnpm build`): every case
// runs the real CLI binary against the scratch copy. Docker is not needed,
// except with --regenerate, which also proves that `footprints generate`
// (pinned KiCad image, already pulled) makes the edited copy current again.
//
// Usage: node scripts/check-cad-freshness.mjs <project-dir> [--regenerate]
//
// Exit codes: 0 pass, 1 a case failed, 2 usage error, 4 --regenerate not run
// (Docker or the pinned image is missing).

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CLI_BIN = path.join(REPO_ROOT, "packages/circuit-doc/bin/zudo-circuit-doc.js");
// `bin/` is committed and only imports the gitignored build output, so probe that.
const CLI_BUILT = path.join(REPO_ROOT, "packages/circuit-doc/lib/cli/main.js");
const COPY_EXCLUDE = new Set(["node_modules", ".git", "dist", ".zfb", ".zfb-build", ".zudo-doc", ".circuit-cache"]);
const EXIT_NOT_RUN = 4;
const PREVIEW_MANIFEST = "doc/public/assets/component-previews/footprints/manifest.json";

function usage(message) {
  console.error(`usage: node scripts/check-cad-freshness.mjs <project-dir> [--regenerate]\n${message ?? ""}`.trim());
  process.exit(2);
}

const args = process.argv.slice(2);
const regenerate = args.includes("--regenerate");
const positionals = args.filter((arg) => arg !== "--regenerate");
if (positionals.length !== 1 || args.some((arg) => arg.startsWith("--") && arg !== "--regenerate")) {
  usage("expected exactly one project directory");
}
const sourceProject = path.resolve(positionals[0]);
if (!existsSync(sourceProject)) usage(`not a directory: ${positionals[0]}`);
if (!existsSync(CLI_BUILT)) {
  console.error(`missing ${path.relative(REPO_ROOT, CLI_BUILT)} — run \`pnpm build\` first`);
  process.exit(1);
}

let failures = 0;
const scratchDirs = [];

function check(label, condition, detail) {
  if (condition) {
    console.log(`PASS: ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL: ${label}`);
  if (detail) console.log(detail.replace(/^/gm, "  "));
}

function freshProject() {
  const dir = mkdtempSync(path.join(tmpdir(), "circuit-cad03-"));
  scratchDirs.push(dir);
  const dest = path.join(dir, "project");
  cpSync(sourceProject, dest, { recursive: true, filter: (src) => !COPY_EXCLUDE.has(path.basename(src)) });
  return dest;
}

function runCli(projectDir, cliArgs) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...cliArgs], {
    cwd: projectDir,
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  if (result.error) throw result.error;
  return result;
}

const describeResult = (result) => `exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;

/** The first selected footprint, as the committed preview manifest names it. */
function selectedFootprint(projectDir) {
  const manifestPath = findPreviewManifest(projectDir);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry = manifest.packages?.[0];
  if (entry === undefined) {
    throw new Error(`${path.relative(projectDir, manifestPath)} selects no package: CAD-03 needs a CAD-enabled project with one`);
  }
  const libraryCopy = path.join(projectDir, entry.footprintPath);
  const masterCopy = path.join(path.dirname(path.dirname(libraryCopy)), `${entry.footprintName}.kicad_mod`);
  return { name: entry.footprintName, libraryCopy, masterCopy };
}

function findPreviewManifest(projectDir) {
  const manifestPath = path.join(projectDir, PREVIEW_MANIFEST);
  if (!existsSync(manifestPath)) throw new Error(`no committed footprint preview manifest at ${PREVIEW_MANIFEST}`);
  return manifestPath;
}

/** Change one byte of the first pad size, e.g. `(size 1.95 0.6)` -> `(size 1.97 0.6)`. */
function mutateOneByte(text) {
  const match = /\(size (\d+\.\d*)(\d)\s/u.exec(text);
  if (match === null) throw new Error("footprint has no pad size to mutate");
  const digitIndex = match.index + "(size ".length + match[1].length;
  const replacement = match[2] === "7" ? "3" : "7";
  return text.slice(0, digitIndex) + replacement + text.slice(digitIndex + 1);
}

function caseBaseline() {
  const project = freshProject();
  const result = runCli(project, ["footprints", "check"]);
  check("unmodified copy: footprints check passes", result.status === 0, describeResult(result));
}

function caseEditedFootprintIsStale() {
  const project = freshProject();
  const footprint = selectedFootprint(project);
  const original = readFileSync(footprint.masterCopy, "utf8");
  check(
    `${footprint.name}: master and .pretty copies start byte-identical`,
    original === readFileSync(footprint.libraryCopy, "utf8"),
  );
  const edited = mutateOneByte(original);
  writeFileSync(footprint.masterCopy, edited);
  writeFileSync(footprint.libraryCopy, edited);

  const stale = runCli(project, ["footprints", "check"]);
  check(
    `${footprint.name}: one-byte edit in both copies makes footprints check FAIL (stale preview)`,
    stale.status === 1 && stale.stderr.includes(`stale canonical input hash for ${footprint.name}`),
    describeResult(stale),
  );

  const aggregate = runCli(project, ["check"]);
  check(
    `${footprint.name}: \`check\` also fails while the preview is stale`,
    aggregate.status === 1 && /stale canonical input hash/u.test(aggregate.stdout + aggregate.stderr),
    describeResult(aggregate),
  );

  if (!regenerate) {
    writeFileSync(footprint.masterCopy, original);
    writeFileSync(footprint.libraryCopy, original);
    const restored = runCli(project, ["footprints", "check"]);
    check(`${footprint.name}: restoring the byte makes footprints check pass again`, restored.status === 0, describeResult(restored));
    return;
  }

  const generated = runCli(project, ["footprints", "generate"]);
  if (generated.status === EXIT_NOT_RUN) {
    console.log(`NOT RUN: --regenerate needs Docker and the pinned KiCad image\n${generated.stderr.replace(/^/gm, "  ")}`);
    return EXIT_NOT_RUN;
  }
  check(`${footprint.name}: footprints generate on the edited copy succeeds`, generated.status === 0, describeResult(generated));
  const current = runCli(project, ["footprints", "check"]);
  check(`${footprint.name}: after regeneration footprints check passes`, current.status === 0, describeResult(current));
}

function caseMasterOnlyEditBreaksParity() {
  const project = freshProject();
  const footprint = selectedFootprint(project);
  writeFileSync(footprint.masterCopy, mutateOneByte(readFileSync(footprint.masterCopy, "utf8")));
  const result = runCli(project, ["footprints", "check"]);
  check(
    `${footprint.name}: editing only the master copy fails the dual-location parity check`,
    result.status === 1 && result.stderr.includes(`dual-location footprint bytes differ: ${footprint.name}.kicad_mod`),
    describeResult(result),
  );
}

let notRun = false;
try {
  caseBaseline();
  notRun = caseEditedFootprintIsStale() === EXIT_NOT_RUN;
  caseMasterOnlyEditBreaksParity();
} catch (error) {
  console.error(`CAD-03: ${error.message}`);
  process.exitCode = 1;
} finally {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
}

if (process.exitCode === 1) process.exit(1);
if (failures > 0) {
  console.log(`\nCAD-03: ${failures} case(s) failed`);
  process.exit(1);
}
if (notRun) {
  console.log("\nCAD-03: offline cases passed; regeneration not run");
  process.exit(EXIT_NOT_RUN);
}
console.log("\nCAD-03: all cases passed");
