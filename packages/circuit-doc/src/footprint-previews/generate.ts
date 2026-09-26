/**
 * Footprint preview generation (issue #20; ported from zudo-led-lamp
 * `doc/component-docs/footprint-previews/generate.ts`).
 *
 * Config-driven where upstream was hard-coded: the renderer (image, version,
 * platform, layers, theme, options) comes from `cad.previewRenderer`, the
 * Docker invocation is injectable (`runDocker`), and the destructive
 * replacement of the preview root goes through the ownership guard
 * (`guard.ts`) instead of an unconditional `rm -rf`. Zero selected packages
 * never touches Docker at all.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PreviewRendererConfig } from "../config/define.ts";
import { fail } from "../core/errors.ts";
import { realDockerRunner, type DockerRunner } from "./docker.ts";
import { suppressFootprintText } from "./footprint.ts";
import { assertOwnedPreviewRoot } from "./guard.ts";
import { aggregateHash, sha256 } from "./hash.ts";
import { PREVIEW_FORMAT_VERSION, type FootprintPreviewEntry, type FootprintPreviewManifest, type FootprintSelection } from "./manifest.ts";
import { assertFootprintLibraryParity } from "./parity.ts";
import { normalizeSvg } from "./svg.ts";

/** Temp directory prefix for the working library/export trees (spec item 4). */
export const TEMP_PREFIX = "zcd-footprint-previews-";

export type GenerateFootprintPreviewsOptions = {
  readonly selections: readonly FootprintSelection[];
  readonly footprintMasterRoot: string;
  /** KiCad's `.pretty` resolution copy; canonical bytes are hashed and exported from here. */
  readonly footprintLibraryRoot: string;
  readonly previewRoot: string;
  /** Required when `selections.length > 0`; unused (and may be omitted) for the zero-package state. */
  readonly renderer?: PreviewRendererConfig;
  readonly runDocker?: DockerRunner;
};

