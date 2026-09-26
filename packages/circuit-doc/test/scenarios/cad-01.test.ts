/**
 * CAD-01: a supplier model that is a family variant, not an exact-vendor
 * model — the family label, the dimension mismatch against the datasheet
 * land pattern, and the open physical-fit limit are all recorded. The
 * packed-consumer proof is `scripts/verify-pack.mjs --fixture minimal`
 * (scenario "CAD-01"); this is the unit-level static check.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../..");
const VENDOR_DIR = join(REPO_ROOT, "examples/minimal/footprints/vendor/kicad-soic8");
const RECEIPTS_DIR = join(REPO_ROOT, "examples/minimal/circuit/cad-receipts");

describe("CAD-01: a family footprint/model records its dimension mismatch and open limit", () => {
  const readme = readFileSync(join(VENDOR_DIR, "README.md"), "utf8");

  it("labels the package a family variant, not TI CAD", () => {
    assert.match(readme, /## Fidelity: family/);
    assert.match(readme, /not TI CAD/);
  });

  it("records the pad-size mismatch against the datasheet land pattern", () => {
    assert.match(readme, /1\.95.*0\.6 mm/);
    assert.match(readme, /1\.55.*0\.6 mm/);
  });

  it("keeps the physical fit an open, bench-dependent limit — never silently resolved", () => {
    assert.match(readme, /NEEDS BENCH/);
  });

  for (const asset of ["kicad-soic8-footprint", "kicad-soic8-model"]) {
    it(`${asset} receipt records fidelity class "family"`, () => {
      const receipt = JSON.parse(readFileSync(join(RECEIPTS_DIR, `${asset}.receipt.json`), "utf8"));
      assert.equal(receipt.fidelity.class, "family");
      assert.ok(receipt.fidelity.reason.length > 0, "fidelity reason is recorded");
    });
  }
});
