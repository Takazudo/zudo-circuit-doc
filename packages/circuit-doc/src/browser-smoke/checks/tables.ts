/**
 * Long tables (spec item 3, third new coverage item): at 390px and 1024px,
 * every `EvidenceTable` scroll container (`.zcd-evidence-table`,
 * `ui/evidence-table.tsx`) is keyboard-focusable and horizontally scrollable
 * when its content overflows, and the page itself never overflows — the
 * container scrolls so the body does not.
 */

import { assertEqual } from "../assertions.ts";
import { evaluate, navigate, setViewportAndMedia, waitFor, type CdpClient } from "../cdp.ts";

export async function checkLongTables(cdp: CdpClient, origin: string, path: string, widths: readonly number[]): Promise<void> {
  for (const width of widths) {
    await setViewportAndMedia(cdp, width, "light", false);
    await navigate(cdp, origin, path);
    await waitFor(cdp, `document.readyState === 'complete'`);

    const report = (await evaluate(
      cdp,
      `({
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        tables: [...document.querySelectorAll('.zcd-evidence-table')].map((container) => ({
          tabIndex: container.tabIndex,
          overflows: container.scrollWidth > container.clientWidth + 1,
          scrollable: (() => {
            const before = container.scrollLeft;
            container.scrollLeft = container.scrollWidth;
            const after = container.scrollLeft;
            container.scrollLeft = before;
            return after > before || container.scrollWidth <= container.clientWidth + 1;
          })(),
        })),
      })`,
    )) as { pageOverflow: boolean; tables: ReadonlyArray<{ tabIndex: number; overflows: boolean; scrollable: boolean }> };

    assertEqual(report.pageOverflow, false, `page has no horizontal overflow at ${width}px`);
    assertEqual(report.tables.length > 0, true, `at least one evidence table is present at ${width}px`);
    for (const [index, table] of report.tables.entries()) {
      assertEqual(table.tabIndex, 0, `evidence table ${index + 1} is keyboard-focusable at ${width}px`);
      if (table.overflows) {
        assertEqual(table.scrollable, true, `evidence table ${index + 1} scrolls horizontally when it overflows at ${width}px`);
      }
    }
  }
}