export async function generateFootprintPreviews(
  options: GenerateFootprintPreviewsOptions,
): Promise<FootprintPreviewManifest> {
  const { selections, footprintMasterRoot, footprintLibraryRoot, previewRoot } = options;
  await assertFootprintLibraryParity(footprintMasterRoot, footprintLibraryRoot);

  if (selections.length === 0) {
    await assertOwnedPreviewRoot(previewRoot);
    await rm(previewRoot, { recursive: true, force: true });
    await mkdir(previewRoot, { recursive: true });
    const manifest: FootprintPreviewManifest = {
      formatVersion: PREVIEW_FORMAT_VERSION,
      canonicalInputSha256: aggregateHash([]),
      generatedOutputSha256: aggregateHash([]),
      packages: [],
    };
    await writeFile(join(previewRoot, "manifest.json"), serializeManifest(manifest), "utf8");
    return manifest;
  }

  const renderer = options.renderer;
  if (renderer === undefined) {
    fail("ADAPTER_CONTRACT", "footprint preview renderer config is required when packages are selected");
  }
  assertSafeSelections(selections);
  const runDocker = options.runDocker ?? realDockerRunner;

  const temporaryRoot = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
  const libraryRoot = join(temporaryRoot, "preview.pretty");
  const exportRoot = join(temporaryRoot, "export");
  const canonicalBefore = new Map<string, string>();
  try {
    await mkdir(libraryRoot);
    await mkdir(exportRoot);
    for (const selection of selections) {
      const canonical = await readFile(join(footprintLibraryRoot, `${selection.footprintName}.kicad_mod`));
      canonicalBefore.set(selection.footprintName, sha256(canonical));
      const exportOnly = suppressFootprintText(canonical.toString("utf8"));
      await writeFile(join(libraryRoot, `${selection.footprintName}.kicad_mod`), exportOnly, "utf8");
    }

    const version = await runContainer(runDocker, renderer, temporaryRoot, ["kicad-cli", "--version"]);
    if (version.trim() !== renderer.version) {
      fail("ADAPTER_CONTRACT", `pinned renderer reported unexpected version: ${version.trim()}`, {
        expected: renderer.version,
        actual: version.trim(),
      });
    }
    await runContainer(runDocker, renderer, temporaryRoot, [
      "kicad-cli", "fp", "export", "svg",
      "--layers", renderer.layers.join(","),
      "--theme", renderer.theme,
      ...renderer.options,
      "--output", "/work/export",
      "/work/preview.pretty",
    ]);

    const emitted = (await readdir(exportRoot)).sort();
    const expected = selections.map((selection) => `${selection.footprintName}.svg`).sort();
    if (JSON.stringify(emitted) !== JSON.stringify(expected)) {
      fail("ADAPTER_CONTRACT", "renderer output inventory mismatch", { expected, actual: emitted });
    }

    const entries: FootprintPreviewEntry[] = [];
    const outputs = new Map<string, string>();
    for (const selection of selections) {
      const filename = `${selection.footprintName}.svg`;
      const normalized = normalizeSvg(await readFile(join(exportRoot, filename), "utf8"));
      outputs.set(filename, normalized);
      entries.push({
        ...selection,
        assetPath: `/assets/component-previews/footprints/${filename}`,
        canonicalInputSha256: canonicalBefore.get(selection.footprintName) as string,
        generatedOutputSha256: sha256(normalized),
      });
    }
    const manifest: FootprintPreviewManifest = {
      formatVersion: PREVIEW_FORMAT_VERSION,
      renderer: { image: renderer.image, version: renderer.version },
      export: {
        layers: renderer.layers,
        theme: renderer.theme,
        options: renderer.options,
        textPolicy: "suppress-all-fp-text-in-temporary-library",
        postprocessor: "repository-svg-normalizer-v1",
      },
      canonicalInputSha256: aggregateHash(entries.map((entry) => ({ path: entry.footprintPath, sha256: entry.canonicalInputSha256 }))),
      generatedOutputSha256: aggregateHash(entries.map((entry) => ({ path: entry.assetPath, sha256: entry.generatedOutputSha256 }))),
      packages: entries,
    };

    for (const selection of selections) {
      const canonicalAfter = sha256(await readFile(join(footprintLibraryRoot, `${selection.footprintName}.kicad_mod`)));
      if (canonicalAfter !== canonicalBefore.get(selection.footprintName)) {
        fail("ADAPTER_CONTRACT", `canonical footprint changed during generation: ${selection.footprintName}`);
      }
    }

    // Ownership-guarded replacement (spec item 4): only after every input,
    // renderer output and canonical-immutability check has passed, so
    // regeneration also prunes stale assets from a previous selection.
    await assertOwnedPreviewRoot(previewRoot);
    await rm(previewRoot, { recursive: true, force: true });
    await mkdir(previewRoot, { recursive: true });
    for (const [filename, normalized] of outputs) await writeFile(join(previewRoot, filename), normalized, "utf8");
    await writeFile(join(previewRoot, "manifest.json"), serializeManifest(manifest), "utf8");
    return manifest;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function runContainer(
  runDocker: DockerRunner,
  renderer: PreviewRendererConfig,
  mount: string,
  args: readonly string[],
): Promise<string> {
  const { stdout, stderr } = await runDocker([
    // The pinned image's manifest list may carry only one platform (e.g.
    // linux/amd64) — no arm64 entry — so on a mismatched host (Apple Silicon,
    // ARM CI) both pull and run fail with "no matching manifest" unless the
    // platform is stated explicitly. Emulation was verified upstream to
    // reproduce the committed SVG bytes exactly.
    "run", "--rm", "--platform", renderer.platform, "--network", "none",
    "--mount", `type=bind,src=${mount},dst=/work`, renderer.image,
    ...args,
  ]);
  if (stderr.trim() !== "") process.stderr.write(stderr);
  return stdout;
}

function assertSafeSelections(selections: readonly FootprintSelection[]): void {
  const names = new Set<string>();
  const records = new Set<string>();
  for (const selection of selections) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(selection.footprintName)) {
      fail("PATH_CONTAINMENT", "unsafe footprint name", { footprintName: selection.footprintName });
    }
    if (names.has(selection.footprintName)) {
      fail("ADAPTER_CONTRACT", `duplicate footprint ${selection.footprintName}`);
    }
    names.add(selection.footprintName);
    for (const recordId of selection.recordIds) {
      if (records.has(recordId)) fail("ADAPTER_CONTRACT", `record ${recordId} maps to multiple packages`, { recordId });
      records.add(recordId);
    }
  }
}

function serializeManifest(manifest: FootprintPreviewManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
