import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ALLOWED_COMPONENT_ATTRIBUTES } from "../../src/core/mdx.ts";
import { bundleForSsr } from "./bundle.ts";

/** Shipped globally by @takazudo/zudo-doc, so the host never binds it. */
const ZUDO_DOC_GLOBAL_COMPONENTS: readonly string[] = ["CategoryNav"];

const { circuitDocMdxExtras } = await bundleForSsr<typeof import("../../src/mdx-extras.ts")>("src/mdx-extras.ts");

describe("circuitDocMdxExtras", () => {
  it("binds exactly the generator allow-list minus zudo-doc globals", () => {
    const expected = Object.keys(ALLOWED_COMPONENT_ATTRIBUTES)
      .filter((name) => !ZUDO_DOC_GLOBAL_COMPONENTS.includes(name))
      .sort();
    assert.deepEqual(Object.keys(circuitDocMdxExtras).sort(), expected);
  });

  it("binds each name to the component of that name", () => {
    for (const [name, component] of Object.entries(circuitDocMdxExtras)) {
      assert.equal(typeof component, "function", `${name} is not a component`);
      assert.equal(component.name, name);
    }
  });
});
