import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readPackageVersion } from "../src/version.ts";

test("readPackageVersion equals package.json's version", () => {
  const packageJsonPath = path.join(fileURLToPath(new URL("..", import.meta.url)), "package.json");
  const expected = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).version;
  assert.equal(readPackageVersion(import.meta.url), expected);
});
