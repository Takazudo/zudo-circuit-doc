/**
 * Viewer interaction and dialog exercises ported from the pinned LED
 * `model-viewer-browser-smoke.mjs` (`exercise*`/`renderCount`/`wait*` group).
 * Only the `zld-` -> `zcd-` class rename (ADR-015) and the query-param/dataset
 * names, which never changed between the two packages (`viewer-runtime.ts`,
 * `viewer-state.ts`), matter here — the interaction script itself is
 * unchanged because the runtime it drives is unchanged.
 */

import { assertContained, assertEqual, type Rect } from "../assertions.ts";
import { delay, evaluate, setViewportAndMedia, waitFor, type CdpClient } from "../cdp.ts";

export async function renderCount(cdp: CdpClient, instance: "inline" | "dialog" = "inline"): Promise<number> {
  return Number(
    await evaluate(cdp, `document.querySelector('[data-model-viewer-instance=${JSON.stringify(instance)}]')?.dataset.renderCount ?? 0`),
  );
}

export async function waitForCanvasSize(cdp: CdpClient, instance: "inline" | "dialog"): Promise<void> {
  const rootSelector = `[data-model-viewer-instance="${instance}"]`;
  await waitFor(
    cdp,
    `(() => {
      const viewport = document.querySelector(${JSON.stringify(`${rootSelector} [data-model-viewer-viewport]`)});
      const canvas = viewport?.querySelector('canvas');
      if (!viewport || !canvas) return false;
      const ratio = Math.min(devicePixelRatio, 2);
      const expectedWidth = Math.max(1, viewport.clientWidth) * ratio;
      const expectedHeight = Math.max(1, viewport.clientHeight) * ratio;
      return Math.abs(canvas.width - expectedWidth) <= Math.max(4, expectedWidth * 0.01)
        && Math.abs(canvas.height - expectedHeight) <= Math.max(4, expectedHeight * 0.01);
    })()`,
  );
}

export async function waitForRenderIdle(cdp: CdpClient, label: string, instance: "inline" | "dialog" = "inline"): Promise<void> {
  await delay(150);
  const count = await renderCount(cdp, instance);
  await delay(250);
  assertEqual(await renderCount(cdp, instance), count, label);
}

export async function waitForRenderSettled(cdp: CdpClient, instance: "inline" | "dialog" = "inline", timeout = 10_000): Promise<void> {
  const deadline = Date.now() + timeout;
  let previous = await renderCount(cdp, instance);
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await delay(100);
    const current = await renderCount(cdp, instance);
    if (current !== previous) {
      previous = current;
      stableSince = Date.now();
      continue;
    }
    if (Date.now() - stableSince >= 750) return;
  }
  throw new Error(`${instance} viewer did not settle after resize`);
}

export async function pressKey(cdp: CdpClient, key: string, code: string, keyCode: number, modifiers = 0): Promise<void> {
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, modifiers, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
}

