/**
 * SPA dispose/remount: client navigation away from a record page must dispose
 * both the inline and dialog viewers and detach their canvases; `history.back`
 * must yield exactly one fresh viewer. Ported from the pinned LED script.
 */

import { assertEqual } from "../assertions.ts";
import { evaluate, waitFor, type CdpClient } from "../cdp.ts";
import { revealReadyViewer } from "./interactions.ts";

/** `awayRoute` may or may not carry a trailing slash; a prefix match tolerates either. */
export async function exerciseSpaDisposeAndRemount(cdp: CdpClient, recordPath: string, awayRoute: string): Promise<void> {
  await evaluate(cdp, `document.querySelector('[data-component-preview-enlarge="model"]').click()`);
  await waitFor(cdp, `document.querySelector('[data-model-viewer-instance="dialog"]')?.dataset.viewerState === 'ready'`, 20_000);
  const awayPrefix = awayRoute.replace(/\/$/u, "");
  await evaluate(
    cdp,
    `(() => {
      window.__zcdOldViewers = [...document.querySelectorAll('[data-component-model-viewer-root]')];
      window.__zcdOldCanvases = window.__zcdOldViewers.map((viewer) => viewer.querySelector('canvas'));
      const away = ${JSON.stringify(awayPrefix)};
      const link = [...document.querySelectorAll('a[href]')].find((candidate) => {
        const path = new URL(candidate.href, location.href).pathname.replace(/\\/$/u, '');
        return path === away;
      });
      if (!link) throw new Error('no away-route link found on the record page (' + away + ')');
      link.click();
    })()`,
  );
  await waitFor(cdp, `location.pathname === ${JSON.stringify(awayPrefix)} || location.pathname === ${JSON.stringify(`${awayPrefix}/`)}`);
  await waitFor(cdp, `window.__zcdOldViewers?.every((viewer) => viewer.dataset.viewerDisposed === 'true')`);
  assertEqual(await evaluate(cdp, `window.__zcdOldViewers?.length`), 2, "SPA navigation started with inline and dialog viewers");
  assertEqual(
    await evaluate(cdp, `window.__zcdOldCanvases?.every((canvas) => !canvas?.isConnected)`),
    true,
    "inline and dialog canvases detached on SPA swap",
  );

  await evaluate(cdp, "history.back()");
  await waitFor(cdp, `location.pathname === ${JSON.stringify(recordPath)}`);
  await revealReadyViewer(cdp);
  assertEqual(await evaluate(cdp, `document.querySelectorAll('[data-component-model-viewer-root]').length`), 1, "one viewer root after SPA back");
  assertEqual(await evaluate(cdp, `document.querySelectorAll('[data-model-viewer-viewport] canvas').length`), 1, "one canvas after SPA back");
  assertEqual(
    await evaluate(cdp, `window.__zcdOldViewers?.includes(document.querySelector('[data-component-model-viewer-root]'))`),
    false,
    "fresh viewer after SPA back",
  );
}
