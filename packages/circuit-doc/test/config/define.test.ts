/**
 * `DEFAULT_PREVIEW_RENDERER` (#48): a ready-to-use `cad.previewRenderer`
 * value, kept in lockstep with `examples/minimal/circuit.config.ts` so the
 * shipped default never silently drifts from the example it was copied from.
 */
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { loadCircuitConfig } from "../../src/config/load.ts";
import { DEFAULT_PREVIEW_RENDERER } from "../../src/config/define.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../..");

describe("DEFAULT_PREVIEW_RENDERER", () => {
  it("matches examples/minimal's cad.previewRenderer", async () => {
    const loaded = await loadCircuitConfig({ cwd: join(REPO_ROOT, "examples/minimal") });
    assert.equal(loaded.config.cad.enabled, true);
    if (!loaded.config.cad.enabled) return;
    assert.deepEqual(loaded.config.cad.previewRenderer, DEFAULT_PREVIEW_RENDERER);
  });
});
