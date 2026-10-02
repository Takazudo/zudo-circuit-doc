/**
 * Per-representative, per-viewport/theme inspection: paired footprint/model
 * previews, dialog shells, layout containment. Ported from the pinned LED
 * `inspectReferencePage`/`inspectNativeShell` (`zld-` -> `zcd-` rename only).
 *
 * The native-shell (zudo-doc DOM/breakpoint) assertions stay behind
 * `shellAssertions` (spec item 3): they are coupled to the zudo-doc version,
 * not to this package's own markup.
 */

import { assertContained, assertEqual, type Rect } from "../assertions.ts";
import { evaluate, waitFor, type CdpClient } from "../cdp.ts";
import type { Representative } from "../types.ts";
import { revealReadyViewer } from "./interactions.ts";

const ALLOWED_PDF_LABELS = ["Datasheet PDF", "Specification PDF", "Mechanical drawing PDF"];

export type ReferencePageReport = { readonly themeSignature: string };

export async function inspectReferencePage(
  cdp: CdpClient,
  representative: Representative,
  width: number,
  theme: "light" | "dark",
  shellAssertions: boolean,
): Promise<ReferencePageReport> {
  await waitFor(cdp, `document.querySelector('.zcd-component-references') !== null`);
  await evaluate(cdp, `document.querySelector('.zcd-component-references').scrollIntoView({ block: 'start' })`);
  await waitFor(
    cdp,
    `document.querySelector('.zcd-component-references__footprint img')?.complete && document.querySelector('.zcd-component-references__footprint img')?.naturalWidth > 0`,
  );
  await revealReadyViewer(cdp);
  const report = (await evaluate(
    cdp,
    `(() => {
      const section = document.querySelector('.zcd-component-references');
      const documentRow = section.querySelector('.zcd-component-references__document');
      const documentDetails = documentRow?.firstElementChild;
      const metadataList = documentRow?.querySelector('.zcd-component-references__metadata');
      const previews = section.querySelector('.zcd-component-references__previews');
      const stages = [...(previews?.querySelectorAll('.zcd-component-references__preview') ?? [])];
      const footprintLink = section.querySelector('.zcd-component-references__footprint-frame > a');
      const footprintImage = footprintLink.querySelector('img');
      const modelViewport = section.querySelector('[data-model-viewer-viewport]');
      const caption = section.querySelector('.zcd-model-viewer__caption');
      const modelRoot = section.querySelector('[data-component-model-viewer-root]');
      const footprintTrigger = section.querySelector('[data-component-preview-enlarge="footprint"]');
      const modelTrigger = section.querySelector('[data-component-preview-enlarge="model"]');
      const documentLink = section.querySelector('.zcd-component-references__document-title a');
      const label = section.querySelector('.zcd-component-references__document-label');
      const metadata = [...(metadataList?.querySelectorAll(':scope > div') ?? [])];
      const authority = metadata.find((row) => row.querySelector('dt')?.textContent.trim() === 'Authority')?.querySelector('dd')?.textContent.trim();
      const availability = metadata.find((row) => row.querySelector('dt')?.textContent.trim() === 'Availability')?.querySelector('dd')?.textContent.trim();
      const evidence = document.querySelector('.zcd-evidence-fact');
      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
      };
      const sectionRect = rect(section);
      const documentRect = rect(documentRow);
      const documentDetailsRect = rect(documentDetails);
      const metadataRect = rect(metadataList);
      const previewsRect = rect(previews);
      const stageRects = stages.map(rect);
      const footprintRect = rect(footprintLink);
      const imageRect = rect(footprintImage);
      const modelRect = rect(modelViewport);
      const documentStyle = getComputedStyle(documentRow);
      const stageStyle = getComputedStyle(stages[0]);
      const status = section.querySelector('[data-model-viewer-status]');
      const statusStyle = getComputedStyle(status);
      return {
        viewport: { inner: innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth },
        stackedLayoutThreshold: Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 38,
        sectionRect,
        documentRect,
        documentDetailsRect,
        metadataRect,
        previewsRect,
        stageRects,
        footprintRect,
        imageRect,
        modelRect,
        captionRect: caption === null ? null : rect(caption),
        captionOverflows: caption === null ? null : caption.scrollWidth > caption.clientWidth + 1,
        footprintTrigger: {
          rect: rect(footprintTrigger),
          display: getComputedStyle(footprintTrigger).display,
          label: footprintTrigger.getAttribute('aria-label'),
        },
        modelTrigger: {
          rect: rect(modelTrigger),
          display: getComputedStyle(modelTrigger).display,
          label: modelTrigger.getAttribute('aria-label'),
        },
        dialogs: [...section.querySelectorAll('[data-component-preview-dialog]')].map((dialog) => ({
          kind: dialog.dataset.componentPreviewDialog,
          open: dialog.open,
          accessibleName: dialog.getAttribute('aria-label'),
          hasVisibleTitleReference: dialog.hasAttribute('aria-labelledby'),
        })),
        documentLabel: label?.textContent.trim(),
        documentHref: documentLink?.href,
        authority,
        availability,
        footprintObjectFit: getComputedStyle(footprintImage).objectFit,
        footprintNatural: [footprintImage.naturalWidth, footprintImage.naturalHeight],
        modelUrl: modelRoot?.dataset.modelUrl,
        viewerRoots: section.querySelectorAll('[data-component-model-viewer-root]').length,
        statusVisible: statusStyle.display !== 'none' && statusStyle.visibility !== 'hidden' && Number(statusStyle.opacity) > 0,
        surfaceColorsDistinct: documentStyle.color !== documentStyle.backgroundColor && stageStyle.color !== stageStyle.backgroundColor,
        themeSignature: [getComputedStyle(document.body).color, getComputedStyle(document.body).backgroundColor, documentStyle.color, documentStyle.backgroundColor, stageStyle.backgroundColor].join('|'),
        sectionBeforeEvidence: evidence !== null && Boolean(section.compareDocumentPosition(evidence) & Node.DOCUMENT_POSITION_FOLLOWING),
        sourcesPresent: document.getElementById('sources') !== null,
        theme: document.documentElement.dataset.theme,
        referenceHeadingId: [...document.querySelectorAll('h2')].find((heading) => heading.textContent.trim() === 'Documents and package')?.id,
      };
    })()`,
  )) as {
    viewport: { inner: number; client: number; scroll: number };
    stackedLayoutThreshold: number;
    sectionRect: Rect;
    documentRect: Rect;
    documentDetailsRect: Rect;
    metadataRect: Rect;
    previewsRect: Rect;
    stageRects: readonly Rect[];
    footprintRect: Rect;
    imageRect: Rect;
    modelRect: Rect;
    captionRect: Rect | null;
    captionOverflows: boolean | null;
    footprintTrigger: { rect: Rect; display: string; label: string };
    modelTrigger: { rect: Rect; display: string; label: string };
    dialogs: ReadonlyArray<{ kind: string; open: boolean; accessibleName: string | null; hasVisibleTitleReference: boolean }>;
    documentLabel: string;
    documentHref: string;
    authority: string | undefined;
    availability: string | undefined;
    footprintObjectFit: string;
    footprintNatural: readonly [number, number];
    modelUrl: string | undefined;
    viewerRoots: number;
    statusVisible: boolean;
    surfaceColorsDistinct: boolean;
    themeSignature: string;
    sectionBeforeEvidence: boolean;
    sourcesPresent: boolean;
    theme: string;
    referenceHeadingId: string | undefined;
  };

  assertEqual(report.viewport.inner, width, `${representative.kind} ${width}/${theme} viewport width`);
  assertEqual(report.viewport.scroll <= report.viewport.client + 1, true, `${representative.kind} ${width}/${theme} page overflow`);
  assertEqual(ALLOWED_PDF_LABELS.includes(report.documentLabel), true, `${representative.kind} PDF label`);
  assertEqual(/^https?:\/\//u.test(report.documentHref), true, `${representative.kind} PDF destination`);
  assertEqual((report.authority?.length ?? 0) > 0, true, `${representative.kind} document authority retained`);
  if (representative.availability !== undefined) {
    assertEqual(report.availability, representative.availability, `${representative.kind} availability`);
  }
  assertEqual(report.footprintObjectFit, "contain", `${representative.kind} footprint containment mode`);
  assertEqual(report.footprintNatural.every((value) => value > 0), true, `${representative.kind} footprint loaded`);
  assertEqual(report.viewerRoots, 1, `${representative.kind} viewer root count`);
  assertEqual(report.modelUrl?.endsWith(".wrl") ?? false, true, `${representative.kind} selected WRL`);
  assertEqual(report.modelUrl?.toLowerCase().endsWith(".step") ?? false, false, `${representative.kind} no STEP URL`);
  assertEqual(report.footprintTrigger.display !== "none", true, `${representative.kind} footprint enlarge visible after hydration`);
  assertEqual(report.modelTrigger.display !== "none", true, `${representative.kind} model enlarge visible when ready`);
  assertEqual(report.footprintTrigger.label.startsWith("Enlarge footprint preview"), true, `${representative.kind} footprint enlarge label`);
  assertEqual(report.modelTrigger.label.startsWith("Enlarge 3D preview"), true, `${representative.kind} model enlarge label`);
  assertEqual(report.dialogs.length, 2, `${representative.kind} closed dialog shell count`);
  assertEqual(
    report.dialogs.every((dialog) => !dialog.open && (dialog.accessibleName?.length ?? 0) > 0 && !dialog.hasVisibleTitleReference),
    true,
    `${representative.kind} closed dialogs use media-specific aria-labels`,
  );
  assertEqual(report.statusVisible, true, `${representative.kind} visible status`);
  assertEqual(report.surfaceColorsDistinct, true, `${representative.kind} readable document and preview surfaces`);
  assertEqual(report.sectionBeforeEvidence, true, `${representative.kind} references before evidence`);
  assertEqual(report.sourcesPresent, true, `${representative.kind} Sources retained`);
  assertEqual(report.theme, theme, `${representative.kind} ${theme} theme retained`);
  assertEqual((report.referenceHeadingId?.length ?? 0) > 0, true, `${representative.kind} Documents and package is a native heading`);
  assertContained(report.documentRect, report.sectionRect, `${representative.kind} document row at ${width}/${theme}`);
  assertContained(report.metadataRect, report.documentRect, `${representative.kind} document metadata at ${width}/${theme}`);
  assertContained(report.previewsRect, report.sectionRect, `${representative.kind} paired preview stages at ${width}/${theme}`);
  assertEqual(report.stageRects.length, 2, `${representative.kind} has paired preview stages`);
  for (const [index, stage] of report.stageRects.entries()) {
    assertContained(stage, report.previewsRect, `${representative.kind} preview stage ${index + 1} at ${width}/${theme}`);
  }
  const contentWidth = report.sectionRect.width;
  const stackAtContentWidth = contentWidth <= report.stackedLayoutThreshold;
  const [footprintStage, modelStage] = report.stageRects;
  if (footprintStage === undefined || modelStage === undefined) {
    throw new Error(`${representative.kind} preview stage geometry is missing`);
  }
  if (stackAtContentWidth) {
    assertEqual(Math.abs(footprintStage.left - modelStage.left) <= 1, true, `${representative.kind} preview stages stack at ${width}/${theme}`);
    assertEqual(modelStage.top >= footprintStage.bottom - 1, true, `${representative.kind} stacked stage order at ${width}/${theme}`);
    assertEqual(Math.abs(footprintStage.width - modelStage.width) <= 1, true, `${representative.kind} stacked stages align at ${width}/${theme}`);
  } else {
    assertEqual(Math.abs(footprintStage.top - modelStage.top) <= 1, true, `${representative.kind} preview stages align at ${width}/${theme}`);
    assertEqual(Math.abs(footprintStage.height - modelStage.height) <= 2, true, `${representative.kind} paired stages have equal height at ${width}/${theme}`);
    assertEqual(modelStage.left > footprintStage.left, true, `${representative.kind} previews pair left-to-right at ${width}/${theme}`);
  }
  if (stackAtContentWidth) {
    assertEqual(Math.abs(report.documentDetailsRect.left - report.metadataRect.left) <= 1, true, `${representative.kind} document metadata stacks at ${width}/${theme}`);
    assertEqual(report.metadataRect.top >= report.documentDetailsRect.bottom - 1, true, `${representative.kind} stacked document metadata order at ${width}/${theme}`);
  } else {
    assertEqual(Math.abs(report.documentDetailsRect.top - report.metadataRect.top) <= 1, true, `${representative.kind} document metadata aligns in row at ${width}/${theme}`);
    assertEqual(report.metadataRect.left > report.documentDetailsRect.left, true, `${representative.kind} document metadata occupies second column at ${width}/${theme}`);
  }
  assertContained(report.footprintRect, footprintStage, `${representative.kind} footprint at ${width}/${theme}`);
  assertContained(report.imageRect, report.footprintRect, `${representative.kind} footprint image at ${width}/${theme}`);
  assertContained(report.modelRect, modelStage, `${representative.kind} model viewport at ${width}/${theme}`);
  if (report.captionRect !== null) {
    assertContained(report.captionRect, modelStage, `${representative.kind} model caption at ${width}/${theme}`);
    assertEqual(report.captionOverflows, false, `${representative.kind} model caption has no internal overflow at ${width}/${theme}`);
  }
  assertContained(report.footprintTrigger.rect, report.footprintRect, `${representative.kind} footprint enlarge at ${width}/${theme}`);
  assertContained(report.modelTrigger.rect, report.modelRect, `${representative.kind} model enlarge at ${width}/${theme}`);
  assertEqual(report.footprintTrigger.rect.width >= 44 && report.footprintTrigger.rect.height >= 44, true, `${representative.kind} footprint target size`);
  assertEqual(report.modelTrigger.rect.width >= 44 && report.modelTrigger.rect.height >= 44, true, `${representative.kind} model target size`);
  if (shellAssertions) await inspectNativeShell(cdp, representative, width, report.referenceHeadingId ?? "");

  const loaded = (await evaluate(
    cdp,
    `({
      canvases: document.querySelectorAll('[data-model-viewer-viewport] canvas').length,
      ready: document.querySelector('[data-model-viewer-status]')?.textContent.includes('ready'),
      modelResources: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('/assets/component-previews/models/'))
    })`,
  )) as { canvases: number; ready: boolean; modelResources: readonly string[] };
  assertEqual(loaded.canvases, 1, `${representative.kind} canvas after load`);
  assertEqual(loaded.ready, true, `${representative.kind} ready status`);
  assertEqual(loaded.modelResources.length >= 1, true, `${representative.kind} model requested`);
  assertEqual(loaded.modelResources.every((url) => url.endsWith(".wrl")), true, `${representative.kind} only WRL requested`);
  return { themeSignature: report.themeSignature };
}

async function inspectNativeShell(cdp: CdpClient, representative: Representative, width: number, headingId: string): Promise<void> {
  const shell = (await evaluate(
    cdp,
    `(() => {
      const visible = (element) => element !== null && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden';
      const heading = document.getElementById(${JSON.stringify(headingId)});
      const desktopToc = document.querySelector('nav[data-zd-toc]');
      const mobileToc = document.querySelector('[data-zd-mobile-toc]');
      const tocLinks = [...document.querySelectorAll('nav[data-zd-toc] a, [data-zd-mobile-toc] a')];
      return {
        header: visible(document.querySelector('header[data-header]')),
        main: document.querySelector('main') !== null,
        heading: heading?.tagName === 'H2' && heading.textContent.trim() === 'Documents and package',
        tocTarget: heading !== null && tocLinks.some((link) => link.getAttribute('href') === '#' + heading.id),
        desktopSidebarVisible: visible(document.querySelector('#desktop-sidebar')),
        desktopTocVisible: visible(desktopToc),
        mobileTocVisible: visible(mobileToc),
        mobileTocLabel: mobileToc?.querySelector('button')?.textContent.trim(),
        mobileSidebarToggleVisible: visible(document.querySelector('header button[aria-label="Open sidebar"]')),
      };
    })()`,
  )) as {
    header: boolean;
    main: boolean;
    heading: boolean;
    tocTarget: boolean;
    desktopSidebarVisible: boolean;
    desktopTocVisible: boolean;
    mobileTocVisible: boolean;
    mobileTocLabel: string | undefined;
    mobileSidebarToggleVisible: boolean;
  };
  assertEqual(shell.header, true, `${representative.kind} package header at ${width}px`);
  assertEqual(shell.main, true, `${representative.kind} native main at ${width}px`);
  assertEqual(shell.heading, true, `${representative.kind} heading target is native h2 at ${width}px`);
  assertEqual(shell.tocTarget, true, `${representative.kind} native TOC links to Documents and package at ${width}px`);
  assertEqual(shell.desktopSidebarVisible, width >= 1024, `${representative.kind} desktop sidebar breakpoint at ${width}px`);
  assertEqual(shell.desktopTocVisible, width >= 1280, `${representative.kind} desktop TOC breakpoint at ${width}px`);
  assertEqual(shell.mobileTocVisible, width < 1280, `${representative.kind} mobile On this page breakpoint at ${width}px`);

  if (width < 1280) {
    assertEqual(shell.mobileTocLabel?.includes("On this page") ?? false, true, `${representative.kind} mobile TOC label at ${width}px`);
    const mobileTocButton = "[data-zd-mobile-toc] button";
    await evaluate(cdp, `document.querySelector(${JSON.stringify(mobileTocButton)}).click()`);
    await waitFor(cdp, `document.querySelector('[data-zd-mobile-toc] button')?.getAttribute('aria-expanded') === 'true'`);
    await waitFor(cdp, `document.querySelector('[data-zd-mobile-toc] ul')?.getAttribute('aria-hidden') === 'false'`);
    await evaluate(cdp, `document.querySelector(${JSON.stringify(mobileTocButton)}).click()`);
    await waitFor(cdp, `document.querySelector('[data-zd-mobile-toc] button')?.getAttribute('aria-expanded') === 'false'`);
  }

  if (width < 1024) {
    assertEqual(shell.mobileSidebarToggleVisible, true, `${representative.kind} mobile sidebar control at ${width}px`);
    await evaluate(cdp, `document.querySelector('header button[aria-label="Open sidebar"]').click()`);
    await waitFor(cdp, `document.querySelector('header button[aria-label="Close sidebar"]')?.getAttribute('aria-expanded') === 'true'`);
    await waitFor(cdp, `document.querySelector('[data-zd-mobile-sidebar]')?.getBoundingClientRect().right > 1`);
    await evaluate(cdp, `document.querySelector('header button[aria-label="Close sidebar"]').click()`);
    await waitFor(cdp, `document.querySelector('header button[aria-label="Open sidebar"]')?.getAttribute('aria-expanded') === 'false'`);
  }
}
