/**
 * CAD-02: a corrected model derived from family CAD keeps the original hash,
 * the derivation script and parameters, and the output hashes — and the
 * derived asset is never claimed exact-vendor. Two parts, per the epic:
 * source inspection of the derivation record, and an automated receipt check
 * that the derivation script is still current.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../..");
const VENDOR_DIR = join(REPO_ROOT, "examples/minimal/footprints/vendor/kicad-soic8");
const RECEIPTS_DIR = join(REPO_ROOT, "examples/minimal/circuit/cad-receipts");

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("CAD-02: source inspection of the derivation record", () => {
  const readme = readFileSync(join(VENDOR_DIR, "README.md"), "utf8");

  it("documents the derivation script and before/after hashes for each derived output", () => {
    assert.match(readme, /## Derivations/);
    assert.match(readme, /derive\.mjs/);
    assert.match(readme, /SHA-256 before/);
    assert.match(readme, /SHA-256 after/);
  });

  it("never claims exact-vendor fidelity", () => {
    assert.doesNotMatch(readme, /exact-vendor/);
    assert.match(readme, /## Fidelity: family/);
  });

  for (const asset of ["kicad-soic8-footprint", "kicad-soic8-model"]) {
    it(`${asset} receipt retains the original hash, the derivation tool and the output hashes, and is not exact-vendor`, () => {
      const receipt = readJson(join(RECEIPTS_DIR, `${asset}.receipt.json`));
      assert.equal(receipt.derivation.derived, true);
      assert.ok(Object.keys(receipt.derivation.input_sha256).length > 0, "retains the original (input) hash");
      assert.equal(receipt.derivation.tool, "footprints/vendor/kicad-soic8/derive.mjs");
      assert.ok(Object.keys(receipt.derivation.output_sha256).length > 0, "retains the output hash");
      assert.notEqual(receipt.fidelity.class, "exact-vendor");
    });
  }
});

describe("CAD-02: automated receipt check — the derivation script is still current", () => {
  it("`derive.mjs --check` passes: the committed outputs match a fresh derivation of the committed inputs", () => {
    const result = spawnSync(process.execPath, [join(VENDOR_DIR, "derive.mjs"), "--check"], { encoding: "utf8" });
    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  });
});
