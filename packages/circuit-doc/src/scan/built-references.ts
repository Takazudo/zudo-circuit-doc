import { MODEL_UNAVAILABLE_TEXT } from "../core/reference-descriptor.ts";
/**
 * The built-output reference checker (port of upstream
 * `check-built-component-references.mjs`; see
 * the epic #1 planning note `planning/explore/led-ui-cad.md` U7, removed from
 * the tree in #34 and kept in git history).
 *
 * Every structural assertion the upstream script made about a record page
 * (exactly one "Component references" section, rendered before the evidence
 * tables, one selected document label, one document link, one footprint preview
 * image with its inert no-JS starting state, one selected model, two enlarge
 * controls, two closed dialog shells with media-specific accessible names and
 * no visible title, a retained Sources section) is kept verbatim — only the
 * expected COUNTS (upstream hard-coded 35 records / 25 packages) become
 * parameters, read from the selection lock via the projected view model
 * instead.
 *
 * Zero records is a valid state: an absent `records/` directory counts as 0
 * record pages (never a read error), and an absent preview root is only
 * accepted when zero packages are expected — a project with selected packages
 * but a missing preview directory is a real build failure, not a zero state.
 * The catalog "must not create or reference live preview UI" check runs
 * unconditionally, including at zero records.
 */

import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";

import { PROJECT_COMMANDS } from "../cli/project.ts";
import { fail } from "../core/errors.ts";
import { byCodeUnit } from "../core/ids.ts";
import { CATALOG_ROUTE, FOOTPRINT_ASSET_BASE, MODEL_ASSET_BASE, RECORDS_ROUTE } from "../core/site.ts";
import { PACKAGELESS_REFERENCE_TEXT } from "../core/render/record.ts";
import type { PublicRecord, PublicViewModel } from "../core/view-model.ts";

/**
 * Mirrors the `labels` map `provider/v1/index.ts` `projectRecordReference`
 * assigns per `documentKind` — kept in sync by hand, the same way upstream's
 * `ALLOWED_DOCUMENT_LABELS` tracked its own adapter's three literal strings.
 */
const ALLOWED_DOCUMENT_LABELS = new Set(["Datasheet PDF", "Specification PDF", "Mechanical drawing PDF", "Source record"]);

const FOOTPRINT_SRC_PATTERN = new RegExp(
  `^${escapeRegExp(FOOTPRINT_ASSET_BASE)}[A-Za-z0-9._+-]+\\.svg$`,
  "u",
);
const MODEL_SRC_PATTERN = new RegExp(`^${escapeRegExp(MODEL_ASSET_BASE)}[A-Za-z0-9._+-]+\\.wrl$`, "u");

export type BuiltReferencesInput = {
  readonly distRoot: string;
  /** Already validated and projected; supplies the expected record/package counts. */
  readonly model: PublicViewModel;
};

export type BuiltReferencesReport = {
  readonly records: number;
  readonly footprints: number;
  readonly models: number;
};

