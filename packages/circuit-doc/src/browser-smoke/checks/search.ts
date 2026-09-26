/**
 * Search and `llms-full.txt` assertions (spec item 3: kept behind
 * `--search-assertions`, which needs the host's `llmsTxt: true`). Ported from
 * the pinned LED script's `inspectPublishedSearchAndLlm`, generalized: rather
 * than a literal `**Fact:**`/`**Source ID:**` bold-label regex (an LED
 * authoring convention this package does not use), it reads the record's own
 * generated MDX for its `EvidenceAnchor` ids and checks each one — whatever
 * they are — survived into the LLM export, alongside the native
 * "Documents and package" heading.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { assertEqual } from "../assertions.ts";
import type { Representative } from "../types.ts";

const REFERENCE_HEADING = "## Documents and package";

/**
 * Provider evidence-id prefixes (`core/ids.ts`): the identifiers a reader
 * could look up and expect to find again. `component-references-heading` and
 * `component-references` are purely structural anchors (heading/scroll
 * targets), not evidence claims, so they are not expected to survive into a
 * plain-text export.
 */
const EVIDENCE_ANCHOR_PATTERN = /^(?:rec|fact|src|cov|int|pinmap)-/u;

type SearchIndexEntry = { readonly url: string; readonly title: string; readonly description: string; readonly body: string };

export async function checkSearchAndLlmExport(
  distRoot: string,
  generatedRoot: string,
  representatives: readonly Representative[],
): Promise<void> {
  const raw = await readFile(join(distRoot, "search-index.json"), "utf8");
  const entries = JSON.parse(raw) as unknown;
  if (!Array.isArray(entries)) throw new Error("built search index is not an array");
  const llmsFull = await readFile(join(distRoot, "llms-full.txt"), "utf8");

  for (const representative of representatives) {
    const searchPath = representative.path.replace(/\/$/u, "");
    const searchEntry = (entries as SearchIndexEntry[]).find((entry) => entry.url === searchPath);
    assertEqual(searchEntry !== undefined, true, `${representative.kind} route is in the built search index`);
    if (searchEntry === undefined) continue;
    assertEqual(
      `${searchEntry.title} ${searchEntry.description}`.toLowerCase().includes(representative.identity.toLowerCase()),
      true,
      `${representative.kind} identity is searchable through title or description`,
    );
    assertEqual(searchEntry.body.length <= 300, true, `${representative.kind} search body respects the 300-character excerpt`);

    const markdown = await readFile(join(generatedRoot, "records", representative.slug, "index.mdx"), "utf8");
    assertEqual(markdown.includes(REFERENCE_HEADING), true, `${representative.kind} generated Markdown has the native "Documents and package" heading`);
    assertEqual(llmsFull.includes(REFERENCE_HEADING), true, `${representative.kind} LLM export retains the "Documents and package" heading`);

    const anchorIds = [...markdown.matchAll(/<EvidenceAnchor id="([a-z][a-z0-9-]*)"\s*\/>/gu)]
      .map((match) => match[1] as string)
      .filter((id) => EVIDENCE_ANCHOR_PATTERN.test(id));
    assertEqual(anchorIds.length > 0, true, `${representative.kind} generated Markdown has at least one evidence anchor`);
    for (const anchorId of anchorIds) {
      assertEqual(llmsFull.includes(anchorId), true, `${representative.kind} LLM export retains evidence anchor ${anchorId}`);
    }
  }
}
