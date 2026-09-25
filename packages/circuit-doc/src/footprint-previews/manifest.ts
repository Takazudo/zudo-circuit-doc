/**
 * The footprint preview manifest (ported from zudo-led-lamp
 * `doc/component-docs/footprint-previews/manifest.ts:1-30`).
 *
 * `renderer`/`export` are optional so the zero-package manifest (no KiCad run
 * ever happened) can omit them entirely rather than echo a renderer config
 * that was never exercised — `check.ts` only requires them when
 * `packages.length > 0`.
 */

export const PREVIEW_FORMAT_VERSION = 1;

export type FootprintSelection = {
  readonly packageId: string;
  readonly footprintName: string;
  /** Repo-root-relative (config `cad.footprintPathBase`); keeps committed manifest hashes valid. */
  readonly footprintPath: string;
  readonly recordIds: readonly string[];
};

export type FootprintPreviewEntry = FootprintSelection & {
  readonly assetPath: string;
  readonly canonicalInputSha256: string;
  readonly generatedOutputSha256: string;
};

export type FootprintPreviewManifest = {
  readonly formatVersion: number;
  readonly renderer?: {
    readonly image: string;
    readonly version: string;
  };
  readonly export?: {
    readonly layers: readonly string[];
    readonly theme: string;
    readonly options: readonly string[];
    readonly textPolicy: "suppress-all-fp-text-in-temporary-library";
    readonly postprocessor: "repository-svg-normalizer-v1";
  };
  readonly canonicalInputSha256: string;
  readonly generatedOutputSha256: string;
  readonly packages: readonly FootprintPreviewEntry[];
};
