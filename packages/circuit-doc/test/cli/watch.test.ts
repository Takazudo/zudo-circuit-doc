/** `generate --watch`: config reload, watch set, self-output exclusion. */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { EXIT } from "../../src/cli/command.ts";
import { loadProject } from "../../src/cli/project.ts";
import { watchTargets } from "../../src/cli/watch.ts";
import { EMPTY_SELECTION, GENERATED, SELECTION, configSource, runCli, writeEmptyProject, writeJson } from "./project-fixture.ts";

let scratch = "";

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "zcd-watch-"));
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function waitFor(check: () => Promise<boolean>, what: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  assert.fail(`timed out waiting for ${what}`);
}

describe("generate --watch", () => {
  it("an edit to circuit.config.ts takes effect without a restart", async () => {
    const root = await writeEmptyProject(join(scratch, "config-edit"));
    const controller = new AbortController();
    let out = "";
    let err = "";
    const running = runCli(root, ["generate", "--watch"], {
      signal: controller.signal,
      onStdout: (chunk) => {
        out += chunk;
      },
      onStderr: (chunk) => {
        err += chunk;
      },
    });
    try {
      await waitFor(async () => out.includes("[circuit-doc] watching"), "the initial generation");
      const landing = join(root, GENERATED, "index.mdx");
      assert.match(await readFile(landing, "utf8"), /\/docs\/claude\//u);

      await writeFile(join(root, "circuit.config.ts"), configSource({ docs: { agentResources: false } }));
      await waitFor(async () => !(await readFile(landing, "utf8")).includes("/docs/claude/"), "the config edit to apply");

      // A selection edit is picked up too (here: a stale one, reported without killing the watcher).
      await writeJson(join(root, SELECTION), { ...EMPTY_SELECTION, expect: { ...EMPTY_SELECTION.expect, records: 3 } });
      await waitFor(async () => err.includes("STALE_SELECTION"), "the selection edit to be picked up");
    } finally {
      controller.abort();
    }
    const run = await running;
    assert.equal(run.code, EXIT.PASS);
    assert.match(run.stderr, /STALE_SELECTION/u);
  });

  it("the watch set covers the declared inputs and never the generated tree", async () => {
    const root = await writeEmptyProject(join(scratch, "targets"));
    const project = await loadProject({ cwd: root });
    const targets = watchTargets(project).map((target) => ({
      dir: relative(root, target.dir) || ".",
      recursive: target.recursive,
      names: target.names === null ? null : [...target.names].sort(),
    }));
    assert.deepEqual(targets, [
      { dir: ".claude/skills", recursive: true, names: null },
      { dir: ".", recursive: false, names: ["circuit.config.ts"] },
      { dir: ".claude/skills/circuit-spec-integration/references", recursive: false, names: ["rules.json"] },
      { dir: ".claude/skills/component-spec-audit/references", recursive: false, names: ["inventory.json"] },
      { dir: "circuit/publication", recursive: false, names: ["assets.json", "selection.json"] },
    ]);
  });

  it("a bundles root inside the generated tree is never watched", async () => {
    const root = await writeEmptyProject(join(scratch, "nested"));
    const project = await loadProject({ cwd: root });
    const nested = { ...project, paths: { ...project.paths, generatedRoot: project.paths.bundlesRoot } };
    assert.ok(watchTargets(nested).every((target) => !target.dir.startsWith(project.paths.bundlesRoot)));
  });
});
