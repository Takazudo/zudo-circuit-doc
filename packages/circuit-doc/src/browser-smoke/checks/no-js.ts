/**
 * No-JS fallback: with script execution disabled, static content (facts,
 * sources, document row, paired preview stages) is intact and every
 * interactive control is inert. Ported from the pinned LED script.
 */

import { assertEqual } from "../assertions.ts";
import { evaluate, navigate, waitFor, type CdpClient } from "../cdp.ts";
import { revealViewer } from "./interactions.ts";

export async function checkNoJsFallback(cdp: CdpClient, origin: string, path: string): Promise<void> {
  await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
  try {
    await navigate(cdp, origin, path);
    await revealViewer(cdp);
    assertEqual(await evaluate(cdp, `document.querySelector('[data-component-model-viewer-root]')?.dataset.viewerState`), "no-js", "no-JS state retained");
    assertEqual(await evaluate(cdp, `document.querySelectorAll('[data-model-viewer-viewport] canvas').length`), 0, "no canvas without JavaScript");
    assertEqual(
      await evaluate(cdp, `document.querySelector('[data-model-viewer-status]')?.textContent.includes('requires JavaScript and WebGL')`),
      true,
      "no-JS explanation retained",
    );
    await waitFor(
      cdp,
      `document.querySelector('.zcd-component-references__footprint img')?.complete && document.querySelector('.zcd-component-references__footprint img')?.naturalWidth > 0`,
    );
    const noJsPreviews = (await evaluate(
      cdp,
      `({
        controlsHidden: [...document.querySelectorAll('[data-component-preview-enlarge]')].every((control) => getComputedStyle(control).display === 'none'),
        dialogsClosed: [...document.querySelectorAll('[data-component-preview-dialog]')].every((dialog) => !dialog.open),
        footprintLink: document.querySelector('.zcd-component-references__footprint-frame > a')?.href.endsWith('.svg'),
        serverFacts: document.querySelectorAll('.zcd-evidence-fact').length,
        serverSources: document.getElementById('sources') !== null,
        documentRow: document.querySelector('.zcd-component-references__document') !== null,
        previewStages: document.querySelectorAll('.zcd-component-references__preview').length
      })`,
    )) as {
      controlsHidden: boolean;
      dialogsClosed: boolean;
      footprintLink: boolean;
      serverFacts: number;
      serverSources: boolean;
      documentRow: boolean;
      previewStages: number;
    };
    assertEqual(noJsPreviews.controlsHidden, true, "no-JS enlarge controls hidden");
    assertEqual(noJsPreviews.dialogsClosed, true, "no-JS dialogs closed");
    assertEqual(noJsPreviews.footprintLink, true, "no-JS footprint direct link retained");
    assertEqual(noJsPreviews.serverFacts > 0, true, "no-JS fact content is present in static HTML");
    assertEqual(noJsPreviews.serverSources, true, "no-JS Sources content is present in static HTML");
    assertEqual(noJsPreviews.documentRow, true, "no-JS document row is present in static HTML");
    assertEqual(noJsPreviews.previewStages, 2, "no-JS paired previews are present in static HTML");
  } finally {
    await cdp.send("Emulation.setScriptExecutionDisabled", { value: false });
  }
}