export async function clickAt(cdp: CdpClient, x: number, y: number): Promise<void> {
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

export async function revealViewer(cdp: CdpClient): Promise<void> {
  await waitFor(
    cdp,
    `(() => {
      const marker = document.querySelector('[data-zfb-island="PackageModelViewerIsland"]');
      if (!marker) return false;
      marker.scrollIntoView({ block: 'center' });
      const bounds = marker.getBoundingClientRect();
      return bounds.bottom > 0 && bounds.top < innerHeight;
    })()`,
  );
}

export async function revealReadyViewer(cdp: CdpClient): Promise<void> {
  await revealViewer(cdp);
  await waitFor(cdp, `document.querySelector('[data-component-model-viewer-root]')?.dataset.viewerState === 'ready'`, 20_000);
  assertEqual(await evaluate(cdp, `document.querySelectorAll('[data-component-model-viewer-root]').length`), 1, "one viewer root after load");
  assertEqual(await evaluate(cdp, `document.querySelectorAll('[data-model-viewer-viewport] canvas').length`), 1, "one canvas after load");
}

export async function exerciseViewerInteractions(
  cdp: CdpClient,
  instance: "inline" | "dialog" = "inline",
  testResize = true,
): Promise<void> {
  const rootSelector = `[data-model-viewer-instance="${instance}"]`;
  const canvas = (await evaluate(
    cdp,
    `(() => {
      const rect = document.querySelector(${JSON.stringify(`${rootSelector} [data-model-viewer-viewport] canvas`)}).getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    })()`,
  )) as { left: number; top: number; width: number; height: number };
  const x = canvas.left + canvas.width / 2;
  const y = canvas.top + canvas.height / 2;

  await waitForRenderIdle(cdp, `before ${instance} orbit input`, instance);
  let before = await renderCount(cdp, instance);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + 48, y: y + 24, button: "left", buttons: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x + 48, y: y + 24, button: "left", buttons: 0, clickCount: 1 });
  await waitFor(cdp, `Number(document.querySelector(${JSON.stringify(rootSelector)}).dataset.renderCount) > ${before}`);

  await waitForRenderIdle(cdp, `before ${instance} zoom input`, instance);
  before = await renderCount(cdp, instance);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: -180 });
  await waitFor(cdp, `Number(document.querySelector(${JSON.stringify(rootSelector)}).dataset.renderCount) > ${before}`);

  await waitForRenderIdle(cdp, `before ${instance} keyboard input`, instance);
  await evaluate(cdp, `document.querySelector(${JSON.stringify(`${rootSelector} [data-model-viewer-viewport]`)}).focus()`);
  before = await renderCount(cdp, instance);
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37 });
  await waitFor(cdp, `Number(document.querySelector(${JSON.stringify(rootSelector)}).dataset.renderCount) > ${before}`);
  const focus = (await evaluate(
    cdp,
    `(() => {
      const viewport = document.querySelector(${JSON.stringify(`${rootSelector} [data-model-viewer-viewport]`)});
      const style = getComputedStyle(viewport);
      return { active: document.activeElement === viewport, outline: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    })()`,
  )) as { active: boolean; outline: string; width: number };
  assertEqual(focus.active, true, `${instance} viewer keyboard focus retained`);
  assertEqual(focus.outline !== "none" && focus.width >= 2, true, `${instance} viewer focus state visible`);

  if (!testResize) return;
  await waitForRenderIdle(cdp, `before ${instance} resize input`, instance);
  before = await renderCount(cdp, instance);
  await setViewportAndMedia(cdp, 1200, "light", false);
  await waitFor(cdp, `Number(document.querySelector(${JSON.stringify(rootSelector)}).dataset.renderCount) > ${before}`);
  await waitForCanvasSize(cdp, instance);
  await waitForRenderSettled(cdp, instance);
  await waitForCanvasSize(cdp, instance);
  const resized = (await evaluate(
    cdp,
    `(() => {
      const canvas = document.querySelector(${JSON.stringify(`${rootSelector} [data-model-viewer-viewport] canvas`)});
      const viewport = document.querySelector(${JSON.stringify(`${rootSelector} [data-model-viewer-viewport]`)});
      return { cssWidth: canvas.clientWidth, viewportWidth: viewport.clientWidth, pixelWidth: canvas.width, ratio: devicePixelRatio };
    })()`,
  )) as { cssWidth: number; viewportWidth: number; pixelWidth: number; ratio: number };
  const expectedPixelWidth = resized.viewportWidth * resized.ratio;
  if (Math.abs(resized.pixelWidth - expectedPixelWidth) > Math.max(4, expectedPixelWidth * 0.01)) {
    throw new Error(`viewer canvas did not resize to viewport: ${JSON.stringify(resized)}`);
  }
  await setViewportAndMedia(cdp, 1600, "light", false);
}

