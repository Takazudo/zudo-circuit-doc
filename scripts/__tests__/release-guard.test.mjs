import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { assertReleaseTag } from "../lib/release-guard.mjs";

describe("release tag guard", () => {
  test("rejects branch refs", () => {
    assert.throws(
      () => assertReleaseTag({ packageName: "runtime", refType: "branch", refName: "main", version: "1.2.3" }),
      /must be a tag/u,
    );
  });

  test("rejects tags from the other package namespace in both directions", () => {
    assert.throws(
      () => assertReleaseTag({ packageName: "runtime", refType: "tag", refName: "create-zudo-circuit-doc-v1.2.3", version: "1.2.3" }),
      /runtime release namespace/u,
    );
    assert.throws(
      () => assertReleaseTag({ packageName: "initializer", refType: "tag", refName: "v1.2.3", version: "1.2.3" }),
      /initializer release namespace/u,
    );
  });

  test("rejects a tag whose version does not match the package manifest", () => {
    assert.throws(
      () => assertReleaseTag({ packageName: "runtime", refType: "tag", refName: "v1.2.4", version: "1.2.3" }),
      /does not match/u,
    );
  });

  test("rejects prerelease manifest versions and prerelease tags", () => {
    assert.throws(
      () => assertReleaseTag({ packageName: "runtime", refType: "tag", refName: "v1.2.3", version: "1.2.3-rc.1" }),
      /not a stable X\.Y\.Z/u,
    );
    assert.throws(
      () => assertReleaseTag({ packageName: "initializer", refType: "tag", refName: "create-zudo-circuit-doc-v1.2.3-beta.1", version: "1.2.3" }),
      /initializer release namespace/u,
    );
  });

  test("accepts the stable tag for each package", () => {
    assert.deepEqual(
      assertReleaseTag({ packageName: "runtime", refType: "tag", refName: "v1.2.3", version: "1.2.3" }),
      { packageName: "runtime", package: "@takazudo/zudo-circuit-doc", version: "1.2.3", tag: "v1.2.3" },
    );
    assert.deepEqual(
      assertReleaseTag({ packageName: "initializer", refType: "tag", refName: "create-zudo-circuit-doc-v1.2.3", version: "1.2.3" }),
      { packageName: "initializer", package: "create-zudo-circuit-doc", version: "1.2.3", tag: "create-zudo-circuit-doc-v1.2.3" },
    );
  });
});
