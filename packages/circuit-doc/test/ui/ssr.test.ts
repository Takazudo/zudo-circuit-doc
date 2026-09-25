import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createComponentReferencesDescriptor,
  encodeComponentReferencesDescriptor,
} from "../../src/core/reference-descriptor.ts";
import { bundleForSsr } from "./bundle.ts";

const ui = await bundleForSsr<typeof import("../../src/ui/index.ts")>("src/ui/index.ts");
const { h, renderToString } = ui;

describe("EvidenceFact SSR", () => {
  it("renders all child claims as ordinary visible HTML without interactive markup", () => {
    const html = renderToString(
      h(ui.EvidenceFact, {}, [
        h("p", {}, "Fact: fact-example"),
        h("p", {}, "Conditions: VIN < 40 V"),
        h("p", {}, h("a", { href: "#src-example" }, "src-example: page 1")),
      ]),
    );

    assert.match(html, /^<div class="zcd-evidence-fact">/u);
    assert.match(html, /Fact: fact-example/u);
    assert.match(html, /Conditions: VIN &lt; 40 V/u);
    assert.match(html, /<a href="#src-example">src-example: page 1<\/a>/u);
    assert.doesNotMatch(html, /\b(?:tabindex|role|aria-hidden|hidden|onClick)=/iu);
  });
});

describe("evidence primitives SSR", () => {
  it("anchors, discloses and scroll-contains with zcd- classes", () => {
    assert.equal(
      renderToString(h(ui.EvidenceAnchor, { id: "fact-example" })),
      '<span id="fact-example" aria-hidden="true" class="zcd-evidence-anchor"></span>',
    );
    assert.match(
      renderToString(h(ui.EvidenceDetails, { label: "pin-assignments" }, "rows")),
      /^<details class="zcd-evidence-details"><summary>Pin assignments<\/summary>rows<\/details>$/u,
    );
    assert.match(
      renderToString(h(ui.EvidenceTable, { label: "parts-index" }, "table")),
      /^<div tabindex="0" class="zcd-evidence-table zcd-evidence-table--parts-index">table<\/div>$/u,
    );
    assert.match(
      renderToString(h(ui.EvidenceTable, { label: "Not A Slug" }, "table")),
      /^<div tabindex="0" class="zcd-evidence-table">/u,
    );
  });
});

describe("ComponentReferences SSR markup contract", () => {
  const descriptor = encodeComponentReferencesDescriptor(
    createComponentReferencesDescriptor({
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
    }),
  );
  const html = renderToString(h(ui.ComponentReferences, { descriptor }));

  function attribute(tag: string, name: string): string {
    return new RegExp(`\\b${name}="([^"]*)"`, "u").exec(tag)?.[1] ?? "";
  }

  // Mirrors LED check-built-component-references.mjs:41-112, which the
  // packed-consumer build checks re-assert against real zfb output.
  it("renders one section with the selected document and footprint", () => {
    assert.equal(html.match(/<section\b[^>]*class="zcd-component-references"/gu)?.length, 1);
    assert.match(html, /<p class="zcd-component-references__document-label">Specification PDF<\/p>/u);
    assert.match(
      html,
      /<p class="zcd-component-references__document-title"><a href="https:\/\/example\.invalid\/fixture\.pdf">/u,
    );
    const images = html.match(/<img\b[^>]*\balt="Footprint preview for [^"]+"[^>]*>/gu) ?? [];
    assert.equal(images.length, 1);
    assert.equal(attribute(images[0] ?? "", "src"), "/assets/component-previews/footprints/PKG-FIXTURE.svg");
    assert.ok(html.includes(">Open SVG</a>"));
  });

  it("server-renders both islands inert with their pinned names", () => {
    assert.match(html, /data-footprint-preview-state="no-js"(?:\s|>)/u);
    assert.match(html, /data-zfb-island="FootprintPreviewIsland"(?:\s|>)/u);
    assert.match(html, /data-viewer-state="no-js"(?:\s|>)/u);
    assert.match(html, /data-model-viewer-instance="inline"(?:\s|>)/u);
    assert.match(html, /data-zfb-island="PackageModelViewerIsland"(?:\s|>)/u);
    const models = html.match(/<[^>]+\bdata-model-url="[^"]+"[^>]*>/gu) ?? [];
    assert.deepEqual(models.map((tag) => attribute(tag, "data-model-url")), [
      "/assets/component-previews/models/PKG-FIXTURE.wrl",
    ]);
    assert.match(
      html,
      /Interactive inspection requires JavaScript and WebGL\. The package identity remains available in this page\./u,
    );
  });

  it("renders two enlarge controls and two closed, media-labelled dialogs", () => {
    const triggers = html.match(/<button\b[^>]*\bdata-component-preview-enlarge="[^"]+"[^>]*>/gu) ?? [];
    assert.deepEqual(triggers.map((tag) => attribute(tag, "data-component-preview-enlarge")).sort(), ["footprint", "model"]);
    for (const tag of triggers) {
      assert.match(attribute(tag, "aria-label"), /^Enlarge (?:footprint|3D) preview/u);
      assert.match(attribute(tag, "class"), /^zcd-preview-enlarge-button$/u);
    }

    const dialogs = html.match(/<dialog\b[^>]*\bdata-component-preview-dialog="[^"]+"[^>]*>/gu) ?? [];
    assert.deepEqual(dialogs.map((tag) => attribute(tag, "data-component-preview-dialog")).sort(), ["footprint", "model"]);
    for (const tag of dialogs) {
      assert.doesNotMatch(tag, /\sopen(?:[\s=>]|$)/u, "dialog shells must render closed");
      assert.match(attribute(tag, "aria-label"), /^(?:Footprint preview for|Interactive 3D view of) /u);
      assert.doesNotMatch(tag, /\baria-labelledby=/u);
      assert.match(attribute(tag, "class"), /^zcd-preview-dialog zcd-preview-dialog--(?:footprint|model) z-modal$/u);
    }
    assert.doesNotMatch(html, /__title/u);
  });

  it("uses only zcd- classes plus the zudo-doc safelisted z-modal", () => {
    const classes = [...html.matchAll(/\bclass="([^"]*)"/gu)].flatMap((match) => (match[1] ?? "").split(/\s+/u));
    assert.ok(classes.length > 0);
    for (const name of classes) {
      assert.ok(name.startsWith("zcd-") || name === "z-modal", `unexpected class ${name}`);
    }
  });
});
