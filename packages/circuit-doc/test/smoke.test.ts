// Smoke test proving the src -> dist round trip (see tsconfig.build.json).
// Node 22/24 native type stripping prints an ExperimentalWarning to stderr —
// do not assert stderr is empty when spawning a stripped process.
import assert from "node:assert/strict";
import test from "node:test";
import { CIRCUIT_DOC_PACKAGE_NAME } from "../src/index.ts";

test("package bootstrap barrel loads", () => {
  assert.equal(CIRCUIT_DOC_PACKAGE_NAME, "@takazudo/zudo-circuit-doc");
});
