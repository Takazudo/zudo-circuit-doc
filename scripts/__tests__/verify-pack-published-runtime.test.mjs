import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyPublishedRuntimeProbe,
  parseVerifyPackArgs,
  versionSatisfiesCaretRange,
} from "../verify-pack.mjs";

test("verify-pack args default to local empty mode and parse published mode", () => {
  assert.deepEqual(parseVerifyPackArgs([]), { keep: false, fixture: "empty", publishedRuntime: false });
  assert.deepEqual(parseVerifyPackArgs(["--published-runtime"]), { keep: false, fixture: "empty", publishedRuntime: true });
  assert.deepEqual(parseVerifyPackArgs(["--fixture", "empty", "--published-runtime", "--keep"]), {
    keep: true,
    fixture: "empty",
    publishedRuntime: true,
  });
});

test("--published-runtime rejects non-empty fixtures as a usage error", () => {
  assert.throws(() => parseVerifyPackArgs(["--fixture", "minimal", "--published-runtime"]), /only valid with --fixture empty/u);
  assert.throws(() => parseVerifyPackArgs(["--fixture", "led", "--published-runtime"]), /only valid with --fixture empty/u);
});

test("published runtime probe distinguishes found, absent, and inconclusive registry results", () => {
  assert.deepEqual(
    classifyPublishedRuntimeProbe({ status: 0, stdout: '["0.1.0","0.1.2"]', stderr: "" }, "^0.1.0"),
    { verdict: "found", versions: ["0.1.0", "0.1.2"] },
  );
  assert.equal(
    classifyPublishedRuntimeProbe({ status: 1, stdout: "", stderr: "npm error code E404" }, "^0.1.0").verdict,
    "not-published",
  );
  assert.equal(classifyPublishedRuntimeProbe({ status: 0, stdout: "[]", stderr: "" }, "^0.1.0").verdict, "not-published");
  assert.equal(
    classifyPublishedRuntimeProbe({ status: 1, stdout: "", stderr: "npm error code E401" }, "^0.1.0").verdict,
    "inconclusive",
  );
  assert.equal(
    classifyPublishedRuntimeProbe({ status: null, stdout: "", stderr: "", timedOut: true, timeoutMs: 20000 }, "^0.1.0").verdict,
    "inconclusive",
  );
  assert.equal(
    classifyPublishedRuntimeProbe({ status: 1, stdout: "", stderr: "npm error code ECONNRESET" }, "^0.1.0").verdict,
    "inconclusive",
  );
});

test("caret range check accepts allowed patches and rejects versions outside the range", () => {
  assert.equal(versionSatisfiesCaretRange("0.1.0", "^0.1.0"), true);
  assert.equal(versionSatisfiesCaretRange("0.1.9", "^0.1.0"), true);
  assert.equal(versionSatisfiesCaretRange("0.2.0", "^0.1.0"), false);
  assert.equal(versionSatisfiesCaretRange("0.0.9", "^0.1.0"), false);
  assert.equal(versionSatisfiesCaretRange("0.1.1-beta.1", "^0.1.0"), false);
  assert.equal(versionSatisfiesCaretRange("not-a-version", "^0.1.0"), false);
});
