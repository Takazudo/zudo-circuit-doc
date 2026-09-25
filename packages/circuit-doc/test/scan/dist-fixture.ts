/**
 * A synthetic, hand-built dist tree for `runArtifactScan` tests.
 *
 * It does not run the real render/emit pipeline — it writes plain text/HTML
 * files that carry the same positive-control values `artifacts.ts` itself
 * derives from the projection (`buildPositiveControls`/`buildDiscoveryControls`),
 * so the fixture stays correct automatically as those functions evolve instead
 * of hard-coding field values borrowed from a specific fixture model.
 *
 * Not a `*.test.ts` file, so `node --test` does not pick it up as a suite.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  buildDiscoveryControls,
  buildPositiveControls,
  type Control,
} from "../../src/scan/artifacts.ts";
import { CATALOG_ROUTE, COMPONENTS_ROUTE, INTEGRATION_ROUTE, RECORDS_ROUTE } from "../../src/core/site.ts";
import type { PublicRecord, PublicViewModel } from "../../src/core/view-model.ts";

export type SyntheticProjectPaths = {
  readonly generatedRoot: string;
  readonly preflightFile: string;
  readonly distRoot: string;
  readonly docsRoot: string;
};

function segments(route: string): readonly string[] {
  return route.split("/").filter((segment) => segment !== "");
}

function text(controls: readonly Control[]): string {
  return controls.map((control) => `${control.label}: ${control.value}`).join("\n");
}

async function write(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

/**
 * Builds a project rooted at `root` whose dist tree, generated MDX, preflight
 * report and (empty) authored-content root make `runArtifactScan` pass cleanly
 * against `model` — the base a test then mutates to provoke one failure.
 */
export async function writeSyntheticProject(
  root: string,
  model: PublicViewModel,
): Promise<SyntheticProjectPaths> {
  const paths: SyntheticProjectPaths = {
    generatedRoot: join(root, "generated"),
    preflightFile: join(root, "circuit/generated/preflight.json"),
    distRoot: join(root, "dist"),
    docsRoot: join(root, "doc"),
  };

  // Authored content root: empty, so the SITE-tier subtraction corpus is empty
  // and every canary is asked for on dist/agent targets at full strength.
  await mkdir(join(paths.docsRoot, "src/content/docs"), { recursive: true });
  // Always created, even at zero records: a project whose `generate` has never
  // run still has an (empty) generated-content directory once `emit.ts` has
  // touched it once, and a test simulating "generate has not run" removes the
  // directory's CONTENTS, not the directory itself (see `artifacts.test.ts`).
  await mkdir(paths.generatedRoot, { recursive: true });

  await write(paths.preflightFile, JSON.stringify({ note: "synthetic preflight, no positive controls needed" }));

  const componentsDist = join(paths.distRoot, ...segments(COMPONENTS_ROUTE));
  await write(join(componentsDist, "index.html"), "<html><body>Components</body></html>");
  await write(join(paths.distRoot, ...segments(CATALOG_ROUTE), "index.html"), "<html><body>Catalog</body></html>");
  await write(join(paths.distRoot, ...segments(RECORDS_ROUTE), "index.html"), "<html><body>Records</body></html>");
  await write(
    join(paths.distRoot, ...segments(INTEGRATION_ROUTE), "index.html"),
    "<html><body>Integration</body></html>",
  );

  const searchEntries: { url: string; description: string }[] = [];
  const llmsLines: string[] = [];
  const fullPositiveText: string[] = [];

  for (const record of model.records) {
    const controls = buildPositiveControls(record);
    const discovery = buildDiscoveryControls(record);
    const slug = record.identity.slug;

    await write(join(paths.generatedRoot, "records", `${slug}.mdx`), text(controls));
    await write(
      join(paths.distRoot, ...segments(RECORDS_ROUTE), slug, "index.html"),
      `<html><body><pre>${text(controls)}</pre></body></html>`,
    );

    searchEntries.push({
      url: `/docs/components/records/${slug}`,
      description: discovery.map((control) => control.value).join(" "),
    });
    llmsLines.push(`- /docs/components/records/${slug} ${discovery.map((control) => control.value).join(" ")}`);
    fullPositiveText.push(text(controls));
  }

  await write(join(paths.distRoot, "search-index.json"), JSON.stringify(searchEntries));
  await write(join(paths.distRoot, "llms.txt"), llmsLines.join("\n"));
  await write(join(paths.distRoot, "llms-full.txt"), fullPositiveText.join("\n\n"));

  return paths;
}

export function positiveControlsOf(record: PublicRecord): readonly Control[] {
  return buildPositiveControls(record);
}

/** The built HTML path `writeSyntheticProject` used for one record's page. */
export function recordDistHtmlPath(paths: SyntheticProjectPaths, slug: string): string {
  return join(paths.distRoot, ...segments(RECORDS_ROUTE), slug, "index.html");
}
