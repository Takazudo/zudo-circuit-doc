/** `doctor`: capability table with optional tools hidden behind a PATH shim. */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { EXIT } from "../../src/cli/command.ts";
import { which } from "../../src/cli/commands/doctor.ts";
import { runCli, writeEmptyProject } from "./project-fixture.ts";

let scratch = "";

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "zcd-doctor-"));
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** A PATH containing only the named real tools, so Docker/Chrome/easyeda2kicad are absent. */
async function shimPath(dir: string, tools: readonly string[]): Promise<string> {
  await mkdir(dir, { recursive: true });
  for (const tool of tools) {
    const real = await which(tool, process.env);
    assert.ok(real, `${tool} must exist on the test machine`);
    await symlink(real, join(dir, tool));
  }
  return dir;
}

function row(stdout: string, name: string): string {
  const line = stdout.split("\n").find((entry) => entry.startsWith(`${name} `));
  assert.ok(line, `row ${name} in\n${stdout}`);
  return line;
}

describe("doctor", () => {
  it("renders the table with Docker and Chrome hidden and reports them as optional (exit 0)", async () => {
    const root = await writeEmptyProject(join(scratch, "optional"));
    const path = await shimPath(join(scratch, "bin-optional"), ["python3", "git"]);
    const run = await runCli(root, ["doctor"], { env: { PATH: path } });
    assert.equal(run.code, EXIT.PASS, run.stdout);
    assert.match(run.stdout, /^ITEM +LEVEL +STATUS +DETAIL$/mu);
    assert.match(row(run.stdout, "node"), /required +ok/u);
    assert.match(row(run.stdout, "python"), /required +ok +python3 \d+\.\d+/u);
    assert.match(row(run.stdout, "config"), /required +ok +circuit\.config\.ts/u);
    assert.match(row(run.stdout, "required files"), /required +ok/u);
    assert.match(row(run.stdout, "docker"), /optional +missing +install Docker/u);
    assert.match(row(run.stdout, "kicad image"), /optional +n\/a +cad disabled/u);
    assert.match(row(run.stdout, "chrome"), /optional +missing +.*CHROME_BIN/u);
    assert.match(row(run.stdout, "easyeda2kicad"), /optional +missing +`pipx install easyeda2kicad`/u);
    assert.match(row(run.stdout, "git"), /info +ok +git version .*; not a git repository/u);
    assert.match(run.stdout, /every required item is present/u);
  });

  it("a missing Python and a missing declared file are required failures (exit 1)", async () => {
    const root = await writeEmptyProject(join(scratch, "required"));
    await rm(join(root, "circuit/publication/assets.json"));
    const path = await shimPath(join(scratch, "bin-required"), ["git"]);
    const run = await runCli(root, ["doctor"], { env: { PATH: path } });
    assert.equal(run.code, EXIT.FAILED);
    assert.match(row(run.stdout, "python"), /required +FAIL +no usable `python3`/u);
    assert.match(row(run.stdout, "required files"), /required +FAIL +missing publication\.assets=circuit\/publication\/assets\.json/u);
    assert.match(run.stdout, /2 required item\(s\) failed: required files, python/u);
  });

  it("an invalid config is a required failure, and the table still renders", async () => {
    const root = join(scratch, "no-config");
    await mkdir(root, { recursive: true });
    const run = await runCli(root, ["doctor"], { env: { PATH: await shimPath(join(scratch, "bin-none"), ["python3"]) } });
    assert.equal(run.code, EXIT.FAILED);
    assert.match(row(run.stdout, "config"), /required +FAIL +CONFIG_NOT_FOUND/u);
    assert.match(row(run.stdout, "chrome"), /optional +missing/u);
  });
});
