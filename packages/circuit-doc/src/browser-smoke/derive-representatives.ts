/**
 * Default representatives for a project that publishes records but never set
 * `browserSmoke.representatives` (#47). Without this, `check-browser` fell back
 * to an empty list and reported a false "declared-zero" pass.
 *
 * The published record set comes from the preflight report; each record's data
 * comes from its generated page (`<generatedRoot>/records/<slug>/index.mdx`):
 * the frontmatter `title` is the record's MPN (its identity), and the
 * `ComponentReferences` descriptor carries the document, footprint and model
 * that `checks/reference-page.ts` asserts on. A record qualifies only when its
 * descriptor decodes to either a selected document (reviewed label, http(s)
 * URL, non-empty authority) or a reviewed unavailable-document reason, plus a
 * footprint and optional declared WRL model. The page keeps Sources plus at
 * least one evidence fact after the references section. When the site is already built, the
 * built page must carry the references section and the footprint/model assets
 * must exist.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { decodeComponentReferencesDescriptor } from "../core/reference-descriptor.ts";
import { decodeModelDescriptor } from "../core/model-descriptor.ts";
import { RECORDS_ROUTE } from "../core/site.ts";
import { hasPublishedReferences } from "./representatives.ts";
import type { Representative } from "./types.ts";

export const MAX_DERIVED_REPRESENTATIVES = 3;

export type DerivedRepresentatives =
  | { readonly outcome: "declared-zero" }
  | { readonly outcome: "derived"; readonly publishedRecords: number; readonly representatives: readonly Representative[] }
  | { readonly outcome: "none-qualify"; readonly publishedRecords: number };

export type DeriveOptions = {
  readonly preflightFile: string;
  readonly generatedRoot: string;
  readonly distRoot: string;
};

const DESCRIPTOR = /<ComponentReferences descriptor="([0-9a-f]+)" \/>/u;
const TITLE = /^title: (".*")$/mu;

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** Published record slugs from the preflight report; throws when it is missing or malformed. */
export async function readPublishedSlugs(preflightFile: string): Promise<readonly string[]> {
  let raw: string;
  try {
    raw = await readFile(preflightFile, "utf8");
  } catch (error) {
    throw new Error(`check-browser: cannot read the preflight report ${preflightFile}: ${(error as Error).message}`);
  }
  let report: { records?: { slugs?: unknown } } | null;
  try {
    report = JSON.parse(raw) as typeof report;
  } catch (error) {
    throw new Error(`check-browser: ${preflightFile} is not valid JSON: ${(error as Error).message}`);
  }
  const slugs = report?.records?.slugs;
  if (!Array.isArray(slugs) || !slugs.every((slug) => typeof slug === "string" && slug !== "")) {
    throw new Error(`check-browser: ${preflightFile} has no records.slugs list`);
  }
  return slugs as string[];
}

async function qualify(slug: string, options: DeriveOptions, distBuilt: boolean): Promise<{ representative: Representative; hasModel: boolean } | undefined> {
  const markdown = await readFile(join(options.generatedRoot, "records", slug, "index.mdx"), "utf8").catch(() => null);
  if (markdown === null) return undefined;

  const titleLiteral = TITLE.exec(markdown)?.[1];
  const descriptorMatch = DESCRIPTOR.exec(markdown);
  if (titleLiteral === undefined || descriptorMatch === null) return undefined;
  let identity: unknown;
  let assets: readonly string[];
  try {
    identity = JSON.parse(titleLiteral);
    const descriptor = decodeComponentReferencesDescriptor(descriptorMatch[1] as string);
    if ("authority" in descriptor.document && descriptor.document.authority.trim() === "") return undefined;
    assets = [descriptor.footprint.assetUrl, ...(descriptor.modelDescriptor === null ? [] : [decodeModelDescriptor(descriptor.modelDescriptor).modelUrl])];
  } catch {
    return undefined;
  }
  if (typeof identity !== "string" || identity.trim() === "") return undefined;

  const afterReferences = markdown.slice(descriptorMatch.index);
  if (!afterReferences.includes("<EvidenceFact>") || !/^## Sources$/mu.test(markdown)) return undefined;

  const representative: Representative = {
    kind: `derived ${slug}`,
    path: `${RECORDS_ROUTE}${slug}/`,
    slug,
    identity,
  };
  if (distBuilt) {
    if (!(await hasPublishedReferences(options.distRoot, representative))) return undefined;
    for (const asset of assets) {
      if (!(await exists(join(options.distRoot, asset)))) return undefined;
    }
  }
  return { representative, hasModel: assets.length > 1 };
}

/**
 * Deterministic: records are considered in sorted slug order (slugs are the
 * record IDs' public form) and the first {@link MAX_DERIVED_REPRESENTATIVES}
 * that qualify are taken, reserving the final slot for the first later model
 * when all initial slots are footprint-only. Each gets a unique `kind`, because `run.ts` keys the
 * light/dark comparison by `${width}:${kind}`.
 */
export async function deriveRepresentatives(options: DeriveOptions): Promise<DerivedRepresentatives> {
  const slugs = [...(await readPublishedSlugs(options.preflightFile))].sort();
  if (slugs.length === 0) return { outcome: "declared-zero" };

  // An unbuilt site is reported by `runBrowserSmoke` itself; here it only
  // means the built-output checks cannot run yet.
  const distBuilt = await exists(join(options.distRoot, "index.html"));
  const representatives: Representative[] = [];
  let hasModel = false;
  for (const slug of slugs) {
    const representative = await qualify(slug, options, distBuilt);
    if (representative === undefined) continue;
    if (representatives.length < MAX_DERIVED_REPRESENTATIVES) {
      representatives.push(representative.representative);
    } else if (representative.hasModel) {
      // Keep at least one actual model for the deep-interaction pass when one
      // exists; leading footprint-only records must not silently suppress it.
      representatives[MAX_DERIVED_REPRESENTATIVES - 1] = representative.representative;
    }
    hasModel ||= representative.hasModel;
    if (representatives.length === MAX_DERIVED_REPRESENTATIVES && hasModel) break;
  }
  return representatives.length === 0
    ? { outcome: "none-qualify", publishedRecords: slugs.length }
    : { outcome: "derived", publishedRecords: slugs.length, representatives };
}
