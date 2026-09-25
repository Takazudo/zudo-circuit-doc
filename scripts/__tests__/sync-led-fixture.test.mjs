// Exercises sync-led-fixture.mjs against a synthetic temp git repo (not the real,
// pinned zudo-led-lamp commit) so these tests run offline and don't depend on
// fixtures/led actually being materialized.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  buildLockFromSource,
  checkFixture,
  gitSource,
  isAllowedLocal,
  materializeStep,
  sha1GitBlob,
  sha256Hex,
  writeUpstreamFiles,
} from "../sync-led-fixture.mjs";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function writeFile(root, relPath, content) {
  const dest = path.join(root, relPath);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, content);
}

// Builds a synthetic upstream repo that mirrors the real LED layout closely enough
// for deriveFileList's fixed path rules (footprints/kicad/**, the manifest, the
// explicit schgen/symbol/preflight/selection.ts files, and the doc prefixes) to
// pick up exactly one package with one WRL/STEP pair.
function makeSyntheticRepo() {
  const cloneDir = mkdtempSync(path.join(tmpdir(), "led-fixture-src-"));
  git(cloneDir, "init", "-q");
  git(cloneDir, "config", "user.email", "test@example.com");
  git(cloneDir, "config", "user.name", "Test");

  for (const f of [
    "scripts/schgen/board_p_spec.py",
    "scripts/schgen/board_l_spec.py",
    "scripts/schgen/swd_adapter_spec.py",
    "scripts/schgen/verify_power_switch.py",
    "scripts/schgen/schgen_core.py",
    "scripts/schgen/sexp.py",
  ]) {
    writeFile(cloneDir, f, `# ${f}\n`);
  }
  writeFile(cloneDir, "symbols/zudo-led-lamp.kicad_sym", "(kicad_symbol_lib)\n");
  writeFile(cloneDir, "doc/component-docs/preflight.json", '{"records":0}\n');
  writeFile(cloneDir, "doc/component-docs/adapters/circuit/selection.ts", "export const x = 1;\n");
  writeFile(cloneDir, ".claude/skills/component-spec-audit/SKILL.md", "# audit skill\n");
  writeFile(cloneDir, "doc/src/content/docs/components/pkg1.mdx", "# PKG1\n");
  writeFile(
    cloneDir,
    "doc/public/assets/component-previews/footprints/manifest.json",
    JSON.stringify({
      packages: [
        { footprintName: "PKG1", footprintPath: "footprints/kicad/zudo-led-lamp.pretty/PKG1.kicad_mod" },
      ],
    }),
  );
  writeFile(cloneDir, "footprints/kicad/PKG1.kicad_mod", "(module easyeda2kicad:PKG1)\n");
  writeFile(
    cloneDir,
    "footprints/kicad/zudo-led-lamp.pretty/PKG1.kicad_mod",
    '(footprint (model "${KIPRJMOD}/../../footprints/kicad/zudo-led-lamp.3dshapes/pkg1.wrl"))\n',
  );
  writeFile(cloneDir, "footprints/kicad/zudo-led-lamp.3dshapes/pkg1.wrl", "#VRML V2.0 utf8\n");
  writeFile(cloneDir, "footprints/kicad/zudo-led-lamp.3dshapes/pkg1.step", "ISO-10303-21;\nfake step bytes\n");

  git(cloneDir, "add", "-A");
  git(cloneDir, "commit", "-q", "-m", "synthetic LED-like corpus");
  const commit = git(cloneDir, "rev-parse", "HEAD").trim();
  return { cloneDir, commit };
}

