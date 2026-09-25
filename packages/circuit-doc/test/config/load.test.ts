import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { ConfigError } from "../../src/config/errors.ts";
import { assertSupportedNodeVersion, loadCircuitConfig, mapLoadError, MIN_NODE_VERSION } from "../../src/config/load.ts";
import { DEFAULT_PROJECT_CONFIG, LED_STYLE_CONFIG } from "./fixtures.ts";

const IMPORT_TYPE_LINE = 'import type { CircuitConfig } from "@takazudo/zudo-circuit-doc/config";';
const tempDirs: string[] = [];

after(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A throwaway project dir with no node_modules: the package is NOT resolvable there. */
async function project(files: Record<string, string>, packageJson: object | null = { type: "module" }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "circuit-doc-config-"));
  tempDirs.push(dir);
  if (packageJson !== null) await writeFile(join(dir, "package.json"), JSON.stringify(packageJson));
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(join(dir, name, ".."), { recursive: true });
    await writeFile(join(dir, name), contents);
  }
  return dir;
}

function canonical(config: unknown): string {
  return `${IMPORT_TYPE_LINE}\nexport default ${JSON.stringify(config, null, 2)} satisfies CircuitConfig;\n`;
}

async function rejectsWith(
  promise: Promise<unknown>,
  check: (error: ConfigError) => void,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ConfigError, `expected ConfigError, got ${String(error)}`);
    check(error);
    return true;
  });
}

describe("loadCircuitConfig", () => {
  test("the canonical import-type form loads where the package is not installed", async () => {
    const cwd = await project({ "circuit.config.ts": canonical(DEFAULT_PROJECT_CONFIG) });
    assert.throws(() => createRequire(join(cwd, "probe.js")).resolve("@takazudo/zudo-circuit-doc/config"));
    const loaded = await loadCircuitConfig({ cwd });
    assert.deepEqual(loaded.config, DEFAULT_PROJECT_CONFIG);
    assert.equal(loaded.configPath, join(cwd, "circuit.config.ts"));
    assert.equal(loaded.configDir, cwd);
  });

  test("an LED-style config at a custom path loads, relative to cwd", async () => {
    const cwd = await project({ "fixtures/led/circuit.config.ts": canonical(LED_STYLE_CONFIG) });
    const loaded = await loadCircuitConfig({ cwd, configPath: "fixtures/led/circuit.config.ts" });
    assert.equal(loaded.configDir, join(cwd, "fixtures/led"));
    assert.equal(loaded.config.root, "upstream");
  });

  test("a fresh load picks up an edit; a cached load does not", async () => {
    const cwd = await project({ "circuit.config.ts": canonical(DEFAULT_PROJECT_CONFIG) });
    const first = await loadCircuitConfig({ cwd });
    assert.equal(first.config.project.title, "My Circuit");

    const edited = { ...DEFAULT_PROJECT_CONFIG, project: { name: "my-circuit", title: "Edited" } };
    await writeFile(join(cwd, "circuit.config.ts"), canonical(edited));

    const cached = await loadCircuitConfig({ cwd });
    assert.equal(cached.config.project.title, "My Circuit", "Node caches ESM by URL");
    const fresh = await loadCircuitConfig({ cwd, fresh: true });
    assert.equal(fresh.config.project.title, "Edited");

    const again = { ...DEFAULT_PROJECT_CONFIG, project: { name: "my-circuit", title: "Again" } };
    await writeFile(join(cwd, "circuit.config.ts"), canonical(again));
    const freshAgain = await loadCircuitConfig({ cwd, fresh: true });
    assert.equal(freshAgain.config.project.title, "Again");
  });

  test("a missing config file is CONFIG_NOT_FOUND", async () => {
    const cwd = await project({});
    await rejectsWith(loadCircuitConfig({ cwd }), (error) => {
      assert.equal(error.code, "CONFIG_NOT_FOUND");
      assert.equal(error.configPath, join(cwd, "circuit.config.ts"));
    });
  });

  test("a config without a default export is CONFIG_INVALID", async () => {
    const cwd = await project({ "circuit.config.ts": "export const config = {};\n" });
    await rejectsWith(loadCircuitConfig({ cwd }), (error) => {
      assert.equal(error.code, "CONFIG_INVALID");
      assert.match(error.errors[0]?.message ?? "", /no default export/u);
    });
  });

  test("a malformed config reports every error with its field path", async () => {
    const broken = { ...DEFAULT_PROJECT_CONFIG, configVersion: 2, root: "../up", bogus: true };
    const cwd = await project({ "circuit.config.ts": canonical(broken) });
    await rejectsWith(loadCircuitConfig({ cwd }), (error) => {
      assert.equal(error.code, "CONFIG_INVALID");
      assert.equal(error.configPath, join(cwd, "circuit.config.ts"));
      assert.deepEqual(
        error.errors.map((issue) => issue.path),
        ["configVersion", "root", "bogus"],
      );
    });
  });

  test("a value import from the package, not installed, hints at import type", async () => {
    const source =
      'import { defineCircuitConfig } from "@takazudo/zudo-circuit-doc/config";\n' +
      `export default defineCircuitConfig(${JSON.stringify(DEFAULT_PROJECT_CONFIG)});\n`;
    const cwd = await project({ "circuit.config.ts": source });
    await rejectsWith(loadCircuitConfig({ cwd }), (error) => {
      assert.equal(error.code, "CONFIG_LOAD_FAILED");
      assert.match(error.errors[0]?.message ?? "", /Cannot find package '@takazudo\/zudo-circuit-doc'/u);
      assert.match(error.hint ?? "", /import type \{ CircuitConfig \}/u);
    });
  });

  test("a type imported as a value from an installed package hints at import type", async () => {
    const source =
      'import { CircuitConfig } from "@takazudo/zudo-circuit-doc/config";\n' +
      `export default ${JSON.stringify(DEFAULT_PROJECT_CONFIG)} satisfies CircuitConfig;\n`;
    const cwd = await project({
      "circuit.config.ts": source,
      "node_modules/@takazudo/zudo-circuit-doc/package.json": JSON.stringify({
        name: "@takazudo/zudo-circuit-doc",
        type: "module",
        exports: { "./config": "./define.js" },
      }),
      "node_modules/@takazudo/zudo-circuit-doc/define.js": "export function defineCircuitConfig(c) { return c; }\n",
    });
    await rejectsWith(loadCircuitConfig({ cwd }), (error) => {
      assert.equal(error.code, "CONFIG_LOAD_FAILED");
      assert.match(error.errors[0]?.message ?? "", /does not provide an export named 'CircuitConfig'/u);
      assert.match(error.hint ?? "", /import type \{ CircuitConfig \}/u);
    });
  });

  test('a CommonJS project hints at "type": "module"', async () => {
    const cwd = await project({ "circuit.config.ts": canonical(DEFAULT_PROJECT_CONFIG) }, { type: "commonjs" });
    await rejectsWith(loadCircuitConfig({ cwd }), (error) => {
      assert.equal(error.code, "CONFIG_LOAD_FAILED");
      assert.match(error.hint ?? "", /"type": "module"/u);
    });
  });

  test("an unrelated missing module gets no misleading hint", async () => {
    const source = 'import "./missing.ts";\nexport default {};\n';
    const cwd = await project({ "circuit.config.ts": source });
    await rejectsWith(loadCircuitConfig({ cwd }), (error) => {
      assert.equal(error.code, "CONFIG_LOAD_FAILED");
      assert.equal(error.hint, undefined);
    });
  });
});

