import assert from "node:assert/strict";
import test from "node:test";
import { parseCliArgs } from "../src/args.ts";
import { CliUsageError } from "../src/errors.ts";

test("parses a destination positional and defaults", () => {
  const parsed = parseCliArgs(["my-project"]);
  assert.equal(parsed.destination, "my-project");
  assert.equal(parsed.agent, "both");
  assert.equal(parsed.install, true);
  assert.equal(parsed.git, true);
  assert.equal(parsed.yes, false);
});

test("parses all named flags", () => {
  const parsed = parseCliArgs([
    "dest",
    "--name",
    "@scope/pkg",
    "--title",
    "My Site",
    "--library",
    "my_lib",
    "--agent",
    "codex",
  ]);
  assert.equal(parsed.name, "@scope/pkg");
  assert.equal(parsed.title, "My Site");
  assert.equal(parsed.library, "my_lib");
  assert.equal(parsed.agent, "codex");
});

test("short aliases -y -h -v", () => {
  assert.equal(parseCliArgs(["-y", "dest"]).yes, true);
  assert.equal(parseCliArgs(["-h"]).help, true);
  assert.equal(parseCliArgs(["-v"]).version, true);
});

test("--no-install and --no-git negate the defaults", () => {
  const parsed = parseCliArgs(["dest", "--no-install", "--no-git"]);
  assert.equal(parsed.install, false);
  assert.equal(parsed.git, false);
});

test("the last of --install/--no-install wins", () => {
  assert.equal(parseCliArgs(["dest", "--no-install", "--install"]).install, true);
  assert.equal(parseCliArgs(["dest", "--install", "--no-install"]).install, false);
  assert.equal(parseCliArgs(["dest", "--no-git", "--git"]).git, true);
  assert.equal(parseCliArgs(["dest", "--git", "--no-git"]).git, false);
});

test("more than one positional argument is a usage error", () => {
  assert.throws(() => parseCliArgs(["a", "b"]), CliUsageError);
});

test("an unknown option is a usage error", () => {
  assert.throws(() => parseCliArgs(["--nope"]), CliUsageError);
});

test("an invalid --agent value is a usage error", () => {
  assert.throws(() => parseCliArgs(["dest", "--agent", "bogus"]), CliUsageError);
});

test("no destination leaves it undefined", () => {
  assert.equal(parseCliArgs([]).destination, undefined);
});

test("--runtime-spec is parsed; omitted leaves it undefined", () => {
  assert.equal(parseCliArgs(["dest", "--runtime-spec", "^0.2.0"]).runtimeSpec, "^0.2.0");
  assert.equal(parseCliArgs(["dest"]).runtimeSpec, undefined);
});