export async function exerciseDialogGeometry(cdp: CdpClient, width: number, height: number): Promise<void> {
  for (const kind of ["footprint", "model"] as const) {
    const triggerSelector = `[data-component-preview-enlarge="${kind}"]`;
    const dialogSelector = `[data-component-preview-dialog="${kind}"]`;
    await waitFor(cdp, `getComputedStyle(document.querySelector(${JSON.stringify(triggerSelector)})).display !== 'none'`);
    if (kind === "model") {
      await evaluate(
        cdp,
        `(() => {
          window.__zcdDialogReadyRenderCount = null;
          const observer = new MutationObserver(() => {
            const root = document.querySelector('[data-model-viewer-instance="dialog"]');
            if (root?.dataset.viewerState !== 'ready') return;
            window.__zcdDialogReadyRenderCount = Number(root.dataset.renderCount ?? 0);
            observer.disconnect();
          });
          observer.observe(document.querySelector(${JSON.stringify(dialogSelector)}), {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['data-viewer-state'],
          });
        })()`,
      );
    }
    await evaluate(cdp, `document.querySelector(${JSON.stringify(triggerSelector)}).click()`);
    await waitFor(cdp, `document.querySelector(${JSON.stringify(dialogSelector)})?.open`);
    if (kind === "model") {
      await waitFor(cdp, `document.querySelector('[data-model-viewer-instance="dialog"]')?.dataset.viewerState === 'ready'`, 20_000);
      await waitFor(cdp, `window.__zcdDialogReadyRenderCount !== null`);
      assertEqual(await evaluate(cdp, `window.__zcdDialogReadyRenderCount > 0`), true, "model ready state is published after its first render");
      await waitForCanvasSize(cdp, "dialog");
    }

    const report = (await evaluate(
      cdp,
      `(() => {
        const dialog = document.querySelector(${JSON.stringify(dialogSelector)});
        const close = dialog.querySelector('.zcd-preview-dialog__close');
        const content = dialog.querySelector('.zcd-preview-dialog__content');
        const rect = (element) => {
          const value = element.getBoundingClientRect();
          return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
        };
        const image = dialog.querySelector('img');
        const modelViewport = dialog.querySelector('[data-model-viewer-viewport]');
        const canvas = modelViewport?.querySelector('canvas');
        const status = dialog.querySelector('.zcd-model-viewer__status');
        const visibleCopy = [...dialog.querySelectorAll('h1,h2,h3,h4,h5,h6,p,figcaption,a,button')]
          .filter((element) => {
            const style = getComputedStyle(element);
            const bounds = element.getBoundingClientRect();
            const clippedVisually = style.position === 'absolute' && bounds.width <= 1 && bounds.height <= 1 && style.clipPath !== 'none';
            return element.textContent.trim() !== '' && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && !clippedVisually;
          })
          .map((element) => element.textContent.trim());
        return {
          modal: dialog.matches(':modal'),
          accessibleName: dialog.getAttribute('aria-label'),
          hasVisibleTitleReference: dialog.hasAttribute('aria-labelledby'),
          closeLabel: close.getAttribute('aria-label'),
          closeVisibleText: close.textContent.trim(),
          closeIconHidden: close.querySelector('svg')?.getAttribute('aria-hidden') === 'true',
          visibleCopy,
          forbiddenVisibleContent: dialog.querySelector('.zcd-preview-dialog__title,.zcd-model-viewer__caption,.zcd-model-viewer__notice,[data-preview-instructions]') !== null,
          statusVisuallyHidden: status === null || (() => {
            const style = getComputedStyle(status);
            const bounds = status.getBoundingClientRect();
            return style.position === 'absolute' && bounds.width <= 1 && bounds.height <= 1 && style.clipPath !== 'none';
          })(),
          viewport: { width: innerWidth, height: innerHeight },
          pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          dialogOverflow: dialog.scrollWidth > dialog.clientWidth + 1,
          dialog: rect(dialog),
          close: rect(close),
          content: rect(content),
          image: image ? { rect: rect(image), objectFit: getComputedStyle(image).objectFit } : null,
          model: modelViewport && canvas ? {
            viewport: rect(modelViewport),
            clientWidth: modelViewport.clientWidth,
            clientHeight: modelViewport.clientHeight,
            canvas: rect(canvas),
            pixelWidth: canvas.width,
            pixelHeight: canvas.height,
            ratio: devicePixelRatio,
          } : null,
        };
      })()`,
    )) as {
      modal: boolean;
      accessibleName: string | null;
      hasVisibleTitleReference: boolean;
      closeLabel: string | null;
      closeVisibleText: string;
      closeIconHidden: boolean;
      visibleCopy: readonly string[];
      forbiddenVisibleContent: boolean;
      statusVisuallyHidden: boolean;
      viewport: { width: number; height: number };
      pageOverflow: boolean;
      dialogOverflow: boolean;
      dialog: Rect;
      close: Rect;
      content: Rect;
      image: { rect: Rect; objectFit: string } | null;
      model: { viewport: Rect; clientWidth: number; clientHeight: number; canvas: Rect; pixelWidth: number; pixelHeight: number; ratio: number } | null;
    };
    const viewportRect: Rect = { left: 0, top: 0, right: report.viewport.width, bottom: report.viewport.height, width: report.viewport.width, height: report.viewport.height };
    assertEqual(Math.round(report.viewport.width), width, `${kind} dialog visual viewport width`);
    assertEqual(Math.round(report.viewport.height), height, `${kind} dialog visual viewport height`);
    assertEqual(report.modal, true, `${kind} dialog is in the native modal top layer`);
    assertEqual(/^(?:Footprint preview for|Interactive 3D view of) /u.test(report.accessibleName ?? ""), true, `${kind} dialog has a media-specific aria-label`);
    assertEqual(report.hasVisibleTitleReference, false, `${kind} dialog does not reference a removed visible title`);
    assertEqual(report.closeLabel?.startsWith("Close enlarged ") ?? false, true, `${kind} dialog icon close has an accessible name`);
    assertEqual(report.closeVisibleText, "", `${kind} dialog close control has no visible text`);
    assertEqual(report.closeIconHidden, true, `${kind} dialog close icon is decorative`);
    assertEqual(report.visibleCopy.length, 0, `${kind} dialog contains no visible captions, status, instructions, or caveats`);
    assertEqual(report.forbiddenVisibleContent, false, `${kind} dialog excludes visible titles, captions, and package notices`);
    assertEqual(report.statusVisuallyHidden, true, `${kind} dialog keeps model status nonvisual`);
    assertEqual(await evaluate(cdp, `document.querySelectorAll('dialog[open]').length`), 1, `${kind} dialog is the only active modal`);
    assertEqual(report.pageOverflow, false, `${kind} dialog causes no page overflow`);
    assertEqual(report.dialogOverflow, false, `${kind} dialog causes no internal horizontal overflow`);
    assertEqual(await evaluate(cdp, `getComputedStyle(document.documentElement).overflowY`), "hidden", `${kind} dialog locks background scrolling`);
    const scrollY = await evaluate(cdp, "window.scrollY");
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 0, y: Math.round(height / 2), deltaX: 0, deltaY: 600 });
    await delay(100);
    assertEqual(Math.round((await evaluate(cdp, "window.scrollY")) as number), Math.round(scrollY as number), `${kind} backdrop wheel leaves page scroll unchanged`);
    assertContained(report.dialog, viewportRect, `${kind} dialog at ${width}x${height}`);
    assertContained(report.close, viewportRect, `${kind} close control at ${width}x${height}`);
    assertContained(report.content, report.dialog, `${kind} dialog content at ${width}x${height}`);
    assertEqual(report.close.width >= 44 && report.close.height >= 44, true, `${kind} dialog close target is at least 44px`);
    if (kind === "footprint") {
      assertEqual(report.image?.objectFit, "contain", "enlarged footprint uses contain sizing");
      assertEqual((report.image?.rect.height ?? 0) > 0, true, "enlarged footprint media is present");
      assertContained(report.image!.rect, report.content, `enlarged footprint at ${width}x${height}`);
    } else {
      assertEqual(report.model !== null, true, "enlarged model has a live canvas");
      const model = report.model!;
      assertContained(model.viewport, report.content, `enlarged model viewport at ${width}x${height}`);
      assertContained(model.canvas, model.viewport, `enlarged model canvas at ${width}x${height}`);
      if (height > width) {
        assertEqual(model.clientHeight > model.clientWidth, true, "portrait dialog gives the model a portrait viewport");
      }
      assertEqual(
        Math.abs(model.canvas.width / model.canvas.height - model.clientWidth / model.clientHeight) < 0.02,
        true,
        "enlarged model canvas aspect matches its viewport",
      );
      const expectedWidth = model.clientWidth * model.ratio;
      const expectedHeight = model.clientHeight * model.ratio;
      assertEqual(Math.abs(model.pixelWidth - expectedWidth) <= Math.max(4, expectedWidth * 0.01), true, "enlarged model pixel width tracks DPR2 viewport");
      assertEqual(Math.abs(model.pixelHeight - expectedHeight) <= Math.max(4, expectedHeight * 0.01), true, "enlarged model pixel height tracks DPR2 viewport");
    }
    await evaluate(cdp, `document.querySelector(${JSON.stringify(dialogSelector)}).querySelector('.zcd-preview-dialog__close').click()`);
    await waitFor(cdp, `!document.querySelector(${JSON.stringify(dialogSelector)})?.open`);
    if (kind === "model") {
      await waitFor(cdp, `document.querySelectorAll('[data-model-viewer-instance="dialog"]').length === 0`);
    }
    await waitFor(cdp, `document.activeElement === document.querySelector(${JSON.stringify(triggerSelector)})`);
  }
}

