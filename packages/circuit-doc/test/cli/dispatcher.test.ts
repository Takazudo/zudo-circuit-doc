/** The dispatcher: metadata-driven help, --version, usage errors, stub commands. */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { parseCommandArgs, parseGlobalArgs, UsageError } from "../../src/cli/args.ts";
import { EXIT, type CommandModule } from "../../src/cli/command.ts";
import { COMMANDS } from "../../src/cli/commands/index.ts";
import { main } from "../../src/cli/main.ts";
import { runCli } from "./project-fixture.ts";

const PACKAGE_JSON = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as {
  version: string;
};
const NOWHERE = "/nonexistent-zcd-cwd";

describe("zudo-circuit-doc dispatcher", () => {
  it("--version prints package.json's version", async () => {
    const run = await runCli(NOWHERE, ["--version"]);
    assert.equal(run.code, EXIT.PASS);
    assert.equal(run.stdout, `${PACKAGE_JSON.version}\n`);
  });

  it("--help lists every registered command from its own metadata", async () => {
    const run = await runCli(NOWHERE, ["--help"]);
    assert.equal(run.code, EXIT.PASS);
    for (const entry of COMMANDS) assert.match(run.stdout, new RegExp(`^  ${entry.meta.name} .*${escape(entry.meta.summary)}`, "mu"));
    for (const name of ["generate", "check", "validate", "models", "doctor", "new-component", "scan", "check-built", "footprints", "check-browser"]) {
      assert.ok(COMMANDS.some((entry) => entry.meta.name === name), `${name} is registered`);
    }
  });

  it("<command> --help renders that module's flags and exit codes", async () => {
    const run = await runCli(NOWHERE, ["validate", "--help"]);
    assert.equal(run.code, EXIT.PASS);
    assert.match(run.stdout, /--refresh-source <id>…/u);
    assert.match(run.stdout, /Exit codes:\n  0 {2}the evidence satisfies the contract/u);
  });

  it("help is built from whatever module is registered, so replacing a module replaces its help", async () => {
    const replacement: CommandModule = {
      meta: {
        name: "footprints",
        summary: "the real thing",
        flags: [{ name: "--pull", description: "pull it" }],
        exitCodes: [{ code: 4, meaning: "docker missing" }],
      },
      run: async () => 0,
    };
    const commands = COMMANDS.map((entry) => (entry.meta.name === "footprints" ? replacement : entry));
    let out = "";
    const io = { cwd: NOWHERE, env: {}, stdout: { write: (c: string) => (out += c) }, stderr: { write: () => true } };
    assert.equal(await main(["footprints", "--help"], io, commands), 0);
    assert.match(out, /the real thing/u);
    assert.match(out, /4 {2}docker missing/u);
    assert.doesNotMatch(out, /not implemented/u);
  });

  it("no command / unknown command / unknown flag / missing positional are usage errors (exit 2)", async () => {
    assert.equal((await runCli(NOWHERE, [])).code, EXIT.USAGE);
    const unknown = await runCli(NOWHERE, ["frobnicate"]);
    assert.equal(unknown.code, EXIT.USAGE);
    assert.match(unknown.stderr, /unknown command "frobnicate"/u);
    const badFlag = await runCli(NOWHERE, ["generate", "--wtach"]);
    assert.equal(badFlag.code, EXIT.USAGE);
    assert.match(badFlag.stderr, /unknown option --wtach/u);
    const missing = await runCli(NOWHERE, ["new-component"]);
    assert.equal(missing.code, EXIT.USAGE);
    assert.match(missing.stderr, /requires <suffix>/u);
    const badChoice = await runCli(NOWHERE, ["footprints", "render"]);
    assert.equal(badChoice.code, EXIT.USAGE);
  });

  it("a missing config is a config error (exit 2)", async () => {
    const run = await runCli(NOWHERE, ["generate"]);
    assert.equal(run.code, EXIT.USAGE);
    assert.match(run.stderr, /CONFIG_NOT_FOUND/u);
  });

  for (const [argv, issue] of [
    [["scan"], 19],
    [["check-built"], 19],
    [["check-browser"], 27],
  ] as const) {
    it(`stub \`${argv.join(" ")}\` prints its tracking issue and exits 2`, async () => {
      const run = await runCli(NOWHERE, [...argv]);
      assert.equal(run.code, EXIT.USAGE);
      assert.equal(run.stderr, `${argv[0]}: not implemented yet (tracked in #${issue})\n`);
    });
  }
});

describe("argument parsing", () => {
  it("pulls --config out of any position", () => {
    const parsed = parseGlobalArgs(["generate", "--config", "sub/circuit.config.ts", "--watch"]);
    assert.equal(parsed.configPath, "sub/circuit.config.ts");
    assert.deepEqual(parsed.rest, ["generate", "--watch"]);
    assert.equal(parseGlobalArgs(["--config=a.ts", "check"]).configPath, "a.ts");
    assert.throws(() => parseGlobalArgs(["check", "--config"]), UsageError);
  });

  it("variadic value flags consume following IDs and repeat", () => {
    const meta = COMMANDS.find((entry) => entry.meta.name === "validate")?.meta;
    assert.ok(meta);
    const args = parseCommandArgs(meta, ["--refresh-source", "src-a", "src-b", "--json", "--refresh-source=src-c"]);
    assert.deepEqual(args.flags.get("--refresh-source"), ["src-a", "src-b", "src-c"]);
    assert.equal(args.flags.get("--json"), true);
    assert.throws(() => parseCommandArgs(meta, ["--refresh-source"]), /requires <id>/u);
  });

  it("--online and --refresh-source together are a usage error", async () => {
    const run = await runCli(NOWHERE, ["validate", "--online", "--refresh-source", "src-a"]);
    assert.equal(run.code, EXIT.USAGE);
    assert.match(run.stderr, /mutually exclusive/u);
  });
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
