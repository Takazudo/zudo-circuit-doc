// Fast, STEP-free unit coverage for the two provenance checks
// check-led-fixture.mjs also runs as part of the full regression harness:
// the committed selection/document-verification ports against the pinned
// upstream .ts literal, and the expected-preflight single-field diff.
//
// Runs as part of `pnpm test:scripts` (and the root `pnpm test`); run just
// this file directly with
// `node --test scripts/__tests__/check-led-fixture.test.mjs`.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertExpectedPreflightDiffIsOnlyViewModelVersion,
  assertSelectionPortsAreFaithful,
} from "../check-led-fixture.mjs";

test("fixtures/led/circuit/{selection,document-verification}.json are faithful ports of the pinned upstream selection.ts literal", async () => {
  await assert.doesNotReject(() => assertSelectionPortsAreFaithful());
});

test("fixtures/led/expected/doc/component-docs/preflight.json differs from upstream only in viewModelVersion", () => {
  assert.doesNotThrow(() => assertExpectedPreflightDiffIsOnlyViewModelVersion());
});
