/**
 * Direct reload of a record page (spec item 3, first new coverage item).
 *
 * Every other navigation in this suite either loads a record page fresh via
 * `Page.navigate` or arrives at one through client-side routing
 * (`checks/spa.ts`). Neither proves that reloading the SAME URL the SPA
 * router already owns — `Page.reload`, equivalent to the reader pressing F5 —
 * re-hydrates cleanly: a stale island registry or a viewer left in a
 * navigation-transition state would only show up here.
 */

import { assertEqual } from "../assertions.ts";
import { evaluate, waitFor, type CdpClient } from "../cdp.ts";
import { revealReadyViewer } from "./interactions.ts";

export async function checkDirectReload(cdp: CdpClient, recordPath: string): Promise<void> {
  await revealReadyViewer(cdp);
  await cdp.send("Page.reload", { ignoreCache: false });
  await waitFor(cdp, `location.pathname === ${JSON.stringify(recordPath)}`);
  await waitFor(cdp, `document.readyState === 'complete'`);
  await revealReadyViewer(cdp);
  assertEqual(await evaluate(cdp, `document.querySelectorAll('[data-component-model-viewer-root]').length`), 1, "one viewer root after a direct reload");
  assertEqual(await evaluate(cdp, `document.querySelectorAll('[data-model-viewer-viewport] canvas').length`), 1, "one canvas after a direct reload");
}
