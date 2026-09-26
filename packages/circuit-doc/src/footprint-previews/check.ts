/**
 * Docker-free footprint preview drift check (issue #20; ported from
 * zudo-led-lamp `doc/component-docs/footprint-previews/check.ts`).
 *
 * Zero-selection semantics (spec item 3): passes when the preview root is
 * absent, or when it holds a manifest with `packages: []` and the aggregate
 * hashes of an empty set. A configured root that is missing, symlinked or
 * malformed still fails whenever packages are actually expected.
 */

import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import type { PreviewRendererConfig } from "../config/define.ts";
import { fail } from "../core/errors.ts";
import { aggregateHash, sha256 } from "./hash.ts";
import { PREVIEW_FORMAT_VERSION, type FootprintPreviewManifest, type FootprintSelection } from "./manifest.ts";
import { assertFootprintLibraryParity } from "./parity.ts";
import { validateSvg } from "./svg.ts";

export type CheckFootprintPreviewsOptions = {
  readonly selections: readonly FootprintSelection[];
  readonly footprintMasterRoot: string;
  readonly footprintLibraryRoot: string;
  readonly previewRoot: string;
  /** Required when `selections.length > 0`; unused (and may be omitted) for the zero-package state. */
  readonly renderer?: PreviewRendererConfig;
};

export async function checkFootprintPreviews(options: CheckFootprintPreviewsOptions): Promise<void> {
  const { selections, footprintMasterRoot, footprintLibraryRoot, previewRoot, renderer } = options;
  await assertFootprintLibraryParity(footprintMasterRoot, footprintLibraryRoot);

  const rootStat = await lstat(previewRoot).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (rootStat === null) {
    if (selections.length === 0) return;
    fail("ADAPTER_CONTRACT", "footprint preview root is missing", { path: previewRoot });
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    fail("PATH_CONTAINMENT", "footprint preview root must be a real directory", { path: previewRoot });
  }

  const manifestPath = join(previewRoot, "manifest.json");
  const manifestText = await readFile(manifestPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") fail("ADAPTER_CONTRACT", "footprint preview manifest is missing", { path: manifestPath });
    throw error;
  });
  const manifest = JSON.parse(manifestText) as FootprintPreviewManifest;
  if (manifest.formatVersion !== PREVIEW_FORMAT_VERSION) fail("ADAPTER_CONTRACT", "footprint preview manifest format is stale");

  const actualFiles = await readdir(previewRoot);

  if (selections.length === 0) {
    if (manifest.packages.length !== 0) fail("ADAPTER_CONTRACT", "manifest and selection must both contain zero packages");
    assertExactFiles(new Set(["manifest.json"]), actualFiles);
    if (manifest.canonicalInputSha256 !== aggregateHash([])) fail("ADAPTER_CONTRACT", "aggregate canonical input hash is stale");
    if (manifest.generatedOutputSha256 !== aggregateHash([])) fail("ADAPTER_CONTRACT", "aggregate generated output hash is stale");
    return;
  }

  if (renderer === undefined) fail("ADAPTER_CONTRACT", "footprint preview renderer config is required when packages are selected");
  assertMetadata(manifest, renderer);
  if (manifest.packages.length !== selections.length) {
    fail("ADAPTER_CONTRACT", "manifest and selection must contain the same number of packages", {
      manifestPackages: manifest.packages.length,
      selectedPackages: selections.length,
    });
  }

  const expectedFiles = new Set(["manifest.json", ...selections.map((entry) => `${entry.footprintName}.svg`)]);
  assertExactFiles(expectedFiles, actualFiles);
  for (const filename of actualFiles) {
    const stat = await lstat(join(previewRoot, filename));
    if (!stat.isFile() || stat.isSymbolicLink()) fail("PATH_CONTAINMENT", `footprint preview output is not a regular file: ${filename}`);
  }

  const inputHashes: Array<{ path: string; sha256: string }> = [];
  const outputHashes: Array<{ path: string; sha256: string }> = [];
  for (let index = 0; index < selections.length; index += 1) {
    const selection = selections[index] as FootprintSelection;
    const entry = manifest.packages[index];
    if (entry === undefined || JSON.stringify(pickSelection(entry)) !== JSON.stringify(selection)) {
      fail("ADAPTER_CONTRACT", `stale package selection at index ${index}`, { index });
    }
    const expectedAssetPath = `/assets/component-previews/footprints/${selection.footprintName}.svg`;
    if (entry.assetPath !== expectedAssetPath) fail("ADAPTER_CONTRACT", `unsafe or stale asset path for ${selection.packageId}`);
    const inputHash = sha256(await readFile(join(footprintLibraryRoot, `${selection.footprintName}.kicad_mod`)));
    if (entry.canonicalInputSha256 !== inputHash) fail("ADAPTER_CONTRACT", `stale canonical input hash for ${selection.packageId}`);
    const svg = await readFile(join(previewRoot, `${selection.footprintName}.svg`), "utf8");
    validateSvg(svg);
    if (/REF\*\*|%R|<text\b|class="stroked-text"/iu.test(svg)) {
      fail("PUBLICATION_POLICY", `visible footprint text survived in ${selection.packageId}`);
    }
    const outputHash = sha256(svg);
    if (entry.generatedOutputSha256 !== outputHash) fail("ADAPTER_CONTRACT", `stale generated output hash for ${selection.packageId}`);
    inputHashes.push({ path: entry.footprintPath, sha256: inputHash });
    outputHashes.push({ path: entry.assetPath, sha256: outputHash });
  }
  if (manifest.canonicalInputSha256 !== aggregateHash(inputHashes)) fail("ADAPTER_CONTRACT", "aggregate canonical input hash is stale");
  if (manifest.generatedOutputSha256 !== aggregateHash(outputHashes)) fail("ADAPTER_CONTRACT", "aggregate generated output hash is stale");
}

function assertMetadata(manifest: FootprintPreviewManifest, renderer: PreviewRendererConfig): void {
  if (manifest.renderer === undefined || manifest.export === undefined) {
    fail("ADAPTER_CONTRACT", "footprint preview manifest is missing renderer metadata");
  }
  if (manifest.renderer.image !== renderer.image || manifest.renderer.version !== renderer.version) {
    fail("ADAPTER_CONTRACT", "footprint renderer metadata is stale");
  }
  if (
    JSON.stringify(manifest.export.layers) !== JSON.stringify(renderer.layers) ||
    manifest.export.theme !== renderer.theme ||
    JSON.stringify(manifest.export.options) !== JSON.stringify(renderer.options) ||
    manifest.export.textPolicy !== "suppress-all-fp-text-in-temporary-library" ||
    manifest.export.postprocessor !== "repository-svg-normalizer-v1"
  ) {
    fail("ADAPTER_CONTRACT", "footprint export contract is stale");
  }
}

function assertExactFiles(expected: ReadonlySet<string>, actual: readonly string[]): void {
  for (const filename of actual) if (!expected.has(filename)) fail("ADAPTER_CONTRACT", `extra footprint preview output: ${filename}`);
  for (const filename of expected) if (!actual.includes(filename)) fail("ADAPTER_CONTRACT", `missing footprint preview output: ${filename}`);
}

function pickSelection(entry: FootprintPreviewManifest["packages"][number]): FootprintSelection {
  return { packageId: entry.packageId, footprintName: entry.footprintName, footprintPath: entry.footprintPath, recordIds: entry.recordIds };
}
