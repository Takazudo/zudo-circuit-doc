/**
 * Orchestrates one `check-browser` run: static-serve `--dist`, launch system
 * Chrome over CDP, and drive every check in `checks/`. Ported from the pinned
 * LED `model-viewer-browser-smoke.mjs` `main()`, parameterized by
 * `BrowserSmokeOptions` instead of the module-level LED constants.
 */

import { stat } from "node:fs/promises";

import { assertDurationAtMost, assertEqual } from "./assertions.ts";
import { delay, evaluate, navigate, setDocumentTheme, setViewportAndMedia, type CdpClient } from "./cdp.ts";
import { launchChrome } from "./chrome.ts";
import { checkSystemAppearance } from "./checks/appearance.ts";
import { checkViewerFreeCatalog } from "./checks/catalog.ts";
import { checkSourceDetailExpansion } from "./checks/details.ts";
import { checkForcedModelFailure, checkForcedWebglFailure } from "./checks/forced-failures.ts";
import {
  exerciseDialogGeometry,
  exerciseFootprintDialog,
  exerciseModelDialog,
  exerciseViewerInteractions,
  renderCount,
  revealReadyViewer,
} from "./checks/interactions.ts";
import { checkNoJsFallback } from "./checks/no-js.ts";
import { inspectReferencePage } from "./checks/reference-page.ts";
import { checkDirectReload } from "./checks/reload.ts";
import { checkSearchAndLlmExport } from "./checks/search.ts";
import { exerciseSpaDisposeAndRemount } from "./checks/spa.ts";
import { checkLongTables } from "./checks/tables.ts";
import { resolveRepresentatives } from "./representatives.ts";
import { serveStaticSite } from "./static-server.ts";
import type { BrowserSmokeOptions, BrowserSmokeReport } from "./types.ts";

const VIEWPORTS = [1600, 1280, 1024, 390] as const;
const THEMES = ["light", "dark"] as const;

export async function runBrowserSmoke(options: BrowserSmokeOptions): Promise<BrowserSmokeReport> {
  const lines: string[] = [];
  const distIndex = `${options.distRoot}/index.html`;
  const distOk = await stat(distIndex).then(
    () => true,
    () => false,
  );
  if (!distOk) throw new Error(`check-browser: ${options.distRoot} does not look like a built site (no index.html)`);

  if (options.searchAssertions) {
    if (options.generatedRoot === undefined) {
      throw new Error("check-browser: --search-assertions needs the project's generated-content root");
    }
    await checkSearchAndLlmExport(options.distRoot, options.generatedRoot, options.representatives);
    lines.push(`search and llms-full.txt: ${options.representatives.length} representative(s) verified`);
  }

  const resolved = await resolveRepresentatives(options.distRoot, options.representatives);
  const record = resolved.record;
  const withReferences = new Set(resolved.withReferences.map((representative) => representative.slug));
  for (const representative of resolved.all) {
    if (!withReferences.has(representative.slug)) {
      lines.push(`SKIP: ${representative.kind} (${representative.path}) has no published component-references section`);
    }
  }
  if (record === undefined) {
    lines.push("SKIP: no representative publishes a component-references section (declared-zero project)");
  }

  const site = await serveStaticSite(options.distRoot);
  try {
    const session = await launchChrome(options.chromeBin);
    const cdp = session.cdp;
    try {
      let inspected = 0;
      const lightThemeSignatures = new Map<string, string>();
      for (const width of VIEWPORTS) {
        for (const theme of THEMES) {
          await setViewportAndMedia(cdp, width, theme, false);
          for (const representative of resolved.all) {
            await navigate(cdp, site.origin, representative.path);
            await setDocumentTheme(cdp, theme);
            if (withReferences.has(representative.slug)) {
              const report = await inspectReferencePage(cdp, representative, width, theme, options.shellAssertions);
              const signatureKey = `${width}:${representative.kind}`;
              if (theme === "light") lightThemeSignatures.set(signatureKey, report.themeSignature);
              else {
                assertEqual(
                  report.themeSignature !== lightThemeSignatures.get(signatureKey),
                  true,
                  `${representative.kind} ${width} light/dark computed colors differ`,
                );
              }
            }
            inspected += 1;
          }
        }
      }

      if (record !== undefined) {
        await runRecordChecks(cdp, site.origin, record.path, options);
      } else {
        lines.push("SKIP: dialog, SPA, forced-failure and no-JS viewer checks (no representative has a published model)");
      }

      await checkViewerFreeCatalog(cdp, site.origin, options.awayRoute);

      lines.push(
        `component reference browser smoke passed: ${inspected} responsive/theme cases, paired references, media-only dialogs, interactions, focus, on-demand idle, SPA cleanup, fallbacks, no-JS, viewer-free catalog`,
      );
      return { lines };
    } catch (error) {
      const diagnostics = await evaluate(
        cdp,
        `({
          href: location.href,
          state: document.querySelector('[data-component-model-viewer-root]')?.dataset.viewerState,
          status: document.querySelector('[data-model-viewer-status]')?.textContent,
          canvases: document.querySelectorAll('[data-model-viewer-viewport] canvas').length,
          readyState: document.readyState,
          marker: document.querySelector('[data-zfb-island="PackageModelViewerIsland"]')?.outerHTML.slice(0, 300),
          scripts: [...document.scripts].map((script) => script.src || 'inline').slice(-10),
        })`,
      ).catch(() => null);
      throw new Error(`${(error as Error).message}; browser diagnostics: ${JSON.stringify(diagnostics)}`, { cause: error });
    } finally {
      await session.close();
    }
  } finally {
    await site.close();
  }
}

