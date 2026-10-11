/** Published zudo-doc 6 shell controls; selectors are its stable data hooks. */

import { assertEqual } from "../assertions.ts";
import { evaluate, waitFor, type CdpClient } from "../cdp.ts";
import { pressKey } from "./interactions.ts";

const SIDEBAR = "#desktop-sidebar";
const TREE = `${SIDEBAR} [data-sidebar-tree-root]`;
const FILTER = `${SIDEBAR} input[aria-label="Filter navigation"]`;

async function sidebarLinks(cdp: CdpClient): Promise<unknown> {
  return evaluate(cdp, `JSON.stringify([...document.querySelectorAll('${TREE} a[href]')].map((link) => link.getAttribute('href')).sort())`);
}

async function filterSidebar(cdp: CdpClient, value: string): Promise<void> {
  await evaluate(cdp, `(() => {
    const input = document.querySelector(${JSON.stringify(FILTER)});
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function checkSidebarScope(cdp: CdpClient, recordPath: string): Promise<void> {
  const current = (await evaluate(cdp, `(() => {
    const links = [...document.querySelectorAll('${TREE} a[aria-current="page"]')];
    const link = links[0];
    return { count: links.length, label: link?.textContent.trim(), path: link ? new URL(link.href).pathname : null,
      visible: link !== undefined && link.getClientRects().length > 0 };
  })()`)) as { count: number; label: string; path: string; visible: boolean };
  assertEqual(current.count, 1, "native sidebar has exactly one current page");
  assertEqual(current.path.replace(/\/$/u, ""), recordPath.replace(/\/$/u, ""), "native sidebar current page follows record route");
  assertEqual(current.visible, true, "native sidebar expands the current ancestry");
  const baseline = await sidebarLinks(cdp);
  const scrollY = await evaluate(cdp, "scrollY");

  await filterSidebar(cdp, "__zcd_no_navigation_match__");
  await waitFor(cdp, `document.querySelectorAll('${TREE} a[href]').length === 0`);
  await filterSidebar(cdp, current.label);
  await waitFor(cdp, `document.querySelector('${TREE} a[aria-current="page"]')?.getClientRects().length > 0`);
  await filterSidebar(cdp, "");
  await waitFor(cdp, `JSON.stringify([...document.querySelectorAll('${TREE} a[href]')].map((link) => link.getAttribute('href')).sort()) === ${JSON.stringify(baseline)}`);

  // Select the narrowest authored branch containing the active page. The
  // scope attribute is the released occurrence identity, never an invented
  // slug/row selector. The released CategoryNode places the focus control in
  // its header row, inside a relative wrapper, inside that node's own branch.
  const selectedScope = await evaluate(cdp, `(() => {
    const tree = document.querySelector('${TREE}');
    const current = tree.querySelector('a[aria-current="page"]');
    const candidates = [...tree.querySelectorAll('[data-sidebar-focus]')].map((button) => {
      const branch = button.parentElement?.parentElement?.parentElement;
      return { button, branch, links: branch?.querySelectorAll('a[href]').length ?? 0 };
    }).filter((entry) => entry.branch && entry.branch !== tree && entry.branch.contains(current) && entry.links > 1).sort((left, right) => left.links - right.links);
    const target = candidates[0]?.button;
    if (!target) throw new Error('native sidebar has no focusable branch containing the current record');
    const id = target.dataset.sidebarFocusScope;
    target.click();
    return id;
  })()`);
  await waitFor(cdp, `JSON.parse(sessionStorage.getItem('zd-sidebar-scope'))?.selected === ${JSON.stringify(selectedScope)}`);
  assertEqual((await sidebarLinks(cdp)) !== baseline, true, "native sidebar focus changes the visible branch");
  assertEqual(await evaluate(cdp, `document.querySelector('${TREE} a[aria-current="page"]')?.getClientRects().length > 0`), true, "focused native branch preserves the current page and its ancestry");
  assertEqual(await evaluate(cdp, `document.querySelector('${SIDEBAR}').contains(document.activeElement)`), true, "native sidebar focus retains keyboard focus in the tree");
  await evaluate(cdp, `document.querySelector('${SIDEBAR} [data-sidebar-restore]').click()`);
  await waitFor(cdp, `JSON.stringify([...document.querySelectorAll('${TREE} a[href]')].map((link) => link.getAttribute('href')).sort()) === ${JSON.stringify(baseline)}`);
  assertEqual(await evaluate(cdp, `document.activeElement === document.querySelector('${TREE} a[aria-current="page"]')`), true, "native sidebar restore focuses the current page");
  await evaluate(cdp, `[...document.querySelectorAll('${TREE} [data-sidebar-focus]')].find((button) => button.dataset.sidebarFocusScope === ${JSON.stringify(selectedScope)}).click()`);
  await waitFor(cdp, `JSON.parse(sessionStorage.getItem('zd-sidebar-scope'))?.selected === ${JSON.stringify(selectedScope)}`);
  await evaluate(cdp, `document.querySelector('${SIDEBAR} [data-sidebar-broaden]').click()`);
  await waitFor(cdp, `JSON.stringify([...document.querySelectorAll('${TREE} a[href]')].map((link) => link.getAttribute('href')).sort()) === ${JSON.stringify(baseline)}`);
  assertEqual(await evaluate(cdp, `document.querySelector('${TREE} a[aria-current="page"]')?.getClientRects().length > 0`), true, "broader native tree restores the parent tree and keeps current ancestry visible");
  assertEqual(await evaluate(cdp, "scrollY"), scrollY, "native sidebar scope controls preserve article scroll");
}

async function checkSearchDialog(cdp: CdpClient, recordPath: string, identity: string): Promise<void> {
  await evaluate(cdp, `(() => { const trigger = document.querySelector('header [data-open-search]'); trigger.focus(); trigger.click(); })()`);
  await waitFor(cdp, `document.querySelector('[data-search-dialog]')?.open`);
  assertEqual(await evaluate(cdp, `document.querySelector('[data-search-dialog]').matches(':modal')`), true, "native search is modal");
  assertEqual(await evaluate(cdp, `document.activeElement === document.querySelector('[data-search-input]')`), true, "native search focuses its input");
  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-search-input]'); input.value = ${JSON.stringify(identity)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const path = recordPath.replace(/\/$/u, "");
  await waitFor(cdp, `[...document.querySelectorAll('[data-search-results] a[href]')].some((link) => new URL(link.href).pathname.replace(/\\/$/u, '') === ${JSON.stringify(path)})`);
  await pressKey(cdp, "Escape", "Escape", 27);
  await waitFor(cdp, `!document.querySelector('[data-search-dialog]')?.open`);
  assertEqual(await evaluate(cdp, `document.activeElement === document.querySelector('header [data-open-search]')`), true, "native search Escape restores trigger focus");
}

async function checkAppearanceMenu(cdp: CdpClient): Promise<void> {
  const trigger = "header [data-header-right] [data-zd-theme-menu] > button";
  let lightColors: unknown;
  for (const preference of ["light", "dark", "system"]) {
    await evaluate(cdp, `document.querySelector('${trigger}').click()`);
    await waitFor(cdp, `document.querySelector('${trigger}')?.getAttribute('aria-expanded') === 'true'`);
    await waitFor(cdp, `document.querySelector('header [data-header-right] [data-zd-theme-menu] [role="menu"]')?.contains(document.activeElement)`);
    assertEqual(await evaluate(cdp, `document.querySelectorAll('header [data-header-right] [data-zd-theme-menu] [role="menuitemradio"]').length`), 3, "native appearance menu offers light, dark and system");
    await evaluate(cdp, `(() => {
      const item = [...document.querySelectorAll('header [data-header-right] [data-zd-theme-menu] [role="menuitemradio"]')].find((button) => button.textContent.trim().toLowerCase().startsWith(${JSON.stringify(preference)}));
      if (!item) throw new Error('native appearance preference is missing'); item.click();
    })()`);
    await waitFor(cdp, `document.querySelector('${trigger}')?.getAttribute('aria-expanded') === 'false'`);
    await waitFor(cdp, `document.documentElement.dataset.theme === ${JSON.stringify(preference === "system" ? "light" : preference)}`);
    const colors = await evaluate(cdp, `getComputedStyle(document.body).color + '|' + getComputedStyle(document.body).backgroundColor`);
    if (preference === "light") lightColors = colors;
    if (preference === "dark") assertEqual(colors !== lightColors, true, "native appearance preference changes computed colors");
  }
  await evaluate(cdp, `document.querySelector('${trigger}').click()`);
  await waitFor(cdp, `document.querySelector('${trigger}')?.getAttribute('aria-expanded') === 'true'`);
  await waitFor(cdp, `document.querySelector('header [data-header-right] [data-zd-theme-menu] [role="menu"]')?.contains(document.activeElement)`);
  await pressKey(cdp, "Escape", "Escape", 27);
  await waitFor(cdp, `document.querySelector('${trigger}')?.getAttribute('aria-expanded') === 'false'`);
  await waitFor(cdp, `document.activeElement === document.querySelector('${trigger}')`);
}

/** Call at a desktop viewport with the system appearance emulated as light. */
export async function checkNativeShellInteractions(cdp: CdpClient, recordPath: string, identity: string): Promise<void> {
  await checkSidebarScope(cdp, recordPath);
  await checkSearchDialog(cdp, recordPath, identity);
  await checkAppearanceMenu(cdp);
}