export async function checkBuiltReferences(input: BuiltReferencesInput): Promise<BuiltReferencesReport> {
  const { distRoot, model } = input;
  const recordsRoot = distPath(distRoot, RECORDS_ROUTE);
  const catalogFile = join(distPath(distRoot, CATALOG_ROUTE), "index.html");
  const previewRoot = join(distRoot, "assets", "component-previews");
  const footprintRoot = join(previewRoot, "footprints");

  const expectedRecords = model.records.length;
  const expectedPackages = model.packagePreviews.length;
  const expectedModels = model.packagePreviews.filter(p => p.modelPath !== null).length;

  const recordDirectories = await listRecordDirectories(recordsRoot);
  if (recordDirectories.length !== expectedRecords) {
    fail("PUBLICATION_POLICY", "built site does not contain the expected number of component record routes", {
      expected: expectedRecords,
      actual: recordDirectories.length,
    });
  }

  // Ground truth for which SVG basenames are selected: the manifest the
  // preview generator (#20) actually wrote — never guessed from the view
  // model's `footprintPath` (that field names the SOURCE `.kicad_mod`, not the
  // published preview asset).
  const manifest = await readFootprintManifest(footprintRoot, expectedPackages);

  const referencedFootprints = new Set<string>();
  const referencedModels = new Set<string>();

  const recordsBySlug = new Map(model.records.map((record) => [String(record.identity.slug), record]));
  const builtSlugs = new Set(recordDirectories);
  const missingSlugs = [...recordsBySlug.keys()].filter((slug) => !builtSlugs.has(slug)).sort(byCodeUnit);
  const extraSlugs = recordDirectories.filter((slug) => !recordsBySlug.has(slug)).sort(byCodeUnit);
  if (missingSlugs.length > 0 || extraSlugs.length > 0) {
    fail("PUBLICATION_POLICY", "built component record routes do not match the published record slugs", {
      missing: missingSlugs,
      extra: extraSlugs,
    });
  }
  for (const slug of recordDirectories) {
    const html = await readFile(join(recordsRoot, slug, "index.html"), "utf8");
    const record = recordsBySlug.get(slug);
    if (record !== undefined && record.reference.footprint === null) {
      checkPackagelessRecordPage(slug, html, record);
      continue;
    }
    checkRecordPage(slug, html, referencedFootprints, referencedModels, record?.reference.footprint?.modelPath !== null);
  }

  if (!setsEqual(referencedFootprints, manifest.names)) {
    fail("PUBLICATION_POLICY", "record pages do not use exactly the manifest-selected footprint SVGs", {
      expected: [...manifest.names].sort(byCodeUnit),
      actual: [...referencedFootprints].sort(byCodeUnit),
    });
  }
  if (referencedModels.size !== expectedModels) {
    fail("PUBLICATION_POLICY", "record pages must deduplicate to exactly the selected package models", {
      expected: expectedModels,
      actual: referencedModels.size,
    });
  }

  if (manifest.existed) {
    await checkPreviewOutputFiles(previewRoot, manifest.names, referencedModels);
  } else if (expectedPackages !== 0) {
    fail("PUBLICATION_POLICY", `footprint preview manifest is missing; run \`${PROJECT_COMMANDS.previews}\``, {
      path: join(footprintRoot, "manifest.json"),
    });
  }
  await checkCatalogIsViewerFree(catalogFile);

  return { records: recordDirectories.length, footprints: manifest.names.size, models: referencedModels.size };
}

// --- record directory / preview listing ------------------------------------

async function listRecordDirectories(recordsRoot: string): Promise<readonly string[]> {
  let entries;
  try {
    entries = await readdir(recordsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort(byCodeUnit);
}

async function readFootprintManifest(
  footprintRoot: string,
  expectedPackages: number,
): Promise<{ readonly existed: boolean; readonly names: ReadonlySet<string> }> {
  const manifestPath = join(footprintRoot, "manifest.json");
  let manifestStat;
  try {
    manifestStat = await lstat(manifestPath);
  } catch (error) {
    // An absent preview root (no manifest at all) is only a valid zero state
    // when zero packages are expected; `checkBuiltReferences` enforces that.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { existed: false, names: new Set() };
    throw error;
  }
  if (!manifestStat.isFile()) {
    fail("PATH_CONTAINMENT", "footprint preview manifest is not a regular file", { path: manifestPath });
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { packages?: readonly { assetPath: string }[] };
  const packages = manifest.packages ?? [];
  if (packages.length !== expectedPackages) {
    fail("PUBLICATION_POLICY", "built footprint manifest does not contain the expected number of packages", {
      expected: expectedPackages,
      actual: packages.length,
    });
  }
  const names = new Set<string>();
  for (const entry of packages) {
    if (!FOOTPRINT_SRC_PATTERN.test(entry.assetPath)) {
      fail("PATH_CONTAINMENT", "manifest asset path is not a safe footprint SVG route", {
        assetPath: entry.assetPath,
      });
    }
    names.add(basename(entry.assetPath));
  }
  if (names.size !== expectedPackages) {
    fail("PUBLICATION_POLICY", "built footprint manifest names must be unique", {
      expected: expectedPackages,
      actual: names.size,
    });
  }
  return { existed: true, names };
}

async function checkPreviewOutputFiles(
  previewRoot: string,
  manifestFootprints: ReadonlySet<string>,
  referencedModels: ReadonlySet<string>,
): Promise<void> {
  const actualFiles = await listFiles(previewRoot);
  const expectedFiles = new Set<string>([
    "footprints/manifest.json",
    ...[...manifestFootprints].map((name) => `footprints/${name}`),
    ...[...referencedModels].map((name) => `models/${name}`),
  ]);
  const actualSet = new Set(actualFiles);
  if (!setsEqual(actualSet, expectedFiles)) {
    fail("PUBLICATION_POLICY", "built preview output contains missing, extra, or unselected assets", {
      expected: [...expectedFiles].sort(byCodeUnit).slice(0, 40),
      actual: actualFiles.sort(byCodeUnit).slice(0, 40),
    });
  }
  const stepFiles = actualFiles.filter((path) => [".step", ".stp"].includes(extname(path).toLowerCase()));
  if (stepFiles.length > 0) {
    fail("PATH_CONTAINMENT", "STEP files must not be browser-published", { offenders: stepFiles });
  }
}

async function listFiles(root: string, current: string = root): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      fail("PATH_CONTAINMENT", "built preview output contains a symlink", { path: entry.name });
    }
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, path)));
    } else if (entry.isFile()) {
      files.push(relative(root, path).split(sep).join("/"));
    } else {
      fail("PATH_CONTAINMENT", "built preview output contains a non-file entry", { path: entry.name });
    }
  }
  return files;
}

