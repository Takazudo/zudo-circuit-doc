import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TEST_DIR, "../..");

const WORKFLOWS = [
  {
    file: ".github/workflows/publish-zudo-circuit-doc.yml",
    tag: "v*.*.*",
    guard: "runtime",
    packageDir: "packages/circuit-doc",
    fixture: "pnpm verify:pack --fixture empty",
  },
  {
    file: ".github/workflows/publish-create-zudo-circuit-doc.yml",
    tag: "create-zudo-circuit-doc-v*.*.*",
    guard: "initializer",
    packageDir: "packages/create-zudo-circuit-doc",
    fixture: "pnpm verify:pack --fixture empty --published-runtime",
  },
];

function readWorkflow(file) {
  return readFileSync(join(ROOT, file), "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

describe("npm publish workflows", () => {
  for (const workflow of WORKFLOWS) {
    test(`${workflow.file} has the expected release and safety gates`, () => {
      const source = readWorkflow(workflow.file);
      assert.match(source, new RegExp(`tags:\\s*\\n\\s*- ["']${escapeRegExp(workflow.tag)}["']`, "u"));
      assert.match(source, /^\s*workflow_dispatch:\s*$/mu);
      assert.match(source, new RegExp(`node scripts/lib/release-guard\\.mjs ${workflow.guard}`, "u"));
      assert.match(source, /permissions:\s*\n\s*contents:\s*read\s*\n\s*id-token:\s*write/u);
      assert.match(source, /--provenance/u);
      assert.match(source, /NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/u);
      assert.match(source, new RegExp(`working-directory: ${escapeRegExp(workflow.packageDir)}\\s*\\n`, "u"));
      assert.match(source, /npm stage publish --tag latest --access public --provenance/u);
      assert.doesNotMatch(source, /pnpm [^\n]*\bpublish\b/u);
      assert.ok(source.includes(workflow.fixture), `missing verification command: ${workflow.fixture}`);
      assert.match(source, /git diff --exit-code -- packages\/circuit-doc\/CHANGELOG\.md packages\/create-zudo-circuit-doc\/CHANGELOG\.md/u);
      assert.match(source, /dev-docs\/publishing\.md/u);
    });
  }
});
