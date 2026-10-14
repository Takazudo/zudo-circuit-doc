/**
 * Hold an actual WRL response's text after it has arrived. The held promise
 * deliberately completes after abort: cleanup must cover allocations made
 * before the await and prevent initialization from resuming after unmount.
 */

import { assertEqual } from "../assertions.ts";
import { evaluate, navigate, waitFor, type CdpClient } from "../cdp.ts";
import { pressKey, revealReadyViewer, revealViewer, waitForRenderIdle } from "./interactions.ts";

/** Browser-only instrumentation; exported so its delay and listener audit can be tested without Chrome. */
export const MODEL_LOAD_PROBE = String.raw`(() => {
  const nativeFetch = window.fetch;
  const nativeAdd = EventTarget.prototype.addEventListener;
  const nativeRemove = EventTarget.prototype.removeEventListener;
  const nativeGetRootNode = Node.prototype.getRootNode;
  let canvasRootLookup;
  const capture = (options) => typeof options === 'boolean' ? options : Boolean(options?.capture);
  const probe = window.__zcdLoadProbe = {
    paused: true,
    requests: [],
    listeners: [],
    viewers: [],
    release() {
      this.paused = false;
      for (const request of this.requests) request.release?.();
    },
    remember(instance) {
      const roots = [...document.querySelectorAll('[data-model-viewer-instance="' + instance + '"]')];
      this.viewers = roots.map((root) => {
        const entry = { root, canvas: root.querySelector('canvas'), renders: root.dataset.renderCount ?? '0', lateCanvases: 0 };
        entry.observer = new MutationObserver((records) => {
          for (const record of records) for (const node of record.addedNodes) {
            if (node instanceof Element && (node.matches('canvas') || node.querySelector('canvas'))) entry.lateCanvases += 1;
          }
        });
        entry.observer.observe(root, { childList: true, subtree: true });
        return entry;
      });
    },
    restore() {
      this.release();
      for (const entry of this.viewers) entry.observer.disconnect();
      window.fetch = nativeFetch;
      EventTarget.prototype.addEventListener = nativeAdd;
      EventTarget.prototype.removeEventListener = nativeRemove;
      Node.prototype.getRootNode = nativeGetRootNode;
      delete window.__zcdLoadProbe;
    },
  };
  // Three's pinned OrbitControls obtains its canvas root immediately before
  // registering document controls. Attribute that registration to the canvas,
  // rather than counting document-lifetime shell handlers (e.g. sidebar scroll
  // preservation) as viewer leaks when this probe runs before shell startup.
  Node.prototype.getRootNode = function(...args) {
    const root = nativeGetRootNode.apply(this, args);
    if (this instanceof Element && this.matches('canvas')) {
      const lookup = canvasRootLookup = { root };
      queueMicrotask(() => { if (canvasRootLookup === lookup) canvasRootLookup = undefined; });
    }
    return root;
  };
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    const viewerTarget = this instanceof Element && (
      this.matches('canvas, [data-model-viewer-viewport]')
    );
    // OrbitControls also installs a capturing keydown listener on the canvas's
    // original document. Track its removal even if the canvas becomes detached.
    const documentTarget = this === document && canvasRootLookup?.root === this && type === 'keydown' && capture(options);
    if (documentTarget) canvasRootLookup = undefined;
    if (listener && (viewerTarget || documentTarget)) {
      const duplicate = probe.listeners.some((entry) => entry.active && entry.target === this && entry.type === type && entry.listener === listener && entry.capture === capture(options));
      if (!duplicate) probe.listeners.push({ target: this, type, listener, capture: capture(options), active: true });
    }
    return nativeAdd.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function(type, listener, options) {
    for (const entry of probe.listeners) {
      if (entry.target === this && entry.type === type && entry.listener === listener && entry.capture === capture(options)) entry.active = false;
    }
    return nativeRemove.call(this, type, listener, options);
  };
  window.fetch = async function(input, options) {
    const response = await nativeFetch.call(this, input, options);
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    if (!probe.paused || !url.pathname.endsWith('.wrl')) return response;
    const nativeText = response.text.bind(response);
    response.text = async () => {
      const source = await nativeText();
      const request = { signal: options?.signal ?? input?.signal, released: false };
      const hold = new Promise((resolve) => { request.release = resolve; });
      probe.requests.push(request);
      await hold;
      request.released = true;
      return source;
    };
    return response;
  };
})()`;

