/**
 * The catalog page loads no viewer, canvas, dialog or model resource at all —
 * it is not a record page. Ported from the pinned LED script.
 */

import { assertEqual } from "../assertions.ts";
import { delay, evaluate, navigate, type CdpClient } from "../cdp.ts";

export async function checkViewerFreeCatalog(cdp: CdpClient, origin: string, awayRoute: string): Promise<void> {
  await navigate(cdp, origin, awayRoute);
  await delay(500); // wait-ok: this is an intentional absence-window assertion.
  const catalogState = (await evaluate(
    cdp,
    `({
      viewers: document.querySelectorAll('[data-component-model-viewer-root]').length,
      canvases: document.querySelectorAll('canvas').length,
      previewDialogs: document.querySelectorAll('[data-component-preview-dialog]').length,
      previewTriggers: document.querySelectorAll('[data-component-preview-enlarge]').length,
      modelResources: performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/assets/component-previews/models/')).length,
      modelMarkers: document.documentElement.innerHTML.includes('data-model-url')
    })`,
  )) as {
    viewers: number;
    canvases: number;
    previewDialogs: number;
    previewTriggers: number;
    modelResources: number;
    modelMarkers: boolean;
  };
  assertEqual(catalogState.viewers, 0, "catalog has no viewer root");
  assertEqual(catalogState.canvases, 0, "catalog has no canvas");
  assertEqual(catalogState.previewDialogs, 0, "catalog has no preview dialogs");
  assertEqual(catalogState.previewTriggers, 0, "catalog has no preview triggers");
  assertEqual(catalogState.modelResources, 0, "catalog loads no model resource");
  assertEqual(catalogState.modelMarkers, false, "catalog has no model descriptor");
}
