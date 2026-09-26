// Exercises sync-create-template.mjs against a sandboxed copy of the real
// examples/empty fixture (not the live packages/create-zudo-circuit-doc/
// templates/default) so these tests never write to the committed tree.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, test } from "node:test";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(TEST_DIR, "../..");
const SCRIPT_PATH = join(PROJECT_ROOT, "scripts", "sync-create-template.mjs");
const FIXTURE_PATH = join(PROJECT_ROOT, "examples", "empty");
const RUNTIME_PACKAGE_PATH = join(PROJECT_ROOT, "packages", "circuit-doc", "package.json");
const RUNTIME_VERSION = JSON.parse(readFileSync(RUNTIME_PACKAGE_PATH, "utf8")).version;

const EXCLUDED_NAME_PATTERN =
  /(?:^|[/\\])(?:node_modules|dist|\.zfb-build|\.zfb|\.zudo-doc|\.circuit-cache|\.git)(?:[/\\]|$)/;
const EXCLUDED_FILE_PATTERN = /(?:^|[/\\])pnpm-lock\.yaml$/;

const temporaryDirectories = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeSandbox() {
  const sandbox = mkdtempSync(join(tmpdir(), "sync-create-template-"));
  temporaryDirectories.push(sandbox);
  mkdirSync(join(sandbox, "scripts"), { recursive: true });
  mkdirSync(join(sandbox, "examples"), { recursive: true });
  mkdirSync(join(sandbox, "packages", "circuit-doc"), { recursive: true });
  mkdirSync(join(sandbox, "packages", "create-zudo-circuit-doc", "templates"), {
    recursive: true,
  });
  cpSync(SCRIPT_PATH, join(sandbox, "scripts", "sync-create-template.mjs"));
  cpSync(FIXTURE_PATH, join(sandbox, "examples", "empty"), {
    recursive: true,
    filter: (source) => !EXCLUDED_NAME_PATTERN.test(source) && !EXCLUDED_FILE_PATTERN.test(source),
  });
  cpSync(RUNTIME_PACKAGE_PATH, join(sandbox, "packages", "circuit-doc", "package.json"));
  return sandbox;
}

function run(sandbox, ...args) {
  return spawnSync(process.execPath, [join(sandbox, "scripts", "sync-create-template.mjs"), ...args], {
    cwd: sandbox,
    encoding: "utf8",
  });
}

function outputDir(sandbox) {
  return join(sandbox, "packages", "create-zudo-circuit-doc", "templates", "default");
}

function readOutputFiles(directory) {
  const files = [];
  const visit = (current, prefix = "") => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path, relative);
      else files.push(relative);
    }
  };
  visit(directory);
  return files.sort();
}

function readOutputText(directory) {
  return readOutputFiles(directory)
    .map((relativePath) => readFileSync(join(directory, relativePath), "utf8"))
    .join("\n");
}