async function rememberPausedViewer(cdp: CdpClient, instance: "inline" | "dialog"): Promise<void> {
  await waitFor(cdp, `window.__zcdLoadProbe.requests.length === 1`);
  assertEqual(
    await evaluate(cdp, `document.querySelector('[data-model-viewer-instance="${instance}"]')?.dataset.viewerState`),
    "loading",
    `${instance} initialization is paused before ready`,
  );
  await evaluate(cdp, `window.__zcdLoadProbe.remember(${JSON.stringify(instance)})`);
  assertEqual(await evaluate(cdp, `window.__zcdLoadProbe.viewers.length`), 1, `${instance} delayed viewer exists`);
  assertEqual(await evaluate(cdp, `window.__zcdLoadProbe.viewers[0].canvas?.isConnected`), true, `${instance} allocated canvas before delayed load`);
  assertEqual(
    await evaluate(cdp, `window.__zcdLoadProbe.listeners.some((entry) => entry.active && entry.target === document && entry.type === 'keydown' && entry.capture)`),
    true,
    `${instance} delayed viewer installed document controls`,
  );
}

async function assertDelayedViewerDisposed(cdp: CdpClient, instance: "inline" | "dialog", liveCanvases: number): Promise<void> {
  await waitFor(cdp, `window.__zcdLoadProbe.requests[0].signal?.aborted === true`);
  await waitFor(cdp, `window.__zcdLoadProbe.viewers.every((entry) => !entry.root.isConnected)`);
  assertEqual(await evaluate(cdp, `window.__zcdLoadProbe.listeners.filter((entry) => entry.active).length`), 0, `${instance} abort removes pending controls before the held response completes`);
  assertEqual(await evaluate(cdp, `window.__zcdLoadProbe.viewers.every((entry) => !entry.root.querySelector('canvas'))`), true, `${instance} abort removes pending canvas before the held response completes`);
  await evaluate(cdp, `window.__zcdLoadProbe.release()`);
  await waitFor(cdp, `window.__zcdLoadProbe.requests.every((request) => request.released)`);
  // Let all promise continuations, observers and scheduled rendering complete.
  await evaluate(cdp, `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  assertEqual(await evaluate(cdp, `window.__zcdLoadProbe.listeners.filter((entry) => entry.active).length`), 0, `${instance} pending viewer leaves no control or renderer listeners`);
  assertEqual(
    await evaluate(cdp, `window.__zcdLoadProbe.viewers.every((entry) => !entry.canvas.isConnected && !entry.root.querySelector('canvas') && entry.lateCanvases === 0)`),
    true,
    `${instance} pending viewer leaves no late or retained canvas`,
  );
  assertEqual(
    await evaluate(cdp, `window.__zcdLoadProbe.viewers.every((entry) => entry.root.dataset.viewerDisposed === 'true' && entry.root.dataset.viewerState !== 'ready' && (entry.root.dataset.renderCount ?? '0') === entry.renders)`),
    true,
    `${instance} disposed viewer never becomes ready or renders after delayed response`,
  );
  assertEqual(await evaluate(cdp, `document.querySelectorAll('[data-model-viewer-viewport] canvas').length`), liveCanvases, `${instance} delayed cleanup preserves expected live canvases`);
}

async function exerciseDelayedDialog(cdp: CdpClient): Promise<void> {
  await evaluate(cdp, MODEL_LOAD_PROBE);
  try {
    await evaluate(cdp, `document.querySelector('[data-component-preview-enlarge="model"]').click()`);
    await rememberPausedViewer(cdp, "dialog");
    await pressKey(cdp, "Escape", "Escape", 27);
    await waitFor(cdp, `!document.querySelector('[data-component-preview-dialog="model"]')?.open`);
    await assertDelayedViewerDisposed(cdp, "dialog", 1);

    await evaluate(cdp, `document.querySelector('[data-component-preview-enlarge="model"]').click()`);
    await waitFor(cdp, `document.querySelector('[data-model-viewer-instance="dialog"]')?.dataset.viewerState === 'ready'`, 20_000);
    assertEqual(await evaluate(cdp, `document.querySelectorAll('[data-component-model-viewer-root]').length`), 2, "reopen after pending dialog disposal has exactly inline and fresh dialog viewers");
    assertEqual(await evaluate(cdp, `document.querySelectorAll('[data-model-viewer-viewport] canvas').length`), 2, "reopen after pending dialog disposal has exactly two live canvases");
    assertEqual(await evaluate(cdp, `window.__zcdLoadProbe.viewers[0].root === document.querySelector('[data-model-viewer-instance="dialog"]')`), false, "reopened pending dialog uses a fresh viewer");
    await waitForRenderIdle(cdp, "reopened delayed dialog settles", "dialog");
    await pressKey(cdp, "Escape", "Escape", 27);
    await waitFor(cdp, `document.querySelectorAll('[data-component-model-viewer-root]').length === 1`);
    await waitFor(cdp, `window.__zcdLoadProbe.listeners.every((entry) => !entry.active)`);
    assertEqual(await evaluate(cdp, `document.querySelectorAll('[data-model-viewer-viewport] canvas').length`), 1, "closing reopened dialog leaves exactly the inline canvas");
  } finally {
    await evaluate(cdp, `window.__zcdLoadProbe?.restore()`);
  }
}

async function exerciseDelayedNavigation(cdp: CdpClient, origin: string, recordPath: string, awayRoute: string): Promise<void> {
  const script = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: MODEL_LOAD_PROBE }) as { identifier: string };
  try {
    await navigate(cdp, origin, recordPath);
    await revealViewer(cdp);
    await rememberPausedViewer(cdp, "inline");
    const awayPrefix = awayRoute.replace(/\/$/u, "");
    await evaluate(cdp, `(() => {
      const link = [...document.querySelectorAll('a[href]')].find((candidate) => new URL(candidate.href, location.href).pathname.replace(/\\/$/u, '') === ${JSON.stringify(awayPrefix)});
      if (!link) throw new Error('no away-route link found during pending model load');
      link.click();
    })()`);
    await waitFor(cdp, `location.pathname === ${JSON.stringify(awayPrefix)} || location.pathname === ${JSON.stringify(`${awayPrefix}/`)}`);
    await assertDelayedViewerDisposed(cdp, "inline", 0);

    await evaluate(cdp, "history.back()");
    await waitFor(cdp, `location.pathname === ${JSON.stringify(recordPath)}`);
    await revealReadyViewer(cdp);
    assertEqual(await evaluate(cdp, `window.__zcdLoadProbe.viewers[0].root === document.querySelector('[data-model-viewer-instance="inline"]')`), false, "SPA return after pending load creates a fresh viewer");
    await waitForRenderIdle(cdp, "SPA return after pending model load settles");
  } finally {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier });
    await evaluate(cdp, `window.__zcdLoadProbe?.restore()`);
  }
}

export async function checkDelayedModelCleanup(cdp: CdpClient, origin: string, recordPath: string, awayRoute: string): Promise<void> {
  await exerciseDelayedDialog(cdp);
  await exerciseDelayedNavigation(cdp, origin, recordPath, awayRoute);
}
