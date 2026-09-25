/** R21: `generate`, `check`, `models` and the check's footprints step never touch the network. */

import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { EXIT } from "../../src/cli/command.ts";
import { runCli, writeEmptyProject } from "./project-fixture.ts";

let scratch = "";
const calls: string[] = [];
const restore: (() => void)[] = [];

function trap<T extends object>(target: T, key: keyof T & string, label: string): void {
  const original = target[key];
  (target as Record<string, unknown>)[key] = (...args: unknown[]) => {
    calls.push(label);
    throw new Error(`network access attempted: ${label} ${String(args[0])}`);
  };
  restore.push(() => {
    (target as Record<string, unknown>)[key] = original;
  });
}

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "zcd-offline-"));
  trap(globalThis, "fetch", "fetch");
  trap(http, "request", "http.request");
  trap(http, "get", "http.get");
  trap(https, "request", "https.request");
  trap(https, "get", "https.get");
  trap(net, "connect", "net.connect");
  trap(net, "createConnection", "net.createConnection");
  syncBuiltinESMExports();
});

after(async () => {
  for (const undo of restore) undo();
  syncBuiltinESMExports();
  await rm(scratch, { recursive: true, force: true });
});

describe("offline commands", () => {
  it("the traps are live (self-check)", async () => {
    await assert.rejects(async () => fetch("https://example.invalid/"), /network access attempted: fetch/u);
    assert.throws(() => http.get("http://example.invalid/"), /network access attempted/u);
    assert.deepEqual(calls.splice(0), ["fetch", "http.get"]);
  });

  it("generate, check, models and models --check make no network call", async () => {
    const root = await writeEmptyProject(join(scratch, "project"));
    for (const argv of [["generate"], ["check"], ["models"], ["models", "--check"]]) {
      const run = await runCli(root, argv);
      assert.equal(run.code, EXIT.PASS, `${argv.join(" ")}: ${run.stderr}`);
    }
    assert.deepEqual(calls, []);
  });
});
