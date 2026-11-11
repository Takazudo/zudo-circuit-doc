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
    packageName: "runtime",
    selector: "@takazudo/zudo-circuit-doc",
    gates: [
      "pnpm build",
      "pnpm typecheck",
      "pnpm test",
      "pnpm check:template",
      "pnpm --filter @takazudo/zudo-circuit-doc check:shape",
      "pnpm doc:build",
      "pnpm verify:pack --fixture empty\n",
      "pnpm verify:pack --fixture minimal",
    ],
  },
  {
    file: ".github/workflows/publish-create-zudo-circuit-doc.yml",
    tag: "create-zudo-circuit-doc-v*.*.*",
    packageName: "initializer",
    selector: "create-zudo-circuit-doc",
    gates: [
      "pnpm build",
      "pnpm typecheck",
      "pnpm test",
      "pnpm check:template",
      "pnpm doc:build",
      "pnpm verify:pack --fixture empty --published-runtime",
    ],
  },
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function stripComments(source) {
  return source.replace(/^\s*#.*\n/gmu, "");
}

/** Split a workflow (comments removed) into its preamble and per-job text blocks. */
function parseJobs(source) {
  const [preamble, jobsText = ""] = stripComments(source).split(/^jobs:\s*$/mu);
  const jobs = {};
  let current = null;
  for (const line of jobsText.split("\n")) {
    const header = /^ {2}([a-z][\w-]*):\s*$/u.exec(line);
    if (header) {
      current = header[1];
      jobs[current] = "";
    } else if (current) {
      jobs[current] += `${line}\n`;
    }
  }
  return { preamble, jobs };
}

function jobPermissions(jobText) {
  const match = /^ {4}permissions:\s*\n((?: {6}[\w-]+: \w+\n)+)/mu.exec(jobText);
  if (!match) return null;
  return Object.fromEntries(match[1].trim().split("\n").map((line) => line.trim().split(/:\s*/u)));
}

describe("npm publish workflows", () => {
  for (const workflow of WORKFLOWS) {
    const source = readFileSync(join(ROOT, workflow.file), "utf8");
    const { preamble, jobs } = parseJobs(source);

    test(`${workflow.file} keeps tag-push and exact-tag manual triggers`, () => {
      assert.match(preamble, new RegExp(`tags:\\s*\\n\\s*- ["']${escapeRegExp(workflow.tag)}["']`, "u"));
      assert.match(preamble, /^\s*workflow_dispatch:\s*$/mu);
      assert.match(preamble, /tag:\s*\n(?:\s+.*\n)*?\s+required: true/u);
      assert.match(preamble, /dry_run:\s*\n(?:\s+.*\n)*?\s+type: boolean/u);
      assert.match(preamble, /cancel-in-progress: false/u);
      assert.match(source, /dev-docs\/publishing\.md/u);
    });

    test(`${workflow.file} has no stored npm credential or fallback`, () => {
      const code = stripComments(source);
      assert.doesNotMatch(code, /NPM_TOKEN|NODE_AUTH_TOKEN|_authToken|secrets\./u);
      assert.doesNotMatch(code, /registry-url:/u);
      assert.doesNotMatch(code, /(?<!p)npm (?:stage )?publish/u);
    });

    test(`${workflow.file} scopes permissions per job`, () => {
      assert.match(preamble, /^permissions: \{\}\s*$/mu);
      assert.deepEqual(Object.keys(jobs).sort(), ["admit", "confirm", "finalize", "publish", "verify"]);
      assert.deepEqual(jobPermissions(jobs.admit), { contents: "read" });
      assert.deepEqual(jobPermissions(jobs.verify), { contents: "read" });
      assert.deepEqual(jobPermissions(jobs.publish), { contents: "read", "id-token": "write" });
      assert.deepEqual(jobPermissions(jobs.confirm), { contents: "read" });
      assert.deepEqual(jobPermissions(jobs.finalize), { contents: "write" });
      for (const [name, text] of Object.entries(jobs)) {
        assert.match(text, /persist-credentials: false/u, `${name} must not persist checkout credentials`);
      }
    });

    test(`${workflow.file} admits through the shared helper and binds the tag commit`, () => {
      assert.match(jobs.admit, new RegExp(`node scripts/release\\.mjs admit --package ${workflow.packageName}\\n`, "u"));
      assert.match(jobs.admit, /INPUT_TAG: \$\{\{ inputs\.tag \}\}/u);
      assert.match(jobs.verify, /ref: \$\{\{ needs\.admit\.outputs\.source_sha \}\}/u);
      assert.match(jobs.verify, /test "\$\(git rev-parse HEAD\)" = "\$SOURCE_SHA"/u);
      assert.match(jobs.publish, /ref: \$\{\{ needs\.admit\.outputs\.source_sha \}\}/u);
      assert.match(jobs.publish, /if: needs\.admit\.outputs\.mode == 'publish'/u);
    });

    test(`${workflow.file} runs every release gate before packing`, () => {
      let cursor = 0;
      for (const gate of [...workflow.gates, `pnpm --filter ${workflow.selector} pack`]) {
        const index = jobs.verify.indexOf(gate, cursor);
        assert.ok(index >= 0, `missing or out-of-order gate: ${gate.trim()}`);
        cursor = index;
      }
      assert.match(
        jobs.verify,
        /git diff --exit-code -- packages\/circuit-doc\/CHANGELOG\.md packages\/create-zudo-circuit-doc\/CHANGELOG\.md/u,
      );
      assert.match(jobs.verify, new RegExp(`tarball-info --package ${workflow.packageName}`, "u"));
    });

    test(`${workflow.file} dry-run cannot authenticate or write`, () => {
      assert.match(jobs.verify, /pnpm publish "\$TARBALL" --dry-run/u);
      assert.doesNotMatch(jobs.verify, /id-token/u);
      assert.match(jobs.verify, /Upload verified tarball\n\s+if: needs\.admit\.outputs\.mode == 'publish'/u);
    });

    test(`${workflow.file} publishes only the verified tarball, with OIDC and provenance`, () => {
      assert.doesNotMatch(jobs.publish, /pnpm install|\.\/\.github\/actions\/setup/u);
      assert.match(jobs.publish, /publish-preflight --tarball "\$TARBALL" --integrity "\$INTEGRITY"/u);
      assert.match(jobs.publish, /pnpm publish "\$TARBALL" --tag latest --access public --no-git-checks --provenance/u);
      assert.match(jobs.confirm, new RegExp(`verify-publication --package ${workflow.packageName}`, "u"));
      assert.match(jobs.finalize, new RegExp(`finalize --package ${workflow.packageName}`, "u"));
      assert.match(jobs.finalize, /GH_TOKEN: \$\{\{ github\.token \}\}/u);
      assert.match(jobs.finalize, /needs\.admit\.outputs\.mode == 'finalize'/u);
    });

    test(`${workflow.file} pins every action to a full commit SHA`, () => {
      for (const [, action, ref] of source.matchAll(/uses: ([^@\s]+)@(\S+)/gu)) {
        assert.match(ref, /^[0-9a-f]{40}$/u, `${action} is not SHA-pinned`);
      }
    });
  }
});
