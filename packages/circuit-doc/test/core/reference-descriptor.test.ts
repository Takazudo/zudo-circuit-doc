import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createComponentReferencesDescriptor,
  decodeComponentReferencesDescriptor,
  encodeComponentReferencesDescriptor,
  footprintAssetUrl,
} from "../../src/core/reference-descriptor.ts";

const descriptor = createComponentReferencesDescriptor({
  document: {
    label: "Specification PDF",
    title: "Fixture specification",
    authority: "MANUFACTURER_PRIMARY",
    availability: "AVAILABLE",
    url: "https://example.invalid/fixture.pdf",
  },
  footprintName: "PKG-FIXTURE",
  model: {
    version: 1,
    packageId: "PKG-FIXTURE",
    packageLabel: "PKG-FIXTURE",
    modelUrl: "/assets/component-previews/models/PKG-FIXTURE.wrl",
    offset: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  },
});

describe("component references descriptor", () => {
  it("round-trips the reviewed PDF values and local preview paths", () => {
    const encoded = encodeComponentReferencesDescriptor(descriptor);
    assert.deepEqual(decodeComponentReferencesDescriptor(encoded), descriptor);
    assert.equal(footprintAssetUrl("PKG-FIXTURE"), "/assets/component-previews/footprints/PKG-FIXTURE.svg");
  });

  it("rejects an unsafe or mismatched footprint asset path", () => {
    assert.throws(() => footprintAssetUrl("../escape"));
    const altered = {
      ...descriptor,
      footprint: { ...descriptor.footprint, assetUrl: "/assets/component-previews/footprints/other.svg" },
    };
    assert.throws(() => encodeComponentReferencesDescriptor(altered));
  });

  it("rejects a PDF label that was not supplied by the reviewed model", () => {
    const altered = { ...descriptor, document: { ...descriptor.document, label: "Product page" } };
    assert.throws(() => encodeComponentReferencesDescriptor(altered));
  });

  it("rejects non-HTTP(S) and credential-bearing document URLs", () => {
    for (const url of ["javascript:alert(1)", "https://user:password@example.invalid/reference.pdf"]) {
      const altered = { ...descriptor, document: { ...descriptor.document, url } };
      assert.throws(() => encodeComponentReferencesDescriptor(altered));
    }
  });
});