describe("sync-create-template.mjs", () => {
  test("generates a clean starter tree and is idempotent", () => {
    const sandbox = makeSandbox();

    const first = run(sandbox);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Wrote create-zudo-circuit-doc template/);

    const target = outputDir(sandbox);
    assert.equal(existsSync(target), true);

    const rootPackage = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
    assert.equal(rootPackage.name, "__PROJECT_NAME__");
    assert.equal(rootPackage.version, "0.1.0");
    assert.equal(
      rootPackage.devDependencies["@takazudo/zudo-circuit-doc"],
      `^${RUNTIME_VERSION}`,
    );

    const docPackage = JSON.parse(readFileSync(join(target, "doc/package.json"), "utf8"));
    assert.equal(docPackage.name, "__PROJECT_NAME__-doc");
    assert.equal(docPackage.dependencies["@takazudo/zudo-circuit-doc"], `^${RUNTIME_VERSION}`);

    const config = readFileSync(join(target, "circuit.config.ts"), "utf8");
    assert.match(config, /name: "__PROJECT_NAME__"/);
    assert.match(config, /title: "__SITE_TITLE__"/);
    assert.match(config, /libraryName: "__LIBRARY_NAME__"/);

    assert.equal(existsSync(join(target, "_gitignore")), true);
    assert.equal(existsSync(join(target, ".gitignore")), false);

    const workspaceYaml = readFileSync(join(target, "pnpm-workspace.yaml"), "utf8");
    assert.match(workspaceYaml, /packages: \["doc"\]/);
    assert.match(workspaceYaml, /minimumReleaseAge: 0/);
    assert.match(workspaceYaml, /allowBuilds:\s*\n\s*esbuild: true/);
    assert.equal(existsSync(join(target, ".npmrc")), false);

    // The whole tree must never leak a sentinel or the fixture-only .tarball
    // pattern. "workspace:"/"file:" are checked against the two package.json
    // files specifically (not the whole tree): check-links.js and prose docs
    // legitimately contain the substring "file:" (an object-literal key, "one
    // file: ...") that has nothing to do with an npm dependency spec.
    const generatedText = readOutputText(target);
    for (const forbidden of ["example-empty-circuit", ".tarball"]) {
      assert.equal(generatedText.includes(forbidden), false, `did not expect "${forbidden}"`);
    }
    for (const packageJsonPath of ["package.json", "doc/package.json"]) {
      const text = readFileSync(join(target, packageJsonPath), "utf8");
      assert.equal(text.includes("workspace:"), false, `${packageJsonPath} should not contain "workspace:"`);
      assert.equal(text.includes("file:"), false, `${packageJsonPath} should not contain "file:"`);
    }

    const second = run(sandbox);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /already up to date/);

    const check = run(sandbox, "--check");
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /up to date/);
  });

  test("--check reports drift without writing, and a re-sync fixes it", () => {
    const sandbox = makeSandbox();
    assert.equal(run(sandbox).status, 0);

    const target = outputDir(sandbox);
    const page = join(target, "doc/pages/index.tsx");
    const before = readFileSync(page, "utf8");
    writeFileSync(page, `${before}\n// accidental edit\n`);

    const check = run(sandbox, "--check");
    assert.equal(check.status, 1);
    assert.match(check.stderr, /doc\/pages\/index\.tsx/);
    assert.match(readFileSync(page, "utf8"), /accidental edit/);

    assert.equal(run(sandbox).status, 0);
    assert.equal(readFileSync(page, "utf8"), before);
  });

  test("excluded artifacts and the fixture lockfile are skipped", () => {
    const sandbox = makeSandbox();
    const fixtureDir = join(sandbox, "examples", "empty");
    mkdirSync(join(fixtureDir, "dist"), { recursive: true });
    writeFileSync(join(fixtureDir, "dist", "stale.js"), "stale\n");
    mkdirSync(join(fixtureDir, ".zfb"), { recursive: true });
    writeFileSync(join(fixtureDir, ".zfb", "graph.bin"), "stale\n");
    mkdirSync(join(fixtureDir, ".circuit-cache", "sources"), { recursive: true });
    writeFileSync(join(fixtureDir, ".circuit-cache", "sources", "cached.json"), "{}\n");
    for (const file of [
      ".zfb-esbuild-entry-x.tsx",
      ".zfb-islands-tsconfig-x.json",
      ".zfb-virtual-x.mjs",
    ]) {
      writeFileSync(join(fixtureDir, file), "stale\n");
    }
    writeFileSync(join(fixtureDir, "pnpm-lock.yaml"), "lockfile\n");

    assert.equal(run(sandbox).status, 0);
    const files = readOutputFiles(outputDir(sandbox));
    assert.equal(files.includes("dist/stale.js"), false);
    assert.equal(files.includes(".zfb/graph.bin"), false);
    assert.equal(files.includes(".circuit-cache/sources/cached.json"), false);
    assert.equal(files.includes(".zfb-esbuild-entry-x.tsx"), false);
    assert.equal(files.includes(".zfb-islands-tsconfig-x.json"), false);
    assert.equal(files.includes(".zfb-virtual-x.mjs"), false);
    assert.equal(files.includes("pnpm-lock.yaml"), false);
  });

  test("throws when the source tree contains a symlink", () => {
    const sandbox = makeSandbox();
    const fixtureDir = join(sandbox, "examples", "empty");
    symlinkSync(join(fixtureDir, "package.json"), join(fixtureDir, "package-link.json"));

    const result = run(sandbox);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /[Ss]ymlink/);
  });

  test("fails when a sentinel appears in an unexpected file", () => {
    const sandbox = makeSandbox();
    const agentsPath = join(sandbox, "examples", "empty", "AGENTS.md");
    writeFileSync(agentsPath, `${readFileSync(agentsPath, "utf8")}\nExample Empty Circuit\n`);

    const result = run(sandbox);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Example Empty Circuit/);
    assert.match(result.stderr, /AGENTS\.md/);
  });

  test("fails when a sentinel is missing from its expected file", () => {
    const sandbox = makeSandbox();
    const configPath = join(sandbox, "examples", "empty", "circuit.config.ts");
    writeFileSync(
      configPath,
      readFileSync(configPath, "utf8").replace("example-empty-circuit-lib", "renamed-library"),
    );

    const result = run(sandbox);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /example-empty-circuit-lib/);
  });

  test("fails on a workspace: protocol other than the runtime dependency", () => {
    const sandbox = makeSandbox();
    const docPackagePath = join(sandbox, "examples", "empty", "doc", "package.json");
    const docPackage = JSON.parse(readFileSync(docPackagePath, "utf8"));
    docPackage.dependencies["@takazudo/some-other-pkg"] = "workspace:^1.0.0";
    writeFileSync(docPackagePath, `${JSON.stringify(docPackage, null, 2)}\n`);

    const result = run(sandbox);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /workspace:/);
    assert.match(result.stderr, /@takazudo\/some-other-pkg/);
  });

  test("fails on a file: dependency spec", () => {
    const sandbox = makeSandbox();
    const rootPackagePath = join(sandbox, "examples", "empty", "package.json");
    const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
    rootPackage.devDependencies["@takazudo/some-local-pkg"] = "file:../some-local-pkg";
    writeFileSync(rootPackagePath, `${JSON.stringify(rootPackage, null, 2)}\n`);

    const result = run(sandbox);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /file:/);
  });
});