// --- package-less record pages (external part, or CAD off with expect.packages 0) --

/**
 * A record with no published package renders no viewer: it must still link its
 * selected document, say plainly why no footprint or model is shown, and
 * reference no preview asset.
 */
function checkPackagelessRecordPage(slug: string, html: string, record: PublicRecord): void {
  if (extractReferenceSections(html).length !== 0) {
    fail("PUBLICATION_POLICY", `${slug} renders a Component references viewer without a published package`, { slug });
  }
  const statement = PACKAGELESS_REFERENCE_TEXT[record.reference.mounting];
  if (!html.includes(`>${statement}</p>`)) {
    fail("PUBLICATION_POLICY", `${slug} must state why no footprint or 3D model is published`, { slug });
  }
  const documentUrl = String(record.reference.document.url);
  const hrefs = [...html.matchAll(/<a\b[^>]*\bhref=[^>]*>/gu)].map((match) => decodeHtml(readAttribute(match[0], "href", slug)));
  if (!hrefs.includes(documentUrl)) {
    fail("PUBLICATION_POLICY", `${slug} must link its selected document`, { slug, url: documentUrl });
  }
  if (html.includes(FOOTPRINT_ASSET_BASE) || html.includes(MODEL_ASSET_BASE)) {
    fail("PUBLICATION_POLICY", `${slug} references a preview asset without a published package`, { slug });
  }
}

// --- per-record structural assertions (kept verbatim from upstream) --------