async function settledRenderCount(cdp: CdpClient, timeoutMs = 3000): Promise<number> {
  let previous = await renderCount(cdp);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await delay(250);
    const current = await renderCount(cdp);
    if (current === previous) return current;
    previous = current;
  }
  throw new Error(`render-on-demand never settled within ${timeoutMs}ms (last count ${previous})`);
}

async function runRecordChecks(
  cdp: CdpClient,
  origin: string,
  recordPath: string,
  options: BrowserSmokeOptions,
): Promise<void> {
  await setViewportAndMedia(cdp, 390, "dark", false, 844, 2);
  await navigate(cdp, origin, recordPath);
  await setDocumentTheme(cdp, "dark");
  await revealReadyViewer(cdp);
  await exerciseDialogGeometry(cdp, 390, 844);

  await setViewportAndMedia(cdp, 1600, "light", false);
  await navigate(cdp, origin, recordPath);
  await setDocumentTheme(cdp, "light");
  await revealReadyViewer(cdp);
  await exerciseFootprintDialog(cdp, recordPath);
  await exerciseModelDialog(cdp);
  await exerciseViewerInteractions(cdp);

  // No continuous animation loop: after interaction/resize settles, the
  // diagnostic render count stays unchanged without input. Slow CI runners can
  // still be flushing damping/resize frames after a fixed short delay, so wait
  // for the count to stop moving first; a continuous loop never settles and
  // still fails here.
  const renders = await settledRenderCount(cdp);
  await delay(500);
  assertEqual(await renderCount(cdp), renders, "render-on-demand remains idle");

  await setViewportAndMedia(cdp, 1600, "dark", true);
  assertEqual(await evaluate(cdp, `matchMedia('(prefers-reduced-motion: reduce)').matches`), true, "reduced-motion media active");
  const reducedDurations = (await evaluate(
    cdp,
    `(() => {
      const target = document.querySelector('[data-model-viewer-viewport]');
      const style = getComputedStyle(target);
      return { animation: style.animationDuration, transition: style.transitionDuration };
    })()`,
  )) as { animation: string; transition: string };
  assertDurationAtMost(reducedDurations.animation, 0.001, "reduced-motion animation duration");
  assertDurationAtMost(reducedDurations.transition, 0.001, "reduced-motion transition duration");

  // New coverage (seed 07): direct reload, system appearance, long tables,
  // and source-detail expansion, each on the same record page.
  await checkDirectReload(cdp, recordPath);
  await checkSystemAppearance(cdp, origin, recordPath);
  await checkLongTables(cdp, origin, recordPath, [390, 1024]);
  await checkSourceDetailExpansion(cdp, origin, recordPath, options.distRoot);

  await setViewportAndMedia(cdp, 1600, "light", false);
  await navigate(cdp, origin, recordPath);
  await setDocumentTheme(cdp, "light");
  await revealReadyViewer(cdp);
  await exerciseSpaDisposeAndRemount(cdp, recordPath, options.awayRoute);

  await checkForcedModelFailure(cdp, origin, recordPath);
  await checkForcedWebglFailure(cdp, origin, recordPath);
  // Any representative with a published model works here; RECORD itself is
  // guaranteed to have one, unlike an arbitrary "first representative".
  await checkNoJsFallback(cdp, origin, recordPath);
}
