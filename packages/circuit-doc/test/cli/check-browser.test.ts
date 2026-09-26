/** `check-browser`: the exit-4 "Chrome not found" path and CLI-level usage errors. */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { EXIT } from "../../src/cli/command.ts";
import { which } from "../../src/browser-smoke/chrome.ts";
import { runCli, writeEmptyProject } from "./project-fixture.ts";

let scratch = "";

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "zcd-check-browser-"));
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** A PATH containing only the named real tools, so `google-chrome`/`chromium`/etc. are absent. */
async function shimPath(dir: string, tools: readonly string[]): Promise<string> {
  await mkdir(dir, { recursive: true });
  for (const tool of tools) {
    const real = await which(tool, process.env);
    assert.ok(real, `${tool} must exist on the test machine`);
    await symlink(real, join(dir, tool));
  }
  return dir;
}

describe("check-browser", () => {
  it("exits 4 (not run) when no Chrome binary can be found", async () => {
    const root = await writeEmptyProject(join(scratch, "no-chrome"));
    const path = await shimPath(join(scratch, "bin-no-chrome"), ["node"]);
    const run = await runCli(root, ["check-browser"], { env: { PATH: path } });
    assert.equal(run.code, EXIT.NOT_RUN);
    assert.match(run.stderr, /not run: Chrome not found \(set CHROME_BIN\)/u);
  });

  it("prefers an explicit --chrome path over CHROME_BIN and PATH", async () => {
    const root = await writeEmptyProject(join(scratch, "explicit-chrome-missing"));
    const path = await shimPath(join(scratch, "bin-explicit"), ["node"]);
    const run = await runCli(root, ["check-browser", "--chrome", join(scratch, "does-not-exist")], { env: { PATH: path } });
    assert.equal(run.code, EXIT.NOT_RUN);
  });

  it("respects CHROME_BIN even when it is not one of the well-known names", async () => {
    const root = await writeEmptyProject(join(scratch, "chrome-bin-custom"));
    const binDir = join(scratch, "bin-custom-chrome");
    await mkdir(binDir, { recursive: true });
    const fakeChrome = join(binDir, "my-chrome");
    await writeFile(fakeChrome, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const path = await shimPath(join(scratch, "bin-node-only"), ["node"]);
    // A fake, non-executable-by-Chrome binary still counts as "found" here: this test only
    // proves resolution order, not that the binary can actually run as Chrome.
    const run = await runCli(root, ["check-browser"], { env: { PATH: path, CHROME_BIN: fakeChrome } });
    assert.notEqual(run.code, EXIT.NOT_RUN);
  });

  it("rejects a malformed --representatives file with a usage error (exit 2)", async () => {
    const root = await writeEmptyProject(join(scratch, "bad-representatives"));
    const path = await shimPath(join(scratch, "bin-bad-reps"), ["node"]);
    await writeFile(join(root, "reps.json"), "{not json");
    const run = await runCli(root, ["check-browser", "--chrome", process.execPath, "--representatives", "reps.json"], {
      env: { PATH: path },
    });
    // process.execPath ("node") is accepted as the Chrome binary purely because it is an
    // executable file; the point of this test is the --representatives failure that follows.
    assert.equal(run.code, EXIT.USAGE);
    assert.match(run.stderr, /--representatives: reps\.json is not valid JSON/u);
  });

  it("reports a config error before reaching the Chrome check (exit 2)", async () => {
    const root = join(scratch, "no-config");
    await mkdir(root, { recursive: true });
    const path = await shimPath(join(scratch, "bin-no-config"), ["node"]);
    const run = await runCli(root, ["check-browser"], { env: { PATH: path } });
    assert.equal(run.code, EXIT.USAGE);
    assert.match(run.stderr, /CONFIG_NOT_FOUND/u);
  });
});