describe("error-hint mapping", () => {
  test("module-type syntax errors map to the type: module hint", () => {
    for (const message of ["Cannot use import statement outside a module", "Unexpected token 'export'"]) {
      const error = mapLoadError(new SyntaxError(message), "/p/circuit.config.ts");
      assert.match(error.hint ?? "", /"type": "module"/u);
      assert.equal(error.configPath, "/p/circuit.config.ts");
    }
  });

  test("ERR_MODULE_NOT_FOUND for another package keeps no hint", () => {
    const cause = Object.assign(new Error("Cannot find package 'left-pad' imported from /p/x.ts"), {
      code: "ERR_MODULE_NOT_FOUND",
    });
    assert.equal(mapLoadError(cause, "/p/circuit.config.ts").hint, undefined);
  });
});

describe("Node version gate", () => {
  test("Node older than 22.18 gets a targeted error naming the minimum", () => {
    assert.equal(MIN_NODE_VERSION, "22.18.0");
    for (const version of ["22.17.1", "20.19.0", "v18.0.0"]) {
      assert.throws(
        () => assertSupportedNodeVersion(version),
        (error: unknown) =>
          error instanceof ConfigError &&
          error.code === "NODE_VERSION_UNSUPPORTED" &&
          error.message.includes("22.18.0"),
      );
    }
  });

  test("Node 22.18+ passes", () => {
    for (const version of ["22.18.0", "22.20.1", "23.6.0", "24.13.1", "v25.0.0-pre"]) {
      assert.doesNotThrow(() => assertSupportedNodeVersion(version), version);
    }
    assert.doesNotThrow(() => assertSupportedNodeVersion());
  });
});
