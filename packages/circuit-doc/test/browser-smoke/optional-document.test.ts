import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { deriveRepresentatives } from "../../src/browser-smoke/derive-representatives.ts";
import { inspectReferencePage } from "../../src/browser-smoke/checks/reference-page.ts";
import type { CdpClient } from "../../src/browser-smoke/cdp.ts";
import {
  createComponentReferencesDescriptor,
  DOCUMENT_UNAVAILABLE_LABEL,
  encodeComponentReferencesDescriptor,
} from "../../src/core/reference-descriptor.ts";
import { writePreflight, writeRecordPage } from "./derived-fixture.ts";

const DOCUMENT_REASON = "Only a distributor listing is available.";
const NO_MODEL_NOTICE = "No 3D model is declared by this footprint; geometry and physical fit remain unverified.";
const representative = { kind: "unavailable document", path: "/unavailable/", slug: "unavailable", identity: "UNAVAILABLE" };

test("default derivation includes an unavailable-document descriptor without an authority field", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "unavailable-document-derive-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = {
    preflightFile: join(root, "preflight.json"),
    generatedRoot: join(root, "generated"),
    distRoot: join(root, "unbuilt"),
  };
  await writePreflight(paths.preflightFile, ["unavailable"]);
  const descriptor = encodeComponentReferencesDescriptor(
    createComponentReferencesDescriptor({
      document: { label: DOCUMENT_UNAVAILABLE_LABEL, reason: DOCUMENT_REASON },
      footprintName: "PART",
      model: null,
    }),
  );
  await writeRecordPage(paths.generatedRoot, "unavailable", { identity: "UNAVAILABLE", descriptor });

  const result = await deriveRepresentatives(paths);
  assert.equal(result.outcome, "derived");
  if (result.outcome === "derived") assert.equal(result.representatives[0]?.slug, "unavailable");
});

test("model inspection accepts a visible unavailable-document reason and no document link", async () => {
  const report = modelReport();
  assert.deepEqual(await inspectReferencePage(mockCdp({ report }), representative, 390, "dark", false), {
    themeSignature: "dark|white|black|white|white",
  });

  report.documentReason = "";
  await assert.rejects(inspectReferencePage(mockCdp({ report }), representative, 390, "dark", false), /unavailable document reason/u);
  report.documentReason = DOCUMENT_REASON;
  report.documentLinkCount = 1;
  await assert.rejects(inspectReferencePage(mockCdp({ report }), representative, 390, "dark", false), /unavailable document has no link/u);
});

test("footprint-only inspection accepts unavailable documents and rejects hidden reasons or links", async () => {
  const report = footprintOnlyReport();
  assert.deepEqual(await inspectReferencePage(mockCdp({ report, modelUnavailable: true }), representative, 390, "dark", false), {
    themeSignature: "dark|white|black|white",
  });

  report.documentReasonVisible = false;
  await assert.rejects(
    inspectReferencePage(mockCdp({ report, modelUnavailable: true }), representative, 390, "dark", false),
    /unavailable document reason visible/u,
  );
  report.documentReasonVisible = true;
  report.documentLinkCount = 1;
  await assert.rejects(
    inspectReferencePage(mockCdp({ report, modelUnavailable: true }), representative, 390, "dark", false),
    /unavailable document has no link/u,
  );
});

type BrowserReport = Record<string, unknown>;

function mockCdp(options: {
  readonly report: BrowserReport;
  readonly modelUnavailable?: boolean;
}): CdpClient {
  return {
    close() {},
    async send(method, params) {
      assert.equal(method, "Runtime.evaluate");
      const expression = String(params?.expression);
      if (expression === `document.querySelector('[data-model-unavailable="true"]') !== null`) {
        return { result: { value: options.modelUnavailable ?? false } };
      }
      if (expression.includes("noticeVisible:")) return { result: { value: options.report } };
      if (expression.includes("modelUrl: modelRoot?.dataset.modelUrl")) return { result: { value: options.report } };
      if (expression.includes("canvases: document.querySelectorAll")) {
        return { result: { value: { canvases: 1, ready: true, modelResources: ["/assets/component-previews/models/PART.wrl"] } } };
      }
      if (expression.includes("document.querySelectorAll('[data-component-model-viewer-root]').length")) {
        return { result: { value: 1 } };
      }
      if (expression.includes("document.querySelectorAll('[data-model-viewer-viewport] canvas').length")) {
        return { result: { value: 1 } };
      }
      return { result: { value: true } };
    },
  };
}

function modelReport(): BrowserReport {
  const rect = (left: number, top: number, width: number, height: number) => ({
    left,
    right: left + width,
    top,
    bottom: top + height,
    width,
    height,
  });
  return {
    viewport: { inner: 390, client: 390, scroll: 390 },
    stackedLayoutThreshold: 600,
    sectionRect: rect(0, 0, 300, 400),
    documentRect: rect(0, 0, 300, 90),
    documentDetailsRect: rect(0, 0, 300, 40),
    metadataRect: null,
    previewsRect: rect(0, 100, 300, 300),
    stageRects: [rect(0, 110, 300, 80), rect(0, 200, 300, 80)],
    footprintRect: rect(10, 120, 280, 60),
    imageRect: rect(10, 120, 280, 60),
    modelRect: rect(10, 210, 280, 60),
    captionRect: null,
    captionOverflows: null,
    footprintTrigger: { rect: rect(230, 130, 50, 44), display: "inline-flex", label: "Enlarge footprint preview for PART" },
    modelTrigger: { rect: rect(230, 220, 50, 44), display: "inline-flex", label: "Enlarge 3D preview for PART" },
    dialogs: [
      { kind: "footprint", open: false, accessibleName: "Footprint preview for PART", hasVisibleTitleReference: false },
      { kind: "model", open: false, accessibleName: "Interactive 3D view of PART", hasVisibleTitleReference: false },
    ],
    documentLabel: DOCUMENT_UNAVAILABLE_LABEL,
    documentHref: undefined,
    documentUnavailable: true,
    documentReason: DOCUMENT_REASON,
    documentReasonVisible: true,
    documentLinkCount: 0,
    authority: undefined,
    availability: undefined,
    footprintObjectFit: "contain",
    footprintNatural: [100, 100],
    modelUrl: "/assets/component-previews/models/PART.wrl",
    viewerRoots: 1,
    statusVisible: true,
    surfaceColorsDistinct: true,
    themeSignature: "dark|white|black|white|white",
    sectionBeforeEvidence: true,
    sourcesPresent: true,
    theme: "dark",
    referenceHeadingId: "documents",
  };
}

function footprintOnlyReport(): BrowserReport {
  return {
    width: 390,
    overflow: false,
    notice: NO_MODEL_NOTICE,
    noticeVisible: true,
    models: 0,
    footprintLoaded: true,
    label: DOCUMENT_UNAVAILABLE_LABEL,
    href: undefined,
    documentUnavailable: true,
    documentReason: DOCUMENT_REASON,
    documentReasonVisible: true,
    documentLinkCount: 0,
    authority: undefined,
    theme: "dark",
    headingId: "documents",
    themeSignature: "dark|white|black|white",
  };
}
