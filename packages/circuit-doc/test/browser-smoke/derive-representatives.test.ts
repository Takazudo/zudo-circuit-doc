/** Default representatives derived from the preflight report and generated record pages (#47). */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { deriveRepresentatives } from "../../src/browser-smoke/derive-representatives.ts";
import { writeBuiltRecord, writePreflight, writeRecordPage } from "./derived-fixture.ts";

let scratch = "";

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "zcd-derive-reps-"));
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function layout(name: string) {
  const root = join(scratch, name);
  return {
    preflightFile: join(root, "preflight.json"),
    generatedRoot: join(root, "generated"),
    distRoot: join(root, "dist"),
  };
}

describe("deriveRepresentatives", () => {
  it("returns declared-zero when the preflight publishes no records", async () => {
    const paths = layout("zero");
    await writePreflight(paths.preflightFile, []);
    assert.deepEqual(await deriveRepresentatives(paths), { outcome: "declared-zero" });
  });

  it("derives up to three qualifying records in sorted order, with the MPN as identity and unique kinds", async () => {
    const paths = layout("derived");
    await writePreflight(paths.preflightFile, ["d4", "a1", "no-refs", "c3", "b2"]);
    for (const [slug, identity] of [
      ["a1", "PART-A1"],
      ["b2", "PART-B2"],
      ["c3", "STM32G031F8P6"],
      ["d4", "PART-D4"],
    ] as const) {
      await writeRecordPage(paths.generatedRoot, slug, { identity });
    }
    await writeRecordPage(paths.generatedRoot, "no-refs", { identity: "NO-REFS", references: false });

    const result = await deriveRepresentatives(paths);
    assert.equal(result.outcome, "derived");
    if (result.outcome !== "derived") return;
    assert.equal(result.publishedRecords, 5);
    assert.deepEqual(result.representatives, [
      { kind: "derived a1", path: "/docs/components/records/a1/", slug: "a1", identity: "PART-A1" },
      { kind: "derived b2", path: "/docs/components/records/b2/", slug: "b2", identity: "PART-B2" },
      { kind: "derived c3", path: "/docs/components/records/c3/", slug: "c3", identity: "STM32G031F8P6" },
    ]);
    assert.equal(new Set(result.representatives.map((representative) => representative.kind)).size, 3);
  });

  it("skips records whose descriptor does not decode or whose page is missing", async () => {
    const paths = layout("bad-descriptor");
    await writePreflight(paths.preflightFile, ["bad", "missing", "good"]);
    await writeRecordPage(paths.generatedRoot, "bad", { identity: "BAD", descriptor: "7b7d" });
    await writeRecordPage(paths.generatedRoot, "good", { identity: "GOOD" });
    const result = await deriveRepresentatives(paths);
    assert.equal(result.outcome, "derived");
    if (result.outcome !== "derived") return;
    assert.deepEqual(
      result.representatives.map((representative) => representative.slug),
      ["good"],
    );
  });

  it("reports none-qualify when records are published but none carries references", async () => {
    const paths = layout("none");
    await writePreflight(paths.preflightFile, ["x1", "x2"]);
    await writeRecordPage(paths.generatedRoot, "x1", { identity: "X1", references: false });
    await writeRecordPage(paths.generatedRoot, "x2", { identity: "X2", references: false });
    assert.deepEqual(await deriveRepresentatives(paths), { outcome: "none-qualify", publishedRecords: 2 });
  });

  it("checks the built page and assets once the site is built", async () => {
    const paths = layout("built");
    await writePreflight(paths.preflightFile, ["built", "unbuilt"]);
    await writeRecordPage(paths.generatedRoot, "built", { identity: "BUILT" });
    await writeRecordPage(paths.generatedRoot, "unbuilt", { identity: "UNBUILT" });
    await writeBuiltRecord(paths.distRoot, "built");
    const result = await deriveRepresentatives(paths);
    assert.equal(result.outcome, "derived");
    if (result.outcome !== "derived") return;
    assert.deepEqual(
      result.representatives.map((representative) => representative.slug),
      ["built"],
    );
  });

  it("does not qualify a built record whose model asset is missing", async () => {
    const paths = layout("no-assets");
    await writePreflight(paths.preflightFile, ["only"]);
    await writeRecordPage(paths.generatedRoot, "only", { identity: "ONLY" });
    await writeBuiltRecord(paths.distRoot, "only", { assets: false });
    assert.deepEqual(await deriveRepresentatives(paths), { outcome: "none-qualify", publishedRecords: 1 });
  });

  it("throws when the preflight report is missing", async () => {
    const paths = layout("no-preflight");
    await assert.rejects(deriveRepresentatives(paths), /cannot read the preflight report/u);
  });
});