export async function exerciseFootprintDialog(cdp: CdpClient, recordPath: string): Promise<void> {
  const triggerSelector = '[data-component-preview-enlarge="footprint"]';
  const dialogSelector = '[data-component-preview-dialog="footprint"]';
  await waitFor(cdp, `getComputedStyle(document.querySelector(${JSON.stringify(triggerSelector)})).display !== 'none'`);
  const trigger = (await evaluate(
    cdp,
    `(() => {
      const element = document.querySelector(${JSON.stringify(triggerSelector)});
      const rect = element.getBoundingClientRect();
      const dialog = document.querySelector(${JSON.stringify(dialogSelector)});
      return { tag: element.tagName, width: rect.width, height: rect.height, label: element.getAttribute('aria-label'), dialogLabel: dialog.getAttribute('aria-label'), labelledBy: dialog.hasAttribute('aria-labelledby') };
    })()`,
  )) as { tag: string; width: number; height: number; label: string; dialogLabel: string; labelledBy: boolean };
  assertEqual(trigger.tag, "BUTTON", "footprint enlarge uses a native button");
  assertEqual(trigger.width >= 44 && trigger.height >= 44, true, "footprint enlarge target is at least 44px");
  assertEqual(trigger.label.startsWith("Enlarge footprint preview"), true, "footprint enlarge has a specific accessible name");
  assertEqual(trigger.dialogLabel.startsWith("Footprint preview for "), true, "footprint dialog has an accessible media label");
  assertEqual(trigger.labelledBy, false, "footprint dialog does not reference a removed title");

  assertEqual(await evaluate(cdp, `document.activeElement !== document.querySelector(${JSON.stringify(triggerSelector)})`), true, "footprint pointer-style activation begins without trigger focus");
  await evaluate(cdp, `document.querySelector(${JSON.stringify(triggerSelector)}).click()`);
  await waitFor(cdp, `document.querySelector(${JSON.stringify(dialogSelector)})?.open`);
  assertEqual(await evaluate(cdp, `document.activeElement === document.querySelector(${JSON.stringify(dialogSelector)}).querySelector('.zcd-preview-dialog__close')`), true, "footprint dialog moves focus to close");
  assertEqual(await evaluate(cdp, `document.querySelector(${JSON.stringify(dialogSelector)}).matches(':modal')`), true, "footprint dialog is modal");
  assertEqual(await evaluate(cdp, `document.querySelector(${JSON.stringify(dialogSelector)}).querySelector('img')?.alt === ''`), true, "enlarged footprint avoids a duplicate visible label");
  const layout = (await evaluate(
    cdp,
    `(() => {
      const content = document.querySelector(${JSON.stringify(dialogSelector)}).querySelector('.zcd-preview-dialog__content');
      const image = content.querySelector(':scope > img');
      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
      };
      return {
        content: rect(content),
        image: rect(image),
        overflow: content.scrollWidth > content.clientWidth + 1 || content.scrollHeight > content.clientHeight + 1,
      };
    })()`,
  )) as { content: Rect; image: Rect; overflow: boolean };
  assertContained(layout.image, layout.content, "desktop enlarged footprint");
  assertEqual(layout.overflow, false, "desktop enlarged footprint has no internal overflow");

  await pressKey(cdp, "Tab", "Tab", 9);
  assertEqual(await evaluate(cdp, `document.querySelector(${JSON.stringify(dialogSelector)}).contains(document.activeElement)`), true, "forward Tab remains in footprint dialog");
  await pressKey(cdp, "Tab", "Tab", 9, 8);
  assertEqual(await evaluate(cdp, `document.querySelector(${JSON.stringify(dialogSelector)}).contains(document.activeElement)`), true, "reverse Tab remains in footprint dialog");

  await pressKey(cdp, "Escape", "Escape", 27);
  await waitFor(cdp, `!document.querySelector(${JSON.stringify(dialogSelector)})?.open && !document.querySelector(${JSON.stringify(dialogSelector)})?.querySelector('img')`);
  assertEqual(await evaluate(cdp, `document.activeElement === document.querySelector(${JSON.stringify(triggerSelector)})`), true, "Escape restores footprint trigger focus");

  await evaluate(cdp, `document.querySelector(${JSON.stringify(triggerSelector)}).click()`);
  await waitFor(cdp, `document.querySelector(${JSON.stringify(dialogSelector)})?.open`);
  await clickAt(cdp, 0, 0);
  await waitFor(cdp, `!document.querySelector(${JSON.stringify(dialogSelector)})?.open && !document.querySelector(${JSON.stringify(dialogSelector)})?.querySelector('img')`);
  assertEqual(await evaluate(cdp, `document.activeElement === document.querySelector(${JSON.stringify(triggerSelector)})`), true, "backdrop close restores footprint trigger focus");

  await evaluate(cdp, `document.querySelector(${JSON.stringify(triggerSelector)}).click()`);
  await waitFor(cdp, `document.querySelector(${JSON.stringify(dialogSelector)})?.open`);
  await evaluate(cdp, `document.querySelector(${JSON.stringify(dialogSelector)}).querySelector('.zcd-preview-dialog__close').click()`);
  await waitFor(cdp, `!document.querySelector(${JSON.stringify(dialogSelector)})?.open && !document.querySelector(${JSON.stringify(dialogSelector)})?.querySelector('img')`);
  assertEqual(await evaluate(cdp, `document.activeElement === document.querySelector(${JSON.stringify(triggerSelector)})`), true, "close button restores footprint trigger focus");
  assertEqual(await evaluate(cdp, `location.pathname === ${JSON.stringify(recordPath)}`), true, "footprint enlarge never navigates to the raw SVG");
}