export function checkRecordPage(
  slug: string,
  html: string,
  referencedFootprints: Set<string>,
  referencedModels: Set<string>,
  hasModel = true,
): void {
  const sections = extractReferenceSections(html);
  if (sections.length !== 1) {
    fail("PUBLICATION_POLICY", `${slug} must render exactly one Component references section`, {
      slug,
      sections: String(sections.length),
    });
  }
  const section = sections[0] as string;
  if (html.indexOf(section) >= html.indexOf("zcd-evidence-table")) {
    fail("PUBLICATION_POLICY", `${slug} must render Component references before evidence tables`, { slug });
  }

  const labels = [
    ...section.matchAll(
      /<p\b[^>]*class=(?:"zcd-component-references__document-label"|zcd-component-references__document-label)[^>]*>([^<]+)<\/p>/gu,
    ),
  ];
  if (labels.length !== 1) fail("PUBLICATION_POLICY", `${slug} must render one selected document label`, { slug });
  const label = decodeHtml(labels[0]?.[1] ?? "");
  if (!ALLOWED_DOCUMENT_LABELS.has(label)) {
    fail("PUBLICATION_POLICY", `${slug} has an unreviewed document label`, { slug, label });
  }

  const documents = [
    ...section.matchAll(
      /<p\b[^>]*class=(?:"zcd-component-references__document-title"|zcd-component-references__document-title)[^>]*>\s*(<a\b[^>]*>)/gu,
    ),
  ];
  if (documents.length !== 1) fail("PUBLICATION_POLICY", `${slug} must render one selected document destination`, { slug });
  const documentUrl = new URL(decodeHtml(readAttribute(documents[0]?.[1] ?? "", "href", slug)));
  if (documentUrl.protocol !== "https:" && documentUrl.protocol !== "http:") {
    fail("PUBLICATION_POLICY", `${slug} document URL must be HTTP(S)`, { slug, url: documentUrl.href });
  }

  const footprintImages = [
    ...section.matchAll(/<img\b[^>]*\balt=(?:"Footprint preview for [^"]+"|'Footprint preview for [^']+'|Footprint[^\s>]*)[^>]*>/gu),
  ];
  if (footprintImages.length !== 1) fail("PUBLICATION_POLICY", `${slug} must render one footprint preview image`, { slug });
  const footprintPath = decodeHtml(readAttribute(footprintImages[0]?.[0] ?? "", "src", slug));
  if (!FOOTPRINT_SRC_PATTERN.test(footprintPath)) {
    fail("PATH_CONTAINMENT", `${slug} footprint preview image has an unsafe src`, { slug, src: footprintPath });
  }
  referencedFootprints.add(basename(footprintPath));
  if (!/data-footprint-preview-state=(?:"no-js"|no-js)(?:\s|>)/u.test(section)) {
    fail("PUBLICATION_POLICY", `${slug} footprint enhancement must start inert`, { slug });
  }
  if (!/data-zfb-island=(?:"FootprintPreviewIsland"|FootprintPreviewIsland)(?:\s|>)/u.test(section)) {
    fail("PUBLICATION_POLICY", `${slug} must register the footprint island`, { slug });
  }
  if (!section.includes(">Open SVG</a>")) {
    fail("PUBLICATION_POLICY", `${slug} must retain the direct footprint link without JavaScript`, { slug });
  }

  if (!hasModel) {
    if (!section.includes(MODEL_UNAVAILABLE_TEXT) || !/data-model-unavailable/u.test(section)) {
      fail("PUBLICATION_POLICY", `${slug} must explicitly state model unavailability`, { slug });
    }
    if (/data-model-url|PackageModelViewerIsland|data-component-model-viewer-root/u.test(section)) {
      fail("PUBLICATION_POLICY", `${slug} must not invent a model viewer`, { slug });
    }
    for (const attribute of ["data-component-preview-enlarge", "data-component-preview-dialog"]) {
      const tags = section.match(new RegExp(`<[^>]+\\b${attribute}=[^>]*>`, "gu")) ?? [];
      if (tags.length !== 1 || readAttribute(tags[0], attribute, slug) !== "footprint") {
        fail("PUBLICATION_POLICY", `${slug} must retain only the footprint control and dialog`, { slug });
      }
    }
    return;
  }
  const modelTags = section.match(/<[^>]+\bdata-model-url=(?:"[^"]+"|'[^']+'|[^\s>]+)[^>]*>/gu) ?? [];
  const modelPaths = modelTags.map((tag) => decodeHtml(readAttribute(tag, "data-model-url", slug)));
  if (modelPaths.length !== 1) fail("PUBLICATION_POLICY", `${slug} must render one selected package model`, { slug });
  const modelPath = modelPaths[0] ?? "";
  if (!MODEL_SRC_PATTERN.test(modelPath)) {
    fail("PATH_CONTAINMENT", `${slug} model reference has an unsafe src`, { slug, src: modelPath });
  }
  referencedModels.add(basename(modelPath));

  if (!/data-viewer-state=(?:"no-js"|no-js)(?:\s|>)/u.test(section)) {
    fail("PUBLICATION_POLICY", `${slug} must retain a no-JS viewer state`, { slug });
  }
  if (!/data-model-viewer-instance=(?:"inline"|inline)(?:\s|>)/u.test(section)) {
    fail("PUBLICATION_POLICY", `${slug} must render only the inline model initially`, { slug });
  }
  if (!/data-zfb-island=(?:"PackageModelViewerIsland"|PackageModelViewerIsland)(?:\s|>)/u.test(section)) {
    fail("PUBLICATION_POLICY", `${slug} must register the model island`, { slug });
  }

  const enlargeTriggers = section.match(/<button\b[^>]*\bdata-component-preview-enlarge=(?:"[^"]+"|'[^']+'|[^\s>]+)[^>]*>/gu) ?? [];
  if (enlargeTriggers.length !== 2) fail("PUBLICATION_POLICY", `${slug} must render footprint and model enlarge controls`, { slug });
  const enlargeKinds = enlargeTriggers.map((tag) => readAttribute(tag, "data-component-preview-enlarge", slug)).sort(byCodeUnit);
  if (enlargeKinds.join(",") !== "footprint,model") {
    fail("PUBLICATION_POLICY", `${slug} enlarge controls must target both preview kinds`, { slug, kinds: enlargeKinds });
  }
  for (const tag of enlargeTriggers) {
    if (!/^Enlarge (?:footprint|3D) preview/u.test(decodeHtml(readAttribute(tag, "aria-label", slug)))) {
      fail("PUBLICATION_POLICY", `${slug} enlarge control needs a specific accessible name`, { slug });
    }
  }

  const dialogs = section.match(/<dialog\b[^>]*\bdata-component-preview-dialog=(?:"[^"]+"|'[^']+'|[^\s>]+)[^>]*>/gu) ?? [];
  if (dialogs.length !== 2) fail("PUBLICATION_POLICY", `${slug} must render two closed preview dialog shells`, { slug });
  const dialogKinds = dialogs.map((tag) => readAttribute(tag, "data-component-preview-dialog", slug)).sort(byCodeUnit);
  if (dialogKinds.join(",") !== "footprint,model") {
    fail("PUBLICATION_POLICY", `${slug} dialog shells must cover both preview kinds`, { slug, kinds: dialogKinds });
  }
  for (const tag of dialogs) {
    const label = decodeHtml(readAttribute(tag, "aria-label", slug));
    if (!/^(?:Footprint preview for|Interactive 3D view of) /u.test(label)) {
      fail("PUBLICATION_POLICY", `${slug} dialog needs a media-specific accessible name`, { slug, label });
    }
    if (/\baria-labelledby=/u.test(tag)) {
      fail("PUBLICATION_POLICY", `${slug} dialog must not refer to a visible title`, { slug });
    }
  }
  if (section.includes("zcd-preview-dialog__title")) {
    fail("PUBLICATION_POLICY", `${slug} enlarged media must not include a visible title`, { slug });
  }
  if (!/Interactive inspection requires JavaScript and WebGL\. The package identity remains available in this page\./u.test(section)) {
    fail("PUBLICATION_POLICY", `${slug} must retain a useful static viewer explanation`, { slug });
  }
  if (!/id=(?:"sources"|sources)(?:\s|>)/u.test(html)) {
    fail("PUBLICATION_POLICY", `${slug} must retain its Sources section`, { slug });
  }
}

async function checkCatalogIsViewerFree(catalogFile: string): Promise<void> {
  const catalog = await readFile(catalogFile, "utf8");
  if (
    /data-component-model-viewer-root|data-model-url|component-previews\/models\/|data-component-preview-(?:dialog|enlarge)|<canvas\b/u.test(
      catalog,
    )
  ) {
    fail("PUBLICATION_POLICY", "catalog index must not create or reference live preview UI", {
      path: catalogFile,
    });
  }
}

// --- helpers ---------------------------------------------------------------

function distPath(distRoot: string, route: string): string {
  return join(distRoot, ...route.split("/").filter((segment) => segment !== ""));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function setsEqual<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function decodeHtml(value: string): string {
  return value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
}

function extractReferenceSections(html: string): readonly string[] {
  const marker = /\bclass=(?:"zcd-component-references"|'zcd-component-references'|zcd-component-references)(?=\s|>)/gu;
  const matches = [...html.matchAll(marker)];
  return matches.map((match) => {
    const markerIndex = match.index ?? -1;
    const start = html.lastIndexOf("<section", markerIndex);
    const end = html.indexOf("</section>", markerIndex);
    if (start < 0 || end < 0) fail("PUBLICATION_POLICY", "Component references section markup is incomplete");
    return html.slice(start, end + "</section>".length);
  });
}

function readAttribute(tag: string, name: string, slug: string): string {
  const match = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "u").exec(tag);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  if (value === undefined) {
    fail("PUBLICATION_POLICY", `${slug} is missing a ${name} attribute`, { slug, tag: tag.slice(0, 160) });
  }
  return value;
}
