import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkSearchAndLlmExport } from "../../src/browser-smoke/checks/search.ts";

test("search accepts the released 3000-character match depth and rejects empty or oversized bodies", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zcd-search-body-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const generated = join(root, "generated");
  await mkdir(join(generated, "records", "part"), { recursive: true });
  const markdown = '## Documents and package\n<EvidenceAnchor id="rec-part" />\n';
  await writeFile(join(generated, "records", "part", "index.mdx"), markdown);
  await writeFile(join(root, "llms-full.txt"), markdown);
  const representative = { kind: "part", path: "/docs/components/records/part/", slug: "part", identity: "PART" };
  async function checkBody(body: string): Promise<void> {
    await writeFile(join(root, "search-index.json"), JSON.stringify([{ url: representative.path.slice(0, -1), title: "PART", description: "Component PART", body }]));
    await checkSearchAndLlmExport(root, generated, [representative]);
  }
  await checkBody("x".repeat(3000));
  await assert.rejects(checkBody("x".repeat(3001)), /3000-character indexed match depth/u);
  await assert.rejects(checkBody(" "), /search body has indexed content/u);
});
