// Smoke test proving the src -> dist round trip (see tsconfig.build.json).
// Node 22/24 native type stripping prints an ExperimentalWarning to stderr —
// do not assert stderr is empty when spawning a stripped process.
import assert from "node:assert/strict";
import test from "node:test";
import { main } from "../src/cli.ts";

test("placeholder CLI exits 0", async () => {
  assert.equal(await main(), 0);
});
