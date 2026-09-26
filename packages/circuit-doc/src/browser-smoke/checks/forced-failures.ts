/**
 * Forced model/WebGL failures: `?model-viewer-model=fail` and
 * `?model-viewer-webgl=fail` (hooks kept in `viewer-runtime.ts` for exactly
 * this). Ported from the pinned LED script.
 */

import { assertEqual } from "../assertions.ts";
import { evaluate, navigate, waitFor, type CdpClient } from "../cdp.ts";
import { revealViewer } from "./interactions.ts";

export async function checkForcedModelFailure(cdp: CdpClient, origin: string, recordPath: string): Promise<void> {
  await navigate(cdp, origin, `${recordPath}?model-viewer-model=fail`);
  await revealViewer(cdp);
  await waitFor(cdp, `document.querySelector('[data-component-model-viewer-root]')?.dataset.viewerState === 'error'`);
  assertEqual(await evaluate(cdp, `document.querySelectorAll('[data-model-viewer-viewport] canvas').length`), 0, "no canvas after model load failure");
  assertEqual(
    await evaluate(cdp, `document.querySelector('[data-model-viewer-status]')?.textContent.includes('package reference')`),
    true,
    "meaningful model-load fallback",
  );
  assertEqual(
    await evaluate(cdp, `getComputedStyle(document.querySelector('[data-component-preview-enlarge="model"]')).display`),
    "none",
    "model enlarge hidden after model load failure",
  );
}

export async function checkForcedWebglFailure(cdp: CdpClient, origin: string, recordPath: string): Promise<void> {
  await navigate(cdp, origin, `${recordPath}?model-viewer-webgl=fail`);
  await revealViewer(cdp);
  await waitFor(cdp, `document.querySelector('[data-component-model-viewer-root]')?.dataset.viewerState === 'unavailable'`);
  assertEqual(await evaluate(cdp, `document.querySelectorAll('[data-model-viewer-viewport] canvas').length`), 0, "no canvas after forced WebGL failure");
  assertEqual(
    await evaluate(cdp, `document.querySelector('[data-model-viewer-status]')?.textContent.includes('WebGL is unavailable')`),
    true,
    "meaningful WebGL fallback",
  );
  assertEqual(
    await evaluate(cdp, `getComputedStyle(document.querySelector('[data-component-preview-enlarge="model"]')).display`),
    "none",
    "model enlarge hidden without WebGL",
  );
}
