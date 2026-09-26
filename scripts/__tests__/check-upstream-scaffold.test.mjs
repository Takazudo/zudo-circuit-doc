// Exercises check-upstream-scaffold.mjs. It needs the real pinned
// create-zudo-doc devDependency installed at the repo root (this is a dev-time
// parity check, not something a generated project ever runs), so these tests
// call the pinned package for real and diff against sandboxed COPIES of
// examples/empty/doc — never the committed fixture itself.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";

import {
  EXAMPLE_DOC_DIR,
  checkUpstreamScaffold,
  generateUpstreamScaffold,
} from "../check-upstream-scaffold.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(TEST_DIR, "../..");
const SCRIPT_PATH = join(PROJECT_ROOT, "scripts", "check-upstream-scaffold.mjs");

const temporaryDirectories = [];

function sandboxDir() {
  const dir = mkdtempSync(join(tmpdir(), "check-upstream-scaffold-test-"));
  temporaryDirectories.push(dir);
  return dir;
}

function copyExampleDoc() {
  const dir = sandboxDir();
  const target = join(dir, "doc");
  cpSync(EXAMPLE_DOC_DIR, target, { recursive: true });
  return target;
}

describe("check-upstream-scaffold.mjs", () => {
  let scratchRoot;
  let upstreamDir;

  before(async () => {
    scratchRoot = mkdtempSync(join(tmpdir(), "check-upstream-scaffold-upstream-"));
    upstreamDir = await generateUpstreamScaffold({ scratchRoot });
  });

  after(() => {
    rmSync(scratchRoot, { recursive: true, force: true });
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("reports no drift against the committed examples/empty/doc, with notes for the files it doesn't vendor", async () => {
    const { drift, notes } = await checkUpstreamScaffold({ upstreamDir });
    assert.deepEqual(drift, []);
    assert.equal(notes.some((n) => n.includes(".npmrc")), true);
    assert.equal(notes.some((n) => n.includes("pnpm-workspace.yaml")), true);
  });

  test("reports drift when the ADR-016 islands import is missing", async () => {
    const exampleDocDir = copyExampleDoc();
    const stubPath = join(exampleDocDir, "pages/docs/[[...slug]].tsx");
    writeFileSync(
      stubPath,
      readFileSync(stubPath, "utf8").replace('import "../lib/_circuit-doc-islands";\n', ""),
    );

    const { drift } = await checkUpstreamScaffold({ upstreamDir, exampleDocDir });
    assert.equal(
      drift.some((line) => line.includes("pages/docs/[[...slug]].tsx")),
      true,
      drift.join("\n"),
    );
  });

  test("reports drift when the ADR-015 package CSS import is missing", async () => {
    const exampleDocDir = copyExampleDoc();
    const cssPath = join(exampleDocDir, "src/styles/global.css");
    const withoutBlock = readFileSync(cssPath, "utf8").replace(
      '\n/* ADR-015: the package\'s unlayered styles, imported after the zudo-doc CSS. */\n' +
        '@import "@takazudo/zudo-circuit-doc/styles.css";\n',
      "",
    );
    writeFileSync(cssPath, withoutBlock);

    const { drift } = await checkUpstreamScaffold({ upstreamDir, exampleDocDir });
    assert.equal(
      drift.some((line) => line.includes("src/styles/global.css")),
      true,
      drift.join("\n"),
    );
  });

  test("reports drift for a non-exempt dependency but not for the ADR-003 zfb/zudo-doc family", async () => {
    const exampleDocDir = copyExampleDoc();
    const packageJsonPath = join(exampleDocDir, "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    packageJson.dependencies.zod = "^1.0.0";
    packageJson.dependencies["@takazudo/zfb"] = "9.9.9";
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

    const { drift } = await checkUpstreamScaffold({ upstreamDir, exampleDocDir });
    assert.equal(
      drift.some((line) => line.includes("dependencies.zod")),
      true,
      drift.join("\n"),
    );
    assert.equal(
      drift.some((line) => line.includes("@takazudo/zfb")),
      false,
      "the ADR-003-pinned zfb family must not be diffed by version",
    );
  });

  test("reports drift for an upstream-owned file that no longer matches byte-for-byte", async () => {
    const exampleDocDir = copyExampleDoc();
    const tsconfigPath = join(exampleDocDir, "tsconfig.json");
    writeFileSync(tsconfigPath, `${readFileSync(tsconfigPath, "utf8").trimEnd()}\n// drift\n`);

    const { drift } = await checkUpstreamScaffold({ upstreamDir, exampleDocDir });
    assert.equal(
      drift.some((line) => line.includes("tsconfig.json")),
      true,
      drift.join("\n"),
    );
  });

  test("the CLI reports OK against the real committed fixture", () => {
    const result = spawnSync(process.execPath, [SCRIPT_PATH], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /OK — examples\/empty\/doc matches/);
  });
});
