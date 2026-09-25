/**
 * Ported from zudo-led-lamp `doc/component-docs/tests/footprint-previews.test.ts:27-61`
 * ("footprint preview export transforms"): pure text/SVG transforms and the
 * SVG safety allowlist, unaffected by the config-driven refactor.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ComponentDocsError } from "../../src/core/errors.ts";
import { suppressFootprintText } from "../../src/footprint-previews/footprint.ts";
import { normalizeSvg, validateSvg } from "../../src/footprint-previews/svg.ts";

describe("footprint preview export transforms", () => {
  it("suppresses every footprint text form without changing other expressions", () => {
    const source = `(footprint "x"\n  (property "Reference" "REF**" (at 0 0) (effects (font (size 1 1))))\n  (fp_text reference "REF**)" (at 0 0) (effects (font (size 1 1))))\n  (fp_line (start 0 0) (end 1 1))\n  (fp_text user "%R" (at 0 0))\n)`;
    const result = suppressFootprintText(source);
    assert.doesNotMatch(result, /fp_text|property|REF\*\*|%R/u);
    assert.match(result, /\(fp_line \(start 0 0\) \(end 1 1\)\)/u);
    assert.throws(() => suppressFootprintText("(footprint (fp_text user x)"), /unbalanced/u);
  });

  it("removes volatile metadata and emits a finite responsive root", () => {
    const normalized = normalizeSvg(
      `<?xml version="1.0"?><!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" width="2mm" height="3mm" viewBox="0 0 2 3"><title>created date 2099</title><desc>PCBNEW</desc><path d="M0 0 L1 1" /></svg>`,
    );
    assert.doesNotMatch(normalized, /2099|DOCTYPE|<title|<desc|<\?xml/u);
    assert.match(normalized, /viewBox="0\.0000 0\.0000 2\.0000 3\.0000" width="100%" height="100%"/u);
    assert.deepEqual(validateSvg(normalized), { minX: 0, minY: 0, width: 2, height: 3 });
  });

  it("rejects scripts, event handlers, resources, traversal-shaped links, empty geometry, and bad view boxes", () => {
    for (const hostile of [
      `<svg viewBox="0 0 1 1"><script>alert(1)</script><path d="M0 0"/></svg>`,
      `<svg viewBox="0 0 1 1"><path onclick="alert(1)" d="M0 0"/></svg>`,
      `<svg viewBox="0 0 1 1"><path onload=alert(1) d="M0 0"/></svg>`,
      `<svg viewBox="0 0 1 1"><path unexpected="x" d="M0 0"/></svg>`,
      `<svg viewBox="0 0 1 1"><path style="fill:&#117;rl(evil)" d="M0 0"/></svg>`,
      `<svg viewBox="0 0 1 1">unexpected<path d="M0 0"/></svg>`,
      `<svg viewBox="0 0 1 1"><image href="https://evil.invalid/a"/></svg>`,
      `<svg viewBox="0 0 1 1"><use href="../outside.svg#x"/></svg>`,
      `<svg viewBox="0 0 1 1"><g /></svg>`,
      `<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>`,
      `<svg viewBox="0 0 1 1"><g transform="translate(20 0)"><path d="M0 0"/></g></svg>`,
      `<svg viewBox="0 0 1 1"><path d="M0 0 L20 20"/></svg>`,
      `<svg viewBox="0 0 NaN 1"><path d="M0 0"/></svg>`,
      `<svg viewBox="0 0 0 1"><path d="M0 0"/></svg>`,
    ]) {
      assert.throws(() => validateSvg(hostile), (error: unknown) => error instanceof ComponentDocsError && error.code === "PUBLICATION_POLICY");
    }
  });
});
