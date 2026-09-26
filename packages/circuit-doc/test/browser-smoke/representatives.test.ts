/** Representative parsing (`--representatives <json>`) and RECORD resolution against a synthetic dist tree. */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  hasPublishedReferences,
  parseRepresentatives,
  readRepresentativesFile,
  resolveRepresentatives,
} from "../../src/browser-smoke/representatives.ts";
import type { Representative } from "../../src/browser-smoke/types.ts";

describe("parseRepresentatives", () => {
  it("accepts the config-shaped {representatives: [...]}", () => {
    const parsed = parseRepresentatives({
      representatives: [{ kind: "passive", path: "/docs/components/records/c1/", slug: "c1", identity: "C1" }],
    });
    assert.deepEqual(parsed, [{ kind: "passive", path: "/docs/components/records/c1/", slug: "c1", identity: "C1" }]);
  });

  it("keeps an optional availability field", () => {
    const parsed = parseRepresentatives({
      representatives: [
        { kind: "IC", path: "/docs/components/records/x/", slug: "x", identity: "X", availability: "SOURCE UNAVAILABLE" },
      ],
    });
    assert.equal(parsed[0]?.availability, "SOURCE UNAVAILABLE");
  });

  it("rejects a value that is not {representatives: [...]}", () => {
    assert.throws(() => parseRepresentatives({ nope: [] }), /must be a JSON object/u);
    assert.throws(() => parseRepresentatives([]), /must be a JSON object/u);
  });

  it("rejects a representative missing a required field", () => {
    assert.throws(
      () => parseRepresentatives({ representatives: [{ kind: "passive", path: "/x/", slug: "x" }] }),
      /representatives\[0\]\.identity must be a non-empty string/u,
    );
  });

  it("rejects a non-string availability", () => {
    assert.throws(
      () =>
        parseRepresentatives({
          representatives: [{ kind: "passive", path: "/x/", slug: "x", identity: "X", availability: 1 }],
        }),
      /representatives\[0\]\.availability must be a string/u,
    );
  });
});

describe("readRepresentativesFile", () => {
  let scratch = "";

  before(async () => {
    scratch = await mkdtemp(join(tmpdir(), "zcd-representatives-"));
  });

  after(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it("reads and validates a JSON file, resolved against cwd", async () => {
    await writeFile(
      join(scratch, "reps.json"),
      JSON.stringify({ representatives: [{ kind: "passive", path: "/x/", slug: "x", identity: "X" }] }),
    );
    const representatives = await readRepresentativesFile("reps.json", scratch);
    assert.equal(representatives.length, 1);
    assert.equal(representatives[0]?.slug, "x");
  });

  it("reports a missing file", async () => {
    await assert.rejects(readRepresentativesFile("missing.json", scratch), /cannot read/u);
  });

  it("reports invalid JSON", async () => {
    await writeFile(join(scratch, "bad.json"), "{not json");
    await assert.rejects(readRepresentativesFile("bad.json", scratch), /not valid JSON/u);
  });
});

describe("resolveRepresentatives", () => {
  let scratch = "";

  before(async () => {
    scratch = await mkdtemp(join(tmpdir(), "zcd-resolve-representatives-"));
  });

  after(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  async function writePage(distRoot: string, route: string, html: string): Promise<void> {
    const relative = route.replace(/^\/+/u, "").replace(/\/+$/u, "");
    const dir = join(distRoot, relative);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.html"), html);
  }

  it("picks the first representative whose built page has a references section", async () => {
    const dist = join(scratch, "with-model");
    await writePage(dist, "/docs/components/records/no-model/", "<html><body>no references here</body></html>");
    await writePage(dist, "/docs/components/records/has-model/", '<html><body><section class="zcd-component-references"></section></body></html>');

    const representatives: readonly Representative[] = [
      { kind: "passive", path: "/docs/components/records/no-model/", slug: "no-model", identity: "NO" },
      { kind: "IC", path: "/docs/components/records/has-model/", slug: "has-model", identity: "HAS" },
    ];
    assert.equal(await hasPublishedReferences(dist, representatives[0] as Representative), false);
    assert.equal(await hasPublishedReferences(dist, representatives[1] as Representative), true);

    const resolved = await resolveRepresentatives(dist, representatives);
    assert.equal(resolved.record?.slug, "has-model");
  });

  it("returns record: undefined when no representative has a references section (declared-zero)", async () => {
    const dist = join(scratch, "zero");
    await writePage(dist, "/docs/components/records/x/", "<html><body>nothing published</body></html>");
    const representatives: readonly Representative[] = [{ kind: "passive", path: "/docs/components/records/x/", slug: "x", identity: "X" }];
    const resolved = await resolveRepresentatives(dist, representatives);
    assert.equal(resolved.record, undefined);
  });

  it("treats a missing built page as having no references, rather than throwing", async () => {
    const dist = join(scratch, "missing-page");
    const representatives: readonly Representative[] = [{ kind: "passive", path: "/docs/components/records/absent/", slug: "absent", identity: "X" }];
    assert.equal(await hasPublishedReferences(dist, representatives[0] as Representative), false);
  });
});