export async function exerciseModelDialog(cdp: CdpClient): Promise<void> {
  const triggerSelector = '[data-component-preview-enlarge="model"]';
  const dialogSelector = '[data-component-preview-dialog="model"]';
  await waitFor(cdp, `getComputedStyle(document.querySelector(${JSON.stringify(triggerSelector)})).display !== 'none'`);
  const trigger = (await evaluate(
    cdp,
    `(() => {
      const element = document.querySelector(${JSON.stringify(triggerSelector)});
      const rect = element.getBoundingClientRect();
      const dialog = document.querySelector(${JSON.stringify(dialogSelector)});
      return { tag: element.tagName, width: rect.width, height: rect.height, label: element.getAttribute('aria-label'), dialogLabel: dialog.getAttribute('aria-label'), labelledBy: dialog.hasAttribute('aria-labelledby') };
    })()`,
  )) as { tag: string; width: number; height: number; label: string; dialogLabel: string; labelledBy: boolean };
  assertEqual(trigger.tag, "BUTTON", "model enlarge uses a native button");
  assertEqual(trigger.width >= 44 && trigger.height >= 44, true, "model enlarge target is at least 44px");
  assertEqual(trigger.label.startsWith("Enlarge 3D preview"), true, "model enlarge has a specific accessible name");
  assertEqual(trigger.dialogLabel.startsWith("Interactive 3D view of "), true, "model dialog has an accessible media label");
  assertEqual(trigger.labelledBy, false, "model dialog does not reference a removed title");

  assertEqual(await evaluate(cdp, `document.activeElement !== document.querySelector(${JSON.stringify(triggerSelector)})`), true, "model pointer-style activation begins without trigger focus");
  await evaluate(cdp, `document.querySelector(${JSON.stringify(triggerSelector)}).click()`);
  await waitFor(cdp, `document.querySelector(${JSON.stringify(dialogSelector)})?.open`);
  await waitFor(cdp, `document.querySelector('[data-model-viewer-instance="dialog"]')?.dataset.viewerState === 'ready'`, 20_000);
  assertEqual(await evaluate(cdp, `document.querySelectorAll('[data-component-model-viewer-root]').length`), 2, "model dialog mounts one temporary viewer");
  assertEqual(await evaluate(cdp, `document.querySelectorAll('[data-model-viewer-viewport] canvas').length`), 2, "model dialog mounts one temporary canvas");
  assertEqual(await evaluate(cdp, `document.activeElement === document.querySelector(${JSON.stringify(dialogSelector)}).querySelector('.zcd-preview-dialog__close')`), true, "model dialog moves focus to close");

  await exerciseViewerInteractions(cdp, "dialog", false);
  await waitForRenderIdle(cdp, "enlarged model remains render-on-demand idle", "dialog");

  const beforeThemeRender = await renderCount(cdp, "dialog");
  await evaluate(cdp, `document.documentElement.dataset.theme = 'dark'`);
  await waitFor(cdp, `Number(document.querySelector('[data-model-viewer-instance="dialog"]').dataset.renderCount) > ${beforeThemeRender}`);
  await evaluate(cdp, `document.documentElement.dataset.theme = 'light'`);

  await evaluate(
    cdp,
    `
    window.__zcdClosedDialogViewer = document.querySelector('[data-model-viewer-instance="dialog"]');
    window.__zcdClosedDialogCanvas = window.__zcdClosedDialogViewer.querySelector('canvas');
    document.querySelector(${JSON.stringify(dialogSelector)}).querySelector('.zcd-preview-dialog__close').click();
  `,
  );
  await waitFor(cdp, `!document.querySelector(${JSON.stringify(dialogSelector)})?.open`);
  await waitFor(cdp, `window.__zcdClosedDialogViewer?.dataset.viewerDisposed === 'true'`);
  assertEqual(await evaluate(cdp, `document.querySelectorAll('[data-component-model-viewer-root]').length`), 1, "closing model dialog removes temporary viewer");
  assertEqual(await evaluate(cdp, `document.querySelectorAll('[data-model-viewer-viewport] canvas').length`), 1, "closing model dialog removes temporary canvas");
  assertEqual(await evaluate(cdp, `window.__zcdClosedDialogCanvas?.isConnected`), false, "closing model dialog detaches temporary canvas");
  assertEqual(await evaluate(cdp, `document.activeElement === document.querySelector(${JSON.stringify(triggerSelector)})`), true, "closing model dialog restores trigger focus");

  for (let cycle = 1; cycle <= 2; cycle += 1) {
    await evaluate(cdp, `document.querySelector(${JSON.stringify(triggerSelector)}).click()`);
    await waitFor(cdp, `document.querySelector('[data-model-viewer-instance="dialog"]')?.dataset.viewerState === 'ready'`, 20_000);
    await evaluate(
      cdp,
      `
      window.__zcdCycleViewer = document.querySelector('[data-model-viewer-instance="dialog"]');
      document.querySelector(${JSON.stringify(dialogSelector)}).querySelector('.zcd-preview-dialog__close').click();
    `,
    );
    await waitFor(cdp, `window.__zcdCycleViewer?.dataset.viewerDisposed === 'true'`);
    assertEqual(await evaluate(cdp, `document.querySelectorAll('[data-component-model-viewer-root]').length`), 1, `model dialog reopen cycle ${cycle} leaves one viewer`);
    assertEqual(await evaluate(cdp, `document.querySelectorAll('[data-model-viewer-viewport] canvas').length`), 1, `model dialog reopen cycle ${cycle} leaves one canvas`);
  }
}
