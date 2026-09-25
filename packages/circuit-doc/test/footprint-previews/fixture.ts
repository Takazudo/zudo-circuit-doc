/**
 * A footprint-preview fixture built on the shared synthetic provider corpus
 * (`../fixtures/provider-fixtures.ts`): the same 3-package project
 * `model-assets.test.ts` uses, plus a mirrored `footprintMasterRoot` (which
 * `writeFixtureProject` does not set up, since nothing outside this issue
 * reads it) so `assertFootprintLibraryParity` passes by construction.
 *
 * Not a `*.test.ts` file, so `node --test` does not pick it up as a suite.
 */

import { copyFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

import type { EvidenceIndex } from "../../src/provider/v1/evidence.ts";
import { readEvidenceIndex } from "../../src/provider/v1/index.ts";
import type { CircuitProjectPaths } from "../../src/provider/v1/paths.ts";
import type { PreviewRendererConfig } from "../../src/config/define.ts";
import { footprintSelectionsFromIndex } from "../../src/footprint-previews/selection.ts";
import type { FootprintSelection } from "../../src/footprint-previews/manifest.ts";
import {
  FIXTURE_MODEL_PREFIX,
  FIXTURE_SELECTION,
  writeFixtureProject,
  type FixtureProjectContents,
} from "../fixtures/provider-fixtures.ts";

/** A renderer config distinct from any real KiCad pin, so a stale-metadata bug can't hide behind it. */
export const FIXTURE_RENDERER: PreviewRendererConfig = {
  image: "fixture/kicad@sha256:0000000000000000000000000000000000000000000000000000000000f1",
  version: "9.9.9-fixture",
  platform: "linux/amd64",
  layers: ["F.Cu", "F.Silkscreen"],
  theme: "Fixture Theme",
  options: ["--black-and-white"],
};

export type FootprintFixture = {
  readonly paths: CircuitProjectPaths;
  readonly index: EvidenceIndex;
  readonly selections: readonly FootprintSelection[];
};

/** A safe, minimal SVG `validateSvg` accepts, distinguishable per footprint name via its title (stripped by `normalizeSvg`). */
export function fixtureSvg(name: string): string {
  return `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="2mm" height="2mm" viewBox="0 0 2 2"><title>${name}</title><path d="M0 0 L1 1"/></svg>`;
}

export async function buildFootprintFixture(
  root: string,
  options: { readonly contents?: FixtureProjectContents; readonly selection?: typeof FIXTURE_SELECTION } = {},
): Promise<FootprintFixture> {
  const paths = await writeFixtureProject(root, options.contents ?? {});
  await mirrorMasterRoot(paths);
  const selection = options.selection ?? FIXTURE_SELECTION;
  const index = await readEvidenceIndex({
    paths,
    selection,
    reference: { modelLocatorPrefix: FIXTURE_MODEL_PREFIX },
  });
  const selections = footprintSelectionsFromIndex(index, selection);
  return { paths, index, selections };
}

/**
 * `writeFixtureProject` only writes footprints into `footprintLibraryRoot`
 * (the `.pretty` resolution copy `references.ts` reads); mirror them into
 * `footprintMasterRoot` (the authoring copy `parity.ts` compares against) so
 * the two stay byte-identical, as a real project's master/library pair must.
 */
async function mirrorMasterRoot(paths: CircuitProjectPaths): Promise<void> {
  // `writeFixtureProject` only creates `footprintLibraryRoot` when at least one
  // footprint exists; the zero-package fixture needs both roots to exist as
  // real (empty) directories for `assertFootprintLibraryParity` to pass.
  await mkdir(paths.footprintLibraryRoot, { recursive: true });
  await mkdir(paths.footprintMasterRoot, { recursive: true });
  const names = (await readdir(paths.footprintLibraryRoot)).filter((name) => name.endsWith(".kicad_mod"));
  for (const name of names) {
    await copyFile(join(paths.footprintLibraryRoot, name), join(paths.footprintMasterRoot, name));
  }
}
