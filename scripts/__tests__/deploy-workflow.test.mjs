import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const workflow = readFileSync(`${repoRoot}/.github/workflows/main-deploy.yml`, "utf8");
const wrangler = readFileSync(`${repoRoot}/doc/wrangler.toml`, "utf8");
const buildJob = workflow.split("  build-doc:\n")[1]?.split("\n  deploy-doc:")[0];
const deployJob = workflow.split("  deploy-doc:\n")[1];

test("production deploy runs on main pushes and can be started manually", () => {
  assert.match(workflow, /^on:\n  push:\n    branches:\n      - main\n  workflow_dispatch:\s*$/m);
  assert.match(workflow, /group: production-deploy/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test("the doc build fetches history and builds workspace packages before the site", () => {
  assert.ok(buildJob, "expected a build-doc job");
  assert.match(buildJob, /fetch-depth:\s*0/);
  assert.match(buildJob, /run: pnpm build/);
  assert.match(buildJob, /run: pnpm doc:build/);
});

test("deployment uses the pinned Wrangler config and Cloudflare secrets", () => {
  assert.match(workflow, /WRANGLER_VERSION:\s*["']4\.85\.0["']/);
  assert.ok(deployJob, "expected a deploy-doc job");
  assert.ok(deployJob.includes("npx wrangler@${{ env.WRANGLER_VERSION }} deploy --config doc/wrangler.toml"));
  assert.ok(deployJob.includes("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}"));
  assert.ok(deployJob.includes("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}"));
});

test("deployment smoke-checks the homepage, a getting started page, and a missing page", () => {
  assert.ok(deployJob.includes('smoke-url.sh "https://zudo-circuit-doc.zudolab.dev/" 200'));
  assert.ok(deployJob.includes('smoke-url.sh "https://zudo-circuit-doc.zudolab.dev/docs/getting-started/" 200'));
  assert.ok(deployJob.includes('smoke-url.sh "https://zudo-circuit-doc.zudolab.dev/this-page-does-not-exist" 404'));
});

test("Wrangler serves the static doc output and declares its custom domain", () => {
  assert.match(wrangler, /^name = "zudo-circuit-doc"$/m);
  assert.match(wrangler, /^directory = "\.\/dist"$/m);
  assert.match(wrangler, /^not_found_handling = "404-page"$/m);
  assert.match(wrangler, /^pattern = "zudo-circuit-doc\.zudolab\.dev"$/m);
  assert.match(wrangler, /^custom_domain = true$/m);
});
