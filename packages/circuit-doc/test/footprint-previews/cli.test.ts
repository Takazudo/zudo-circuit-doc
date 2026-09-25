/**
 * `zudo-circuit-doc footprints check|generate` end to end through `main()`
 * (issue #20): the CAD-disabled, zero-package project is the shape every
 * generated project starts from, and neither action may need Docker for it.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { EXIT } from "../../src/cli/command.ts";
import { runCli, writeEmptyProject } from "../cli/project-fixture.ts";

let scratch = "";

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "circuit-doc-footprints-cli-"));
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("footprints check|generate (CAD disabled, zero packages)", () => {
  it("`footprints check` passes without Docker", async () => {
    const root = await writeEmptyProject(join(scratch, "check"));
    const result = await runCli(root, ["footprints", "check"]);
    assert.equal(result.code, EXIT.PASS, result.stderr);
    assert.match(result.stdout, /0 selected footprints/u);
  });

  it("`footprints generate` passes without Docker and writes the empty manifest", async () => {
    const root = await writeEmptyProject(join(scratch, "generate"));
    const result = await runCli(root, ["footprints", "generate"]);
    assert.equal(result.code, EXIT.PASS, result.stderr);
    assert.match(result.stdout, /generated 0 footprint previews/u);

    // A second `check` sees exactly what `generate` just committed.
    const checked = await runCli(root, ["footprints", "check"]);
    assert.equal(checked.code, EXIT.PASS, checked.stderr);
  });

  it("rejects an unknown config path with a usage error, same as any other command", async () => {
    const root = await writeEmptyProject(join(scratch, "bad-config"));
    const result = await runCli(root, ["--config", "does-not-exist.ts", "footprints", "check"]);
    assert.equal(result.code, EXIT.USAGE, result.stdout);
  });
});
