// Ported from LED doc/component-docs/tests/model-viewer.test.ts: the descriptor
// round-trip (:39-47) and the viewer lifecycle helpers (:85-137). The 35/25
// LED corpus projection and model-asset publication parts stay with the CAD
// pipeline's own tests.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";

import { Object3D } from "three";

import {
  decodeModelDescriptor,
  encodeModelDescriptor,
  MODEL_ASSET_BASE,
  type ModelViewerDescriptor,
} from "../../src/core/descriptors.ts";
import { applyModelTransform, createOnDemandInvalidator, modelFitDistance } from "../../src/islands/viewer-runtime.ts";
import { setViewerState } from "../../src/islands/viewer-state.ts";

const descriptor: ModelViewerDescriptor = {
  version: 1,
  packageId: "TSSOP-20_L6.5-W4.4-P0.65-LS6.4-BL",
  packageLabel: "TSSOP-20_L6.5-W4.4-P0.65-LS6.4-BL",
  modelUrl: `${MODEL_ASSET_BASE}TSSOP-20_L6.5-W4.4-H1.0-LS6.4-P0.65.wrl`,
  offset: { x: 1, y: -2, z: 3 },
  rotation: { x: 10, y: 20, z: 30 },
  scale: { x: 1, y: 2, z: 3 },
};

const originalRaf = globalThis.requestAnimationFrame;
const originalCancel = globalThis.cancelAnimationFrame;

afterEach(() => {
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.cancelAnimationFrame = originalCancel;
});

describe("model viewer descriptor", () => {
  it("serializes deterministically and round-trips only the closed schema", () => {
    const encoded = encodeModelDescriptor(descriptor);
    assert.match(encoded, /^(?:[0-9a-f]{2})+$/u);
    assert.equal(encoded, encodeModelDescriptor(descriptor));
    assert.deepEqual(decodeModelDescriptor(encoded), descriptor);
    assert.throws(() => decodeModelDescriptor("../model.wrl"));
    assert.throws(() => encodeModelDescriptor({ ...descriptor, modelUrl: "https://evil.invalid/model.wrl" }));
  });
});

describe("viewer lifecycle helpers", () => {
  it("fits the sphere against horizontal FOV on portrait viewports", () => {
    const wide = modelFitDistance(1, 35, 16 / 9);
    const square = modelFitDistance(1, 35, 1);
    const portrait = modelFitDistance(1, 35, 390 / 844);
    assert.ok(portrait > square);
    assert.equal(wide, square);
    const horizontalHalfFov = Math.atan(Math.tan(35 * Math.PI / 360) * 390 / 844);
    assert.ok(Math.sin(horizontalHalfFov) * portrait >= 1.25 - 1e-12);
  });
  it("applies offset, degree rotations, and scale without losing non-zero axes", () => {
    const object = new Object3D();
    applyModelTransform(object, descriptor.offset, descriptor.rotation, descriptor.scale);
    assert.deepEqual(object.position.toArray(), [1, -2, 3]);
    assert.ok(Math.abs(object.rotation.x - Math.PI / 18) < 1e-12);
    assert.ok(Math.abs(object.rotation.z - Math.PI / 6) < 1e-12);
    assert.deepEqual(object.scale.toArray(), [1, 2, 3]);
  });

  it("coalesces invalidations and cancels pending work", () => {
    let nextFrame = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    globalThis.requestAnimationFrame = (callback) => {
      nextFrame += 1;
      callbacks.set(nextFrame, callback);
      return nextFrame;
    };
    globalThis.cancelAnimationFrame = (id) => void callbacks.delete(id);
    let renders = 0;
    const invalidator = createOnDemandInvalidator(() => renders += 1);
    invalidator.invalidate();
    invalidator.invalidate();
    assert.equal(callbacks.size, 1);
    const first = callbacks.get(1);
    callbacks.delete(1);
    first?.(0);
    assert.equal(renders, 1);
    invalidator.invalidate();
    invalidator.cancel();
    assert.equal(callbacks.size, 0);
  });

  it("keeps fallback copy meaningful for failure states", () => {
    const status = { textContent: "" } as unknown as Element;
    const root = {
      dataset: {} as DOMStringMap,
      querySelector: () => status,
    };
    setViewerState(root, "unavailable", "WebGL is unavailable. The package identity remains available.");
    assert.equal(root.dataset.viewerState, "unavailable");
    assert.match(status.textContent ?? "", /package identity/u);
  });
});

describe("test-only runtime hooks the browser smoke depends on", () => {
  // #27's browser smoke forces these states; dropping a hook silently turns
  // its failure-path assertions into no-ops.
  it("keeps the forced-failure query params and dataset diagnostics", async () => {
    const runtime = await readFile(new URL("../../src/islands/viewer-runtime.ts", import.meta.url), "utf8");
    assert.match(runtime, /get\("model-viewer-webgl"\) === "fail"/u);
    assert.match(runtime, /get\("model-viewer-model"\) === "fail"/u);
    assert.match(runtime, /root\.dataset\.renderCount = /u);
    assert.match(runtime, /root\.dataset\.viewerDisposed = "true"/u);
  });
});
