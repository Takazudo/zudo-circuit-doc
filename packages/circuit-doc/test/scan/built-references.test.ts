/**
 * `checkBuiltReferences` (port of upstream `check-built-component-references.mjs`).
 *
 * A synthetic 1-record dist tree, hand-assembled from named HTML parts so a
 * test can remove or corrupt exactly one structural piece and confirm the
 * matching assertion fails — the spec's "each structural removal -> FAIL".
 * This is a representative subset of the ~30 assertions `checkRecordPage`
 * makes (one per assertion category: section markup, PDF selection, footprint
 * enhancement, model viewer, enlarge controls, dialogs, Sources section,
 * ordering, manifest, preview-output set, STEP exclusion, catalog), not an
 * exhaustive one-test-per-regex suite.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";

import { anchor, recordSlug } from "../../src/core/ids.ts";
import { safeText } from "../../src/core/text.ts";
import { assertSafeUrl } from "../../src/core/url.ts";
import { DOCUMENT_UNAVAILABLE_LABEL } from "../../src/core/reference-descriptor.ts";
import { VIEW_MODEL_VERSION, type PublicViewModel } from "../../src/core/view-model.ts";
import { ComponentDocsError } from "../../src/core/errors.ts";
import { checkBuiltReferences } from "../../src/scan/built-references.ts";

const RECORD_ID = "rec-fixture-one";
const SLUG = recordSlug(RECORD_ID);
const PACKAGE_ID = "pkg-fixture-one";
const IDENTITY_NAME = "FIX-ONE";
const DOCUMENT_UNAVAILABLE_REASON = "Only a distributor listing is available.";

function t(value: string) {
  return safeText(value, { field: "fixture" });
}

const ONE_RECORD_MODEL: PublicViewModel = {
  version: VIEW_MODEL_VERSION,
  provider: { id: t("fixture-provider"), contractVersion: 1 },
  corpus: {
    ownerBundles: 1,
    records: 1,
    standaloneRecords: 1,
    subordinateRecords: 0,
    sources: 0,
    facts: 0,
    coverageDomains: 0,
    interactions: 0,
    pinMaps: 0,
    pins: 0,
    inventoryLines: 1,
    fittedLines: 1,
    dnpOrHandFitLines: 0,
  },
  records: [
    {
      identity: {
        recordId: t(RECORD_ID),
        slug: SLUG,
        anchor: anchor(RECORD_ID),
        kind: "standalone",
        parentRecordId: null,
        parentSlug: null,
        lineId: t("line-fixture-one"),
        ownerSkill: t("component-fixture-one"),
        mpn: t(IDENTITY_NAME),
        manufacturer: t("Fixture Semiconductor"),
        lcsc: t("C000001"),
        packageName: t("SOT-23"),
        function: t("fixture part"),
        identityState: t("VERIFIED"),
        sourceState: t("AVAILABLE"),
        dnp: false,
        placements: [{ board: t("board-l"), refdes: t("U1"), dnp: false }],
      },
      aliases: { mpn: [], lcsc: [], manufacturer: [], function: [] },
      sources: [],
      facts: [],
      coverage: [],
      interactions: [],
      pinMaps: [],
      reference: {
        documentUnavailableReason: null,
        document: {
          sourceId: t("src-fixture-one"),
          documentTitle: t("Fixture datasheet"),
          label: t("Datasheet PDF"),
          authorityClass: t("MANUFACTURER_PRIMARY"),
          url: assertSafeUrl("https://example.invalid/reference.pdf", "fixture"),
          availability: t("AVAILABLE"),
          documentKind: "datasheet",
        },
        mounting: "pcb",
        footprint: {
          packageId: t(PACKAGE_ID),
          footprintName: t(PACKAGE_ID),
          footprintPath: t(`footprints/${PACKAGE_ID}.kicad_mod`),
          modelPath: t(`models/${PACKAGE_ID}.wrl`),
          offset: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
    },
  ],
  packagePreviews: [
    {
      packageId: t(PACKAGE_ID),
      footprintName: t(PACKAGE_ID),
      footprintPath: t(`footprints/${PACKAGE_ID}.kicad_mod`),
      modelPath: t(`models/${PACKAGE_ID}.wrl`),
      offset: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      recordIds: [t(RECORD_ID)],
    },
  ],
  integration: [],
};

const ZERO_RECORD_MODEL: PublicViewModel = {
  ...ONE_RECORD_MODEL,
  corpus: { ...ONE_RECORD_MODEL.corpus, records: 0, standaloneRecords: 0, inventoryLines: 0, fittedLines: 0 },
  records: [],
  packagePreviews: [],
};

function unavailableDocumentModel(hasModel = true): PublicViewModel {
  const record = ONE_RECORD_MODEL.records[0];
  const packagePreview = ONE_RECORD_MODEL.packagePreviews[0];
  assert.ok(record);
  assert.ok(packagePreview);
  const footprint = record.reference.footprint;
  assert.ok(footprint);
  const selectedFootprint = hasModel
    ? footprint
    : { ...footprint, modelPath: null, offset: null, rotation: null, scale: null };
  return {
    ...ONE_RECORD_MODEL,
    records: [
      {
        ...record,
        reference: {
          ...record.reference,
          document: null,
          documentUnavailableReason: t(DOCUMENT_UNAVAILABLE_REASON),
          footprint: selectedFootprint,
        },
      },
    ],
    packagePreviews: hasModel ? ONE_RECORD_MODEL.packagePreviews : [{ ...packagePreview, ...selectedFootprint }],
  };
}

function unavailableDocumentParts(reason = DOCUMENT_UNAVAILABLE_REASON): Partial<Parts> {
  return {
    label: `<p class="zcd-component-references__document-label">${DOCUMENT_UNAVAILABLE_LABEL}</p>`,
    document: `<p class="zcd-component-references__document-title" data-document-unavailable="true">${reason}</p>`,
  };
}

type Parts = {
  readonly label: string;
  readonly document: string;
  readonly footprintImg: string;
  readonly openSvgLink: string;
  readonly modelDiv: string;
  readonly enlargeButtons: string;
  readonly dialogs: string;
  readonly staticExplanation: string;
  readonly evidenceTableMarker: string;
  readonly sourcesMarker: string;
};

function defaultParts(): Parts {
  return {
    label: `<p class="zcd-component-references__document-label">Datasheet PDF</p>`,
    document: `<p class="zcd-component-references__document-title"><a href="https://example.invalid/reference.pdf">Fixture datasheet</a></p>`,
    footprintImg: `<img alt="Footprint preview for ${IDENTITY_NAME}" src="/assets/component-previews/footprints/${PACKAGE_ID}.svg" data-footprint-preview-state="no-js" data-zfb-island="FootprintPreviewIsland">`,
    openSvgLink: `<a href="/assets/component-previews/footprints/${PACKAGE_ID}.svg">Open SVG</a>`,
    modelDiv: `<div data-model-url="/assets/component-previews/models/${PACKAGE_ID}.wrl" data-viewer-state="no-js" data-model-viewer-instance="inline" data-zfb-island="PackageModelViewerIsland"></div>`,
    enlargeButtons:
      `<button data-component-preview-enlarge="footprint" aria-label="Enlarge footprint preview"></button>` +
      `<button data-component-preview-enlarge="model" aria-label="Enlarge 3D preview"></button>`,
    dialogs:
      `<dialog data-component-preview-dialog="footprint" aria-label="Footprint preview for ${IDENTITY_NAME}"></dialog>` +
      `<dialog data-component-preview-dialog="model" aria-label="Interactive 3D view of ${IDENTITY_NAME}"></dialog>`,
    staticExplanation: `<p>Interactive inspection requires JavaScript and WebGL. The package identity remains available in this page.</p>`,
    evidenceTableMarker: `<div class="zcd-evidence-table">facts</div>`,
    sourcesMarker: `<div id="sources">Sources</div>`,
  };
}

function assembleHtml(overrides: Partial<Parts> = {}): string {
  const parts = { ...defaultParts(), ...overrides };
  return [
    "<!doctype html><html><body>",
    `<section class="zcd-component-references">`,
    parts.label,
    parts.document,
    parts.footprintImg,
    parts.openSvgLink,
    parts.modelDiv,
    parts.enlargeButtons,
    parts.dialogs,
    parts.staticExplanation,
    "</section>",
    parts.evidenceTableMarker,
    parts.sourcesMarker,
    "</body></html>",
  ].join("\n");
}

let scratch = "";

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "circuit-doc-built-refs-"));
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

type ScaffoldOptions = {
  readonly recordHtml?: string;
  readonly manifestPackages?: readonly { assetPath: string }[];
  readonly skipModelAsset?: boolean;
  readonly extraPreviewFile?: { readonly path: string; readonly content: string };
  readonly catalogHtml?: string;
};

async function scaffoldDist(name: string, options: ScaffoldOptions = {}): Promise<string> {
  const distRoot = join(scratch, name);
  const recordDir = join(distRoot, "docs/components/records", SLUG);
  await mkdir(recordDir, { recursive: true });
  await writeFile(join(recordDir, "index.html"), options.recordHtml ?? assembleHtml());

  await mkdir(join(distRoot, "docs/components/catalog"), { recursive: true });
  await writeFile(
    join(distRoot, "docs/components/catalog/index.html"),
    options.catalogHtml ?? "<html><body>Catalog: no live preview UI here</body></html>",
  );

  await mkdir(join(distRoot, "assets/component-previews/footprints"), { recursive: true });
  await mkdir(join(distRoot, "assets/component-previews/models"), { recursive: true });
  await writeFile(
    join(distRoot, "assets/component-previews/footprints/manifest.json"),
    JSON.stringify({
      packages: options.manifestPackages ?? [
        { assetPath: `/assets/component-previews/footprints/${PACKAGE_ID}.svg` },
      ],
    }),
  );
  await writeFile(join(distRoot, "assets/component-previews/footprints", `${PACKAGE_ID}.svg`), "<svg/>");
  if (!options.skipModelAsset) {
    await writeFile(join(distRoot, "assets/component-previews/models", `${PACKAGE_ID}.wrl`), "#VRML V2.0 utf8");
  }
  if (options.extraPreviewFile) {
    const target = join(distRoot, "assets/component-previews", options.extraPreviewFile.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, options.extraPreviewFile.content);
  }
  return distRoot;
}

function rejectsWith(promise: Promise<unknown>, code: string, messagePattern?: RegExp): Promise<void> {
  return assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ComponentDocsError, `expected a ComponentDocsError, got ${String(error)}`);
    assert.equal(error.code, code);
    if (messagePattern !== undefined) assert.match(error.message, messagePattern);
    return true;
  });
}

describe("a correctly built 1-record dist tree passes", () => {
  it("reports the record, footprint and model counts", async () => {
    const distRoot = await scaffoldDist("happy");
    const report = await checkBuiltReferences({ distRoot, model: ONE_RECORD_MODEL });
    assert.deepEqual(report, { records: 1, footprints: 1, models: 1 });
  });
});

describe("records with an unavailable document are checked against their reason", () => {
  it("accepts an unavailable document alongside a selected model", async () => {
    const distRoot = await scaffoldDist("unavailable-document-model", {
      recordHtml: assembleHtml(unavailableDocumentParts()),
    });
    const report = await checkBuiltReferences({ distRoot, model: unavailableDocumentModel() });
    assert.deepEqual(report, { records: 1, footprints: 1, models: 1 });
  });

  it("accepts an unavailable document alongside a footprint-only package", async () => {
    const distRoot = await scaffoldDist("unavailable-document-footprint-only", {
      recordHtml: assembleHtml({
        ...unavailableDocumentParts(),
        modelDiv: `<p data-model-unavailable="true">No 3D model is declared by this footprint; geometry and physical fit remain unverified.</p>`,
        enlargeButtons: `<button data-component-preview-enlarge="footprint" aria-label="Enlarge footprint preview"></button>`,
        dialogs: `<dialog data-component-preview-dialog="footprint" aria-label="Footprint preview for ${IDENTITY_NAME}"></dialog>`,
      }),
      skipModelAsset: true,
    });
    const report = await checkBuiltReferences({ distRoot, model: unavailableDocumentModel(false) });
    assert.deepEqual(report, { records: 1, footprints: 1, models: 0 });
  });

  it("rejects a missing reason", async () => {
    const distRoot = await scaffoldDist("unavailable-document-missing-reason", {
      recordHtml: assembleHtml({ ...unavailableDocumentParts(), document: `<p class="zcd-component-references__document-title" data-document-unavailable="true"></p>` }),
    });
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: unavailableDocumentModel() }),
      "PUBLICATION_POLICY",
      /expected unavailable-document label and reason/u,
    );
  });

  it("rejects a reason that differs from the projected record", async () => {
    const distRoot = await scaffoldDist("unavailable-document-wrong-reason", {
      recordHtml: assembleHtml(unavailableDocumentParts("A different reviewed reason.")),
    });
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: unavailableDocumentModel() }),
      "PUBLICATION_POLICY",
      /expected unavailable-document label and reason/u,
    );
  });

  it("rejects an invented link in the unavailable document row", async () => {
    const distRoot = await scaffoldDist("unavailable-document-invented-link", {
      recordHtml: assembleHtml({
        ...unavailableDocumentParts(),
        document: `<p class="zcd-component-references__document-title" data-document-unavailable="true"><a href="https://example.invalid/invented.pdf">${DOCUMENT_UNAVAILABLE_REASON}</a></p>`,
      }),
    });
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: unavailableDocumentModel() }),
      "PUBLICATION_POLICY",
      /must not link a document/u,
    );
  });

  it("rejects the unavailable label when a selected document URL is present", async () => {
    const distRoot = await scaffoldDist("unavailable-label-with-url", {
      recordHtml: assembleHtml({
        label: `<p class="zcd-component-references__document-label">${DOCUMENT_UNAVAILABLE_LABEL}</p>`,
      }),
    });
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: ONE_RECORD_MODEL }),
      "PUBLICATION_POLICY",
      /unreviewed document label/u,
    );
  });
});

describe("each structural removal fails", () => {
  it("fails when the Component references section is missing entirely", async () => {
    const distRoot = await scaffoldDist("no-section", { recordHtml: "<html><body>nothing here</body></html>" });
    await rejectsWith(checkBuiltReferences({ distRoot, model: ONE_RECORD_MODEL }), "PUBLICATION_POLICY", /exactly one/u);
  });

  it("fails on an unreviewed document label", async () => {
    const distRoot = await scaffoldDist("bad-label", {
      recordHtml: assembleHtml({ label: `<p class="zcd-component-references__document-label">Random PDF</p>` }),
    });
    await rejectsWith(checkBuiltReferences({ distRoot, model: ONE_RECORD_MODEL }), "PUBLICATION_POLICY", /unreviewed document label/u);
  });

  it("fails when the direct no-JS SVG link is dropped", async () => {
    const distRoot = await scaffoldDist("no-open-svg", { recordHtml: assembleHtml({ openSvgLink: "" }) });
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: ONE_RECORD_MODEL }),
      "PUBLICATION_POLICY",
      /direct footprint link/u,
    );
  });

  it("fails when the footprint enhancement does not start inert", async () => {
    const distRoot = await scaffoldDist("not-inert", {
      recordHtml: assembleHtml({
        footprintImg: `<img alt="Footprint preview for ${IDENTITY_NAME}" src="/assets/component-previews/footprints/${PACKAGE_ID}.svg" data-footprint-preview-state="hydrated" data-zfb-island="FootprintPreviewIsland">`,
      }),
    });
    await rejectsWith(checkBuiltReferences({ distRoot, model: ONE_RECORD_MODEL }), "PUBLICATION_POLICY", /start inert/u);
  });

  it("fails when the footprint island is not registered", async () => {
    const distRoot = await scaffoldDist("no-footprint-island", {
      recordHtml: assembleHtml({
        footprintImg: `<img alt="Footprint preview for ${IDENTITY_NAME}" src="/assets/component-previews/footprints/${PACKAGE_ID}.svg" data-footprint-preview-state="no-js">`,
      }),
    });
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: ONE_RECORD_MODEL }),
      "PUBLICATION_POLICY",
      /register the footprint island/u,
    );
  });

  it("fails when the model reference uses an unsafe (non-.wrl) src", async () => {
    const distRoot = await scaffoldDist("unsafe-model-src", {
      recordHtml: assembleHtml({
        modelDiv: `<div data-model-url="/assets/component-previews/models/${PACKAGE_ID}.glb" data-viewer-state="no-js" data-model-viewer-instance="inline" data-zfb-island="PackageModelViewerIsland"></div>`,
      }),
    });
    await rejectsWith(checkBuiltReferences({ distRoot, model: ONE_RECORD_MODEL }), "PATH_CONTAINMENT", /unsafe src/u);
  });

  it("fails when only one enlarge control is rendered", async () => {
    const distRoot = await scaffoldDist("one-enlarge", {
      recordHtml: assembleHtml({
        enlargeButtons: `<button data-component-preview-enlarge="footprint" aria-label="Enlarge footprint preview"></button>`,
      }),
    });
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: ONE_RECORD_MODEL }),
      "PUBLICATION_POLICY",
      /footprint and model enlarge controls/u,
    );
  });

  it("fails when a dialog refers to a visible title via aria-labelledby", async () => {
    const distRoot = await scaffoldDist("dialog-labelledby", {
      recordHtml: assembleHtml({
        dialogs:
          `<dialog data-component-preview-dialog="footprint" aria-label="Footprint preview for ${IDENTITY_NAME}" aria-labelledby="x"></dialog>` +
          `<dialog data-component-preview-dialog="model" aria-label="Interactive 3D view of ${IDENTITY_NAME}"></dialog>`,
      }),
    });
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: ONE_RECORD_MODEL }),
      "PUBLICATION_POLICY",
      /must not refer to a visible title/u,
    );
  });

  it("fails when the Sources section is dropped", async () => {
    const distRoot = await scaffoldDist("no-sources", { recordHtml: assembleHtml({ sourcesMarker: "" }) });
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: ONE_RECORD_MODEL }),
      "PUBLICATION_POLICY",
      /retain its Sources section/u,
    );
  });

  it("fails when Component references is rendered AFTER the evidence tables", async () => {
    const parts = defaultParts();
    const reordered = [
      "<!doctype html><html><body>",
      parts.evidenceTableMarker,
      `<section class="zcd-component-references">`,
      parts.label,
      parts.document,
      parts.footprintImg,
      parts.openSvgLink,
      parts.modelDiv,
      parts.enlargeButtons,
      parts.dialogs,
      parts.staticExplanation,
      "</section>",
      parts.sourcesMarker,
      "</body></html>",
    ].join("\n");
    const distRoot = await scaffoldDist("wrong-order", { recordHtml: reordered });
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: ONE_RECORD_MODEL }),
      "PUBLICATION_POLICY",
      /before evidence tables/u,
    );
  });
});

describe("manifest and preview-output checks", () => {
  it("fails when the manifest package count does not match the selection", async () => {
    const distRoot = await scaffoldDist("manifest-count-mismatch", {
      manifestPackages: [
        { assetPath: `/assets/component-previews/footprints/${PACKAGE_ID}.svg` },
        { assetPath: `/assets/component-previews/footprints/${PACKAGE_ID}-extra.svg` },
      ],
    });
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: ONE_RECORD_MODEL }),
      "PUBLICATION_POLICY",
      /expected number of packages/u,
    );
  });

  it("fails when the record page references an SVG the manifest does not select", async () => {
    const distRoot = await scaffoldDist("manifest-name-mismatch", {
      manifestPackages: [{ assetPath: `/assets/component-previews/footprints/some-other-package.svg` }],
    });
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: ONE_RECORD_MODEL }),
      "PUBLICATION_POLICY",
      /manifest-selected footprint SVGs/u,
    );
  });

  it("fails when a STEP file is present in the published preview output", async () => {
    // A STEP file is never part of the expected asset set (only SVG and WRL
    // are), so the extra/unselected-asset check is what actually catches it in
    // practice — the dedicated STEP assertion is a second, defense-in-depth
    // check that would fire on a hypothetical build that got the asset SET
    // right but still smuggled a STEP through.
    const distRoot = await scaffoldDist("step-leak", {
      extraPreviewFile: { path: `models/${PACKAGE_ID}.step`, content: "ISO-10303-21;" },
    });
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: ONE_RECORD_MODEL }),
      "PUBLICATION_POLICY",
      /missing, extra, or unselected assets/u,
    );
  });

  it("fails when the preview output contains an extra, unselected asset", async () => {
    const distRoot = await scaffoldDist("extra-asset", {
      extraPreviewFile: { path: "footprints/unselected-package.svg", content: "<svg/>" },
    });
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: ONE_RECORD_MODEL }),
      "PUBLICATION_POLICY",
      /missing, extra, or unselected assets/u,
    );
  });
});

describe("the catalog page must never create or reference live preview UI", () => {
  it("fails when the catalog page includes a model-viewer canvas", async () => {
    const distRoot = await scaffoldDist("catalog-has-canvas", {
      catalogHtml: `<html><body><canvas></canvas></body></html>`,
    });
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: ONE_RECORD_MODEL }),
      "PUBLICATION_POLICY",
      /must not create or reference live preview UI/u,
    );
  });
});

describe("zero records is a valid state", () => {
  it("passes with an absent records directory, and still checks the catalog", async () => {
    const distRoot = join(scratch, "zero-records");
    await mkdir(join(distRoot, "docs/components/catalog"), { recursive: true });
    await writeFile(join(distRoot, "docs/components/catalog/index.html"), "<html><body>Catalog</body></html>");
    // No records/ directory and no preview root at all: valid at zero packages.
    const report = await checkBuiltReferences({ distRoot, model: ZERO_RECORD_MODEL });
    assert.deepEqual(report, { records: 0, footprints: 0, models: 0 });
  });

  it("still fails the catalog check at zero records", async () => {
    const distRoot = join(scratch, "zero-records-bad-catalog");
    await mkdir(join(distRoot, "docs/components/catalog"), { recursive: true });
    await writeFile(join(distRoot, "docs/components/catalog/index.html"), `<html><body><canvas></canvas></body></html>`);
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: ZERO_RECORD_MODEL }),
      "PUBLICATION_POLICY",
      /must not create or reference live preview UI/u,
    );
  });
});

describe("a record without a published package (external, or CAD off with expect.packages 0)", () => {
  function packagelessModel(mounting: "pcb" | "external"): PublicViewModel {
    const [record] = ONE_RECORD_MODEL.records;
    assert.ok(record);
    return {
      ...ONE_RECORD_MODEL,
      records: [{ ...record, reference: { ...record.reference, mounting, footprint: null } }],
      packagePreviews: [],
    };
  }

  function packagelessUnavailableModel(): PublicViewModel {
    const model = packagelessModel("pcb");
    const record = model.records[0];
    assert.ok(record);
    return {
      ...model,
      records: [
        {
          ...record,
          reference: {
            ...record.reference,
            document: null,
            documentUnavailableReason: t(DOCUMENT_UNAVAILABLE_REASON),
          },
        },
      ],
    };
  }

  const PCB_TEXT = "No footprint or 3D model is published for this record: CAD is not enabled for this project.";

  function packagelessHtml(statement: string, extra = ""): string {
    return [
      "<!doctype html><html><body>",
      `<a class="x" href=https://example.invalid/reference.pdf>Datasheet PDF</a>`,
      `<p>${statement}</p>`,
      extra,
      `<div class="zcd-evidence-table">facts</div>`,
      "</body></html>",
    ].join("\n");
  }

  async function scaffoldPackageless(name: string, recordHtml: string): Promise<string> {
    const distRoot = join(scratch, name);
    const recordDir = join(distRoot, "docs/components/records", SLUG);
    await mkdir(recordDir, { recursive: true });
    await writeFile(join(recordDir, "index.html"), recordHtml);
    await mkdir(join(distRoot, "docs/components/catalog"), { recursive: true });
    await writeFile(join(distRoot, "docs/components/catalog/index.html"), "<html><body>Catalog</body></html>");
    return distRoot;
  }

  it("passes a PCB record that states CAD is not enabled and links its document", async () => {
    const distRoot = await scaffoldPackageless("packageless-pcb", packagelessHtml(PCB_TEXT));
    const report = await checkBuiltReferences({ distRoot, model: packagelessModel("pcb") });
    assert.deepEqual(report, { records: 1, footprints: 0, models: 0 });
  });

  it("passes a packageless PCB record with the unavailable-document reason and no document link", async () => {
    const distRoot = await scaffoldPackageless(
      "packageless-unavailable-document",
      [
        "<html><body>",
        `<p><strong>Selected document:</strong> ${DOCUMENT_UNAVAILABLE_LABEL}</p>`,
        `<p><strong>Reason:</strong> ${DOCUMENT_UNAVAILABLE_REASON}</p>`,
        `<p>${PCB_TEXT}</p>`,
        "</body></html>",
      ].join(""),
    );
    const report = await checkBuiltReferences({ distRoot, model: packagelessUnavailableModel() });
    assert.deepEqual(report, { records: 1, footprints: 0, models: 0 });
  });

  it("rejects a packageless unavailable document with an invented link", async () => {
    const distRoot = await scaffoldPackageless(
      "packageless-unavailable-document-link",
      [
        "<html><body>",
        `<p><strong>Selected document:</strong> <a href="https://example.invalid/invented.pdf">${DOCUMENT_UNAVAILABLE_LABEL}</a></p>`,
        `<p><strong>Reason:</strong> ${DOCUMENT_UNAVAILABLE_REASON}</p>`,
        `<p>${PCB_TEXT}</p>`,
        "</body></html>",
      ].join(""),
    );
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: packagelessUnavailableModel() }),
      "PUBLICATION_POLICY",
      /without linking a document/u,
    );
  });

  it("rejects a packageless unavailable document without its expected reason", async () => {
    const distRoot = await scaffoldPackageless(
      "packageless-unavailable-document-missing-reason",
      `<html><body><p>Selected document: ${DOCUMENT_UNAVAILABLE_LABEL}</p><p>${PCB_TEXT}</p></body></html>`,
    );
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: packagelessUnavailableModel() }),
      "PUBLICATION_POLICY",
      /expected document-unavailability reason/u,
    );
  });

  it("fails a PCB record that uses the external-part wording instead", async () => {
    const distRoot = await scaffoldPackageless(
      "packageless-pcb-wrong-text",
      packagelessHtml("External panel-mounted component, hand-wired to the PCB. No PCB footprint or package model applies. Consult the manufacturer drawing for panel cutout and terminal orientation."),
    );
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: packagelessModel("pcb") }),
      "PUBLICATION_POLICY",
      /must state why no footprint or 3D model is published/u,
    );
  });

  it("fails when the selected document link is missing", async () => {
    const distRoot = await scaffoldPackageless(
      "packageless-no-link",
      `<html><body><p>${PCB_TEXT}</p></body></html>`,
    );
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: packagelessModel("pcb") }),
      "PUBLICATION_POLICY",
      /must link its selected document/u,
    );
  });

  it("fails when a preview asset is referenced anyway", async () => {
    const distRoot = await scaffoldPackageless(
      "packageless-asset",
      packagelessHtml(PCB_TEXT, `<img src="/assets/component-previews/footprints/${PACKAGE_ID}.svg">`),
    );
    await rejectsWith(
      checkBuiltReferences({ distRoot, model: packagelessModel("pcb") }),
      "PUBLICATION_POLICY",
      /references a preview asset/u,
    );
  });
});