describe("sync-led-fixture", () => {
  let cloneDir;
  let commit;
  let fixtureDir;

  before(() => {
    ({ cloneDir, commit } = makeSyntheticRepo());
  });

  after(() => {
    rmSync(cloneDir, { recursive: true, force: true });
  });

  function freshFixtureDir() {
    fixtureDir = mkdtempSync(path.join(tmpdir(), "led-fixture-out-"));
    return fixtureDir;
  }

  test("derives 16 files with exactly one materialized STEP", () => {
    const source = gitSource(cloneDir, commit);
    const lock = buildLockFromSource(source, { repository: "test/led", commit });
    assert.equal(lock.fileCount, 16);
    const stepEntries = lock.files.filter((f) => f.materialized);
    assert.equal(stepEntries.length, 1);
    assert.equal(stepEntries[0].path, "footprints/kicad/zudo-led-lamp.3dshapes/pkg1.step");
  });

  test("gitBlob matches git's own hash-object for every derived file", () => {
    const source = gitSource(cloneDir, commit);
    const lock = buildLockFromSource(source, { repository: "test/led", commit });
    for (const f of lock.files) {
      const bytes = source.readBytes(f.path);
      assert.equal(sha1GitBlob(bytes), f.gitBlob, f.path);
      assert.equal(sha256Hex(bytes), f.sha256, f.path);
    }
  });

  test("--check passes on a freshly written fixture, materialized 0/1", () => {
    const dir = freshFixtureDir();
    const source = gitSource(cloneDir, commit);
    const lock = buildLockFromSource(source, { repository: "test/led", commit });
    const upstreamDir = path.join(dir, "upstream");
    mkdirSync(upstreamDir, { recursive: true });
    writeUpstreamFiles(source, lock, upstreamDir);
    writeFileSync(path.join(dir, "fixture.lock.json"), JSON.stringify(lock, null, 2));

    // STEP must not be written by writeUpstreamFiles.
    assert.equal(existsSync(path.join(upstreamDir, "footprints/kicad/zudo-led-lamp.3dshapes/pkg1.step")), false);

    const result = checkFixture({ fixtureDir: dir });
    assert.equal(result.ok, true, result.problems.join("; "));
    assert.equal(result.materializedCount, 0);
    assert.equal(result.materializedTotal, 1);
  });

  test("materialize-step writes and verifies the STEP file, then --check reports 1/1", () => {
    const dir = freshFixtureDir();
    const source = gitSource(cloneDir, commit);
    const lock = buildLockFromSource(source, { repository: "test/led", commit });
    const upstreamDir = path.join(dir, "upstream");
    mkdirSync(upstreamDir, { recursive: true });
    writeUpstreamFiles(source, lock, upstreamDir);
    writeFileSync(path.join(dir, "fixture.lock.json"), JSON.stringify(lock, null, 2));

    const { count, total } = materializeStep(source, lock, upstreamDir);
    assert.equal(count, 1);
    assert.equal(total, 1);

    const result = checkFixture({ fixtureDir: dir });
    assert.equal(result.ok, true, result.problems.join("; "));
    assert.equal(result.materializedCount, 1);
  });

  test("--check detects hash drift in a committed file", () => {
    const dir = freshFixtureDir();
    const source = gitSource(cloneDir, commit);
    const lock = buildLockFromSource(source, { repository: "test/led", commit });
    const upstreamDir = path.join(dir, "upstream");
    mkdirSync(upstreamDir, { recursive: true });
    writeUpstreamFiles(source, lock, upstreamDir);
    writeFileSync(path.join(dir, "fixture.lock.json"), JSON.stringify(lock, null, 2));

    writeFileSync(path.join(upstreamDir, "symbols/zudo-led-lamp.kicad_sym"), "(tampered)\n");

    const result = checkFixture({ fixtureDir: dir });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.includes("hash drift: symbols/zudo-led-lamp.kicad_sym")));
  });

  test("--check rejects an extra file outside the lock", () => {
    const dir = freshFixtureDir();
    const source = gitSource(cloneDir, commit);
    const lock = buildLockFromSource(source, { repository: "test/led", commit });
    const upstreamDir = path.join(dir, "upstream");
    mkdirSync(upstreamDir, { recursive: true });
    writeUpstreamFiles(source, lock, upstreamDir);
    writeFileSync(path.join(dir, "fixture.lock.json"), JSON.stringify(lock, null, 2));

    writeFile(dir, "upstream/not-in-lock.txt", "surprise\n");

    const result = checkFixture({ fixtureDir: dir });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.includes("extra file outside the lock: upstream/not-in-lock.txt")));
  });

  test("--check rejects a fixture-root file outside the localFiles allowlist, and allows an allowlisted one", () => {
    const dir = freshFixtureDir();
    const source = gitSource(cloneDir, commit);
    const lock = buildLockFromSource(source, { repository: "test/led", commit });
    const upstreamDir = path.join(dir, "upstream");
    mkdirSync(upstreamDir, { recursive: true });
    writeUpstreamFiles(source, lock, upstreamDir);
    writeFileSync(path.join(dir, "fixture.lock.json"), JSON.stringify(lock, null, 2));

    writeFile(dir, "README.md", "# fixture\n"); // in the default LOCAL_FILES allowlist
    writeFile(dir, "circuit/nested/selection.json", "{}\n"); // matches "circuit/**"
    writeFile(dir, "unexpected.bin", "nope\n"); // not in the allowlist

    const result = checkFixture({ fixtureDir: dir });
    assert.equal(result.ok, false);
    assert.ok(!result.problems.some((p) => p.includes("README.md")));
    assert.ok(!result.problems.some((p) => p.includes("circuit/nested/selection.json")));
    assert.ok(result.problems.some((p) => p.includes("unexpected.bin")));
  });

  test("isAllowedLocal matches '**' suffix patterns and exact names", () => {
    assert.equal(isAllowedLocal("circuit/nested/thing.json", ["circuit/**"]), true);
    assert.equal(isAllowedLocal("circuit", ["circuit/**"]), true);
    assert.equal(isAllowedLocal("expected/EXPECTED-CHANGES.md", ["expected/**"]), true);
    assert.equal(isAllowedLocal("README.md", ["README.md", "NOTICE.md"]), true);
    assert.equal(isAllowedLocal("random.txt", ["README.md", "circuit/**"]), false);
  });
});
