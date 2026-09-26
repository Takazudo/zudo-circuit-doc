/**
 * System appearance (spec item 3, second new coverage item): with no explicit
 * theme set by this suite, a fresh load must follow `prefers-color-scheme`.
 *
 * Every other check in this suite calls `cdp.ts`'s `setDocumentTheme`, which
 * forces `data-theme` directly and so never proves the page's own default —
 * zudo-doc reading the system preference on first paint — actually works.
 * This check never calls it: it only emulates the media feature and asserts
 * the page picked the theme up on its own.
 */

import { assertEqual } from "../assertions.ts";
import { evaluate, navigate, setViewportAndMedia, waitFor, type CdpClient } from "../cdp.ts";

async function loadWithSystemAppearance(cdp: CdpClient, origin: string, path: string, theme: "light" | "dark"): Promise<string> {
  await setViewportAndMedia(cdp, 1280, theme, false);
  await navigate(cdp, origin, path);
  await waitFor(cdp, `document.readyState === 'complete'`);
  assertEqual(
    await evaluate(cdp, `matchMedia('(prefers-color-scheme: ${theme})').matches`),
    true,
    `${theme} system preference reported`,
  );
  assertEqual(
    await evaluate(cdp, `document.documentElement.dataset.theme`),
    theme,
    `system ${theme} appearance is applied with no explicit theme override`,
  );
  return (await evaluate(cdp, `getComputedStyle(document.body).backgroundColor`)) as string;
}

export async function checkSystemAppearance(cdp: CdpClient, origin: string, path: string): Promise<void> {
  const dark = await loadWithSystemAppearance(cdp, origin, path, "dark");
  const light = await loadWithSystemAppearance(cdp, origin, path, "light");
  assertEqual(dark !== light, true, "system light/dark appearance differ with no explicit theme override");
}
