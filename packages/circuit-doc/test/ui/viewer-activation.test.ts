import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activateModelViewer } from "../../src/islands/viewer-activation.ts";
import type { ModelViewerDescriptor } from "../../src/core/model-descriptor.ts";

type ViewerRuntime = Pick<typeof import("../../src/islands/viewer-runtime.ts"), "mountModelViewer">;

const descriptor: ModelViewerDescriptor = {
  version: 1, packageId: "fixture", packageLabel: "fixture",
  modelUrl: "/assets/component-previews/models/fixture.wrl",
  offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function surface() {
  const status = { textContent: "" };
  const root = { dataset: {}, querySelector: () => status } as unknown as HTMLElement;
  return { root, status };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("scoped viewer activation", () => {
  it("does not mount when dialog close or navigation disposes a pending import", async () => {
    const { root, status } = surface();
    let mounts = 0;
    const runtime = deferred<ViewerRuntime>();
    const dispose = activateModelViewer(root, descriptor, () => runtime.promise);
    dispose();
    runtime.resolve({ mountModelViewer: async () => { mounts += 1; return { dispose() {} }; } });
    await settle();
    assert.equal(mounts, 0);
    assert.equal(root.dataset.viewerState, "loading");
    assert.equal(status.textContent, "Loading interactive package model…");
  });

  it("aborts loading immediately and disposes a late mounted result", async () => {
    const { root } = surface();
    const mounted = deferred<{ dispose(): void }>();
    let mountSignal: AbortSignal | undefined;
    let releases = 0;
    const dispose = activateModelViewer(root, descriptor, async () => ({
      mountModelViewer: (_root, _descriptor, signal) => { mountSignal = signal; return mounted.promise; },
    }));
    await settle();
    assert.equal(mountSignal?.aborted, false);
    dispose();
    assert.equal(mountSignal?.aborted, true);
    mounted.resolve({ dispose() { releases += 1; } });
    await settle();
    assert.equal(releases, 1);
  });

  it("releases a mounted viewer once on scope cleanup", async () => {
    const { root } = surface();
    let releases = 0;
    const dispose = activateModelViewer(root, descriptor, async () => ({
      mountModelViewer: async () => ({ dispose() { releases += 1; } }),
    }));
    await settle();
    dispose();
    dispose();
    assert.equal(releases, 1);
  });

  it("keeps the meaningful fallback on live load failure", async () => {
    const { root, status } = surface();
    activateModelViewer(root, descriptor, async () => { throw new Error("import failed"); });
    await settle();
    assert.equal(root.dataset.viewerState, "error");
    assert.match(status.textContent, /package reference on this page is still available/u);
  });
});
