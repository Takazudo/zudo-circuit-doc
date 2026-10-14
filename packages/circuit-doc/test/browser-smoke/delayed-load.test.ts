import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { MODEL_LOAD_PROBE } from "../../src/browser-smoke/checks/delayed-load.ts";

type Probe = {
  readonly requests: { readonly signal: AbortSignal; readonly released: boolean }[];
  readonly listeners: { readonly target: EventTarget; readonly active: boolean }[];
  release(): void;
  restore(): void;
};

function installProbe() {
  // Isolate the patched prototype from the test runner's own EventTargets.
  class ProbeEventTarget extends EventTarget {
    override addEventListener(...args: Parameters<EventTarget["addEventListener"]>): void {
      super.addEventListener(...args);
    }
    override removeEventListener(...args: Parameters<EventTarget["removeEventListener"]>): void {
      super.removeEventListener(...args);
    }
  }
  class Node extends ProbeEventTarget {
    getRootNode(): ProbeEventTarget { return document; }
  }
  class Element extends Node {
    matches(): boolean { return true; }
  }
  const document = new ProbeEventTarget();
  const nativeFetch = async () => new Response("#VRML V2.0 utf8");
  const window = { fetch: nativeFetch } as unknown as { fetch: typeof fetch; __zcdLoadProbe: Probe };
  const nativeAdd = ProbeEventTarget.prototype.addEventListener;
  const nativeGetRootNode = Node.prototype.getRootNode;
  runInNewContext(MODEL_LOAD_PROBE, {
    window, document, Element, Node, queueMicrotask, EventTarget: ProbeEventTarget, URL,
    location: { href: "https://example.org/record/" },
  });
  return { window, document, canvas: new Element(), nativeFetch, nativeAdd, nativeGetRootNode, ProbeEventTarget, Node };
}

test("model response stays pending through abort until explicitly released, then returns the real source", async (t) => {
  const { window } = installProbe();
  t.after(() => window.__zcdLoadProbe.restore());
  const abort = new AbortController();
  const response = await window.fetch("/assets/component-previews/models/package.wrl", { signal: abort.signal });
  let settled = false;
  const source = response.text().then((text) => { settled = true; return text; });
  // Wait for actual text reading, rather than assuming how many microtasks it takes.
  while (window.__zcdLoadProbe.requests.length === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  abort.abort();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(window.__zcdLoadProbe.requests[0]?.signal.aborted, true);
  assert.equal(settled, false, "abort must not erase the late-completion race this regression exercises");
  window.__zcdLoadProbe.release();
  assert.equal(await source, "#VRML V2.0 utf8");
  assert.equal(window.__zcdLoadProbe.requests[0]?.released, true);
  assert.equal(await (await window.fetch("/assets/component-previews/models/package.wrl")).text(), "#VRML V2.0 utf8", "reopening is not held again");
  assert.equal(window.__zcdLoadProbe.requests.length, 1);
});

test("non-model responses pass through without a delay", async (t) => {
  const { window } = installProbe();
  t.after(() => window.__zcdLoadProbe.restore());
  assert.equal(await (await window.fetch("/search-index.json")).text(), "#VRML V2.0 utf8");
  assert.equal(window.__zcdLoadProbe.requests.length, 0);
});

test("listener audit catches removal from the wrong target or capture phase and restores instrumentation", () => {
  const { window, document, canvas, nativeFetch, nativeAdd, nativeGetRootNode, ProbeEventTarget, Node } = installProbe();
  const probe = window.__zcdLoadProbe;
  try {
    const control = () => {};
    canvas.getRootNode().addEventListener("keydown", control, { capture: true, passive: true });
    canvas.getRootNode().addEventListener("keydown", control, true);
    assert.equal(probe.listeners.length, 1, "duplicate listener registrations are counted once");
    canvas.removeEventListener("keydown", control, true);
    document.removeEventListener("keydown", control, false);
    assert.equal(probe.listeners[0]?.active, true, "detached canvas or wrong capture removal leaves a document leak");
    document.removeEventListener("keydown", control, { capture: true });
    assert.equal(probe.listeners[0]?.active, false);

    canvas.addEventListener("wheel", control, { passive: false });
    canvas.removeEventListener("wheel", control);
    assert.equal(probe.listeners[1]?.active, false);
    document.addEventListener("click", control);
    assert.equal(probe.listeners.length, 2, "unrelated shell listeners are excluded");
  } finally {
    probe.restore();
  }
  assert.equal(window.fetch, nativeFetch);
  assert.equal(ProbeEventTarget.prototype.addEventListener, nativeAdd);
  assert.equal(Node.prototype.getRootNode, nativeGetRootNode);
  assert.equal(window.__zcdLoadProbe, undefined);
});


test("document-lifetime shell controls are excluded without hiding canvas-root controls", async (t) => {
  const { window, document, canvas } = installProbe();
  t.after(() => window.__zcdLoadProbe.restore());
  const probe = window.__zcdLoadProbe;
  document.addEventListener("keydown", () => {}, true);
  assert.equal(probe.listeners.length, 0, "shell startup does not allocate viewer controls");
  canvas.getRootNode().addEventListener("keydown", () => {}, { capture: true });
  document.addEventListener("keydown", () => {}, true);
  assert.equal(probe.listeners.length, 1, "the root lookup attributes only the viewer registration");
  canvas.getRootNode();
  await Promise.resolve();
  document.addEventListener("keydown", () => {}, true);
  assert.equal(probe.listeners.length, 1, "an unrelated later registration cannot inherit a canvas lookup");
  assert.equal(probe.listeners[0]?.active, true, "an unremoved viewer control remains a detected leak");
});
