/**
 * Source detail expansion (spec item 3, fourth new coverage item): every
 * `EvidenceDetails` `<details>` block (`.zcd-evidence-details`,
 * `ui/evidence-details.tsx` — pin assignments and, wherever a page uses the
 * component again, source details) opens and closes, its content is present
 * in the static HTML before JS, and deep links to a fact/source/coverage
 * anchor (`EvidenceAnchor`, `.zcd-evidence-anchor`) land on a visible target
 * — auto-expanding a `<details>` that contains it, which is native browser
 * behaviour this suite only has to confirm still holds.
 *
 * No label is hard-coded: this walks whatever `.zcd-evidence-details`
 * elements the record actually has, so it is not tied to "pin-assignments"
 * being the only label a project ever uses.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { assertEqual } from "../assertions.ts";
import { evaluate, navigate, waitFor, type CdpClient } from "../cdp.ts";

export async function checkSourceDetailExpansion(cdp: CdpClient, origin: string, path: string, distRoot: string): Promise<readonly string[]> {
  const lines: string[] = [];
  await navigate(cdp, origin, path);
  await waitFor(cdp, `document.readyState === 'complete'`);

  const count = (await evaluate(cdp, `document.querySelectorAll('.zcd-evidence-details').length`)) as number;
  if (count === 0) {
    lines.push(`SKIP: ${path} has no EvidenceDetails block to exercise`);
  } else {
    // Present in the static HTML regardless of JS or open/closed state.
    const relative = path.replace(/^\/+/u, "").replace(/\/+$/u, "");
    const html = await readFile(join(distRoot, relative, "index.html"), "utf8");
    // A bare substring, not a quoted attribute match: the built HTML omits
    // attribute quotes for single-token values (`class=zcd-evidence-details`).
    assertEqual(html.includes("zcd-evidence-details"), true, "evidence details are present in the static HTML");
    assertEqual(/<summary>/u.test(html), true, "evidence details summary text is present in the static HTML");

    for (let index = 0; index < count; index += 1) {
      const selector = `document.querySelectorAll('.zcd-evidence-details')[${index}]`;
      assertEqual(await evaluate(cdp, `${selector}.open`), false, `evidence details ${index + 1} starts closed`);
      await evaluate(cdp, `${selector}.querySelector('summary').click()`);
      assertEqual(await evaluate(cdp, `${selector}.open`), true, `evidence details ${index + 1} opens on click`);
      assertEqual(
        await evaluate(cdp, `getComputedStyle(${selector}).display !== 'none' && ${selector}.getBoundingClientRect().height > 0`),
        true,
        `evidence details ${index + 1} content is visible once open`,
      );
      await evaluate(cdp, `${selector}.querySelector('summary').click()`);
      assertEqual(await evaluate(cdp, `${selector}.open`), false, `evidence details ${index + 1} closes on a second click`);
    }
  }

  const anchorIds = (await evaluate(cdp, `[...document.querySelectorAll('.zcd-evidence-anchor[id]')].map((el) => el.id)`)) as readonly string[];
  if (anchorIds.length === 0) {
    lines.push(`SKIP: ${path} has no evidence anchor to deep-link to`);
    return lines;
  }
  const target = anchorIds[Math.floor(anchorIds.length / 2)] as string;
  await navigate(cdp, origin, `${path}#${target}`);
  await waitFor(cdp, `document.readyState === 'complete'`);
  const landed = (await evaluate(
    cdp,
    `(() => {
      const anchor = document.getElementById(${JSON.stringify(target)});
      if (!anchor) return { found: false };
      const enclosingDetails = anchor.closest('details');
      // The anchor itself is a zero-size, aria-hidden marker (EvidenceAnchor):
      // "visible" means its nearest sized ancestor is on the page, not hidden
      // behind a still-closed details or a display:none container.
      let node = anchor;
      while (node !== null) {
        const rect = node.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) break;
        node = node.parentElement;
      }
      return {
        found: true,
        detailsAutoOpened: enclosingDetails === null || enclosingDetails.open,
        visible: node !== null && getComputedStyle(node).visibility !== 'hidden',
      };
    })()`,
  )) as { found: boolean; detailsAutoOpened?: boolean; visible?: boolean };
  assertEqual(landed.found, true, `deep link #${target} resolves to an element on the page`);
  assertEqual(landed.detailsAutoOpened, true, `deep link #${target} auto-opens its enclosing details, if any`);
  assertEqual(landed.visible, true, `deep link #${target} lands on a visible target`);
  return lines;
}
