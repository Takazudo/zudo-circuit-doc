import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  ReleaseError,
  UncertainStateError,
  assessRuntimeGate,
  changelogHasEntry,
  classifyTagCreate,
  describeGithubWriteFailure,
  parseCoordinatorInputs,
  planCoordinator,
  resolveExistingTag,
  summarizePublisherRuns,
} from "../lib/release-core.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SHA = "1111111111111111111111111111111111111111";
const NEWER = "2222222222222222222222222222222222222222";
const OTHER = "3333333333333333333333333333333333333333";

const GREEN_CI = { ok: true, problems: [], counted: ["CI Core: success"], ignored: [] };

function facts(overrides = {}) {
  return {
    packageName: "runtime",
    version: "0.4.0",
    sha: SHA,
    tag: "v0.4.0",
    mainHead: SHA,
    inMain: true,
    manifestVersion: "0.4.0",
    changelog: { ok: true },
    generatedChangelogHasEntry: true,
    ci: GREEN_CI,
    remoteTag: null,
    registry: { state: "absent" },
    githubRelease: { state: "absent" },
    publisherRuns: [],
    runtimeGate: null,
    ...overrides,
  };
}

const tagAt = (commit) => ({ tagObject: commit, commit, annotated: false });

describe("coordinator inputs", () => {
  test("accept a stable version and a full SHA on main", () => {
    const parsed = parseCoordinatorInputs({ packageName: "initializer", version: "0.2.3", sha: SHA, dryRun: "true", ref: "refs/heads/main" });
    assert.equal(parsed.tag, "create-zudo-circuit-doc-v0.2.3");
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.allowOlderSha, false);
  });

  test("refuse other refs, prerelease or v-prefixed versions, and short SHAs", () => {
    const base = { packageName: "runtime", version: "0.4.0", sha: SHA, ref: "refs/heads/main" };
    assert.throws(() => parseCoordinatorInputs({ ...base, ref: "refs/heads/feature" }), /runs only from main/u);
    assert.throws(() => parseCoordinatorInputs({ ...base, ref: "refs/tags/v0.4.0" }), /runs only from main/u);
    assert.throws(() => parseCoordinatorInputs({ ...base, version: "0.4.0-rc.1" }), /stable/u);
    assert.throws(() => parseCoordinatorInputs({ ...base, version: "v0.4.0" }), /stable/u);
    assert.throws(() => parseCoordinatorInputs({ ...base, sha: SHA.slice(0, 12) }), /40-character/u);
    assert.throws(() => parseCoordinatorInputs({ ...base, sha: "ABCDEF0123456789ABCDEF0123456789ABCDEF01" }), /40-character/u);
    assert.throws(() => parseCoordinatorInputs({ ...base, packageName: "root" }), /Unknown release package/u);
  });

  test("dry_run defaults to false only when not literally true", () => {
    const base = { packageName: "runtime", version: "0.4.0", sha: SHA, ref: "refs/heads/main" };
    assert.equal(parseCoordinatorInputs({ ...base, dryRun: "false" }).dryRun, false);
    assert.equal(parseCoordinatorInputs({ ...base, dryRun: "TRUE" }).dryRun, true);
  });
});

describe("coordinator plan: new release", () => {
  test("verified main HEAD with npm absent creates the tag, then dispatches at the tag", () => {
    const plan = planCoordinator(facts());
    assert.equal(plan.action, "create-tag");
    assert.equal(plan.dispatchRef, "v0.4.0");
    assert.equal(plan.workflow, "publish-zudo-circuit-doc.yml");
  });

  test("never swaps in a newer main silently; allow_older_sha is explicit", () => {
    assert.throws(() => planCoordinator(facts({ mainHead: NEWER })), (error) => {
      assert.match(error.message, /main has moved to 2{40}/u);
      assert.match(error.message, /never swaps the candidate silently/u);
      return true;
    });
    assert.equal(planCoordinator(facts({ mainHead: NEWER, allowOlderSha: true })).sha, SHA);
  });

  test("refuses a SHA outside main", () => {
    assert.throws(() => planCoordinator(facts({ inMain: false })), /not on main/u);
  });

  test("refuses stale, pending or failed CI", () => {
    const red = { ok: false, problems: ["CI Core concluded failure"], counted: [], ignored: [] };
    assert.throws(() => planCoordinator(facts({ ci: red })), /CI on 1{40} is not green: CI Core concluded failure/u);
    const none = { ok: false, problems: [`no push-event workflow runs found for ${SHA}`], counted: [], ignored: [] };
    assert.throws(() => planCoordinator(facts({ ci: none })), /no push-event workflow runs/u);
  });

  test("refuses a manifest version mismatch, including package mix-ups", () => {
    assert.throws(() => planCoordinator(facts({ manifestVersion: "0.3.1" })), /packages\/circuit-doc\/package\.json at 1{40} is "0\.3\.1", not 0\.4\.0/u);
    // Asking the initializer coordinator for the runtime's version reads the initializer manifest.
    assert.throws(
      () => planCoordinator(facts({ packageName: "initializer", tag: "create-zudo-circuit-doc-v0.4.0", manifestVersion: "0.2.3" })),
      /packages\/create-zudo-circuit-doc\/package\.json/u,
    );
    // A tag from the other namespace never matches the package.
    assert.throws(() => planCoordinator(facts({ packageName: "initializer", tag: "v0.4.0" })), /not the initializer tag/u);
  });

  test("refuses an unfinished changelog or a missing generated CHANGELOG entry", () => {
    assert.throws(() => planCoordinator(facts({ changelog: { ok: false, problem: "Changelog page is still marked unreleased." } })), /unreleased/u);
    assert.throws(() => planCoordinator(facts({ generatedChangelogHasEntry: false })), /CHANGELOG\.md .* no dated/u);
  });

  test("uncertain npm or GitHub Release state stops without action", () => {
    assert.throws(() => planCoordinator(facts({ registry: { state: "uncertain", reason: "HTTP 503" } })), UncertainStateError);
    assert.throws(() => planCoordinator(facts({ githubRelease: { state: "uncertain", reason: "HTTP 502" } })), UncertainStateError);
  });

  test("npm present or a Release present without the tag is inconsistent history", () => {
    assert.throws(() => planCoordinator(facts({ registry: { state: "present" } })), /on npm but v0\.4\.0 is missing/u);
    assert.throws(() => planCoordinator(facts({ githubRelease: { state: "present" } })), /GitHub Release for v0\.4\.0 exists without the tag/u);
  });
});

describe("coordinator plan: existing tag", () => {
  test("a tag at another SHA is refused and never moved", () => {
    assert.throws(() => planCoordinator(facts({ remoteTag: tagAt(OTHER) })), (error) => {
      assert.ok(error instanceof ReleaseError);
      assert.match(error.message, /already exists at 3{40}, not the requested 1{40}/u);
      assert.match(error.message, /never moved/u);
      return true;
    });
  });

  test("resume keeps the original SHA even after main moved", () => {
    const plan = planCoordinator(facts({ remoteTag: tagAt(SHA), mainHead: NEWER }));
    assert.equal(plan.action, "dispatch-publish");
    assert.equal(plan.dispatchRef, "v0.4.0");
    assert.equal(plan.sha, SHA);
  });

  test("npm present and Release missing dispatches finalize-only at main", () => {
    const plan = planCoordinator(facts({ remoteTag: tagAt(SHA), registry: { state: "present" } }));
    assert.equal(plan.action, "dispatch-finalize");
    assert.equal(plan.dispatchRef, "main");
  });

  test("finalize-only does not depend on CI or the runtime gate", () => {
    const plan = planCoordinator(
      facts({
        remoteTag: tagAt(SHA),
        registry: { state: "present" },
        ci: { ok: false, problems: ["expired"], counted: [], ignored: [] },
        runtimeGate: { ok: false, problems: ["x"] },
      }),
    );
    assert.equal(plan.action, "dispatch-finalize");
  });

  test("everything present is complete (resubmitting is a no-op)", () => {
    const plan = planCoordinator(facts({ remoteTag: tagAt(SHA), registry: { state: "present" }, githubRelease: { state: "present" } }));
    assert.equal(plan.action, "complete");
  });

  test("a publisher run in flight means wait, not another dispatch", () => {
    const runs = [{ url: "https://example/run/1", status: "in_progress", conclusion: null, publishJob: null }];
    assert.equal(planCoordinator(facts({ remoteTag: tagAt(SHA), publisherRuns: runs })).action, "wait");
  });

  test("a failed run whose publish job succeeded is not treated as unpublished (0.3.1 lesson)", () => {
    const runs = [{ url: "https://example/run/2", status: "completed", conclusion: "failure", publishJob: { conclusion: "success" } }];
    const plan = planCoordinator(facts({ remoteTag: tagAt(SHA), publisherRuns: runs }));
    assert.equal(plan.action, "wait");
    assert.match(plan.reason, /Never republish/u);
  });

  test("a failed run that never published, with npm definitely absent, is redispatched at the tag", () => {
    const runs = [{ url: "https://example/run/3", status: "completed", conclusion: "failure", publishJob: { conclusion: "failure" } }];
    assert.equal(planCoordinator(facts({ remoteTag: tagAt(SHA), publisherRuns: runs })).action, "dispatch-publish");
    const skipped = [{ url: "https://example/run/4", status: "completed", conclusion: "failure", publishJob: { conclusion: "skipped" } }];
    assert.equal(planCoordinator(facts({ remoteTag: tagAt(SHA), publisherRuns: skipped })).action, "dispatch-publish");
  });

  test("resumed publish still requires green CI and npm certainty", () => {
    assert.throws(
      () => planCoordinator(facts({ remoteTag: tagAt(SHA), ci: { ok: false, problems: ["CI Core is in_progress"], counted: [], ignored: [] } })),
      /not green/u,
    );
    assert.throws(() => planCoordinator(facts({ remoteTag: tagAt(SHA), registry: { state: "uncertain", reason: "timeout" } })), UncertainStateError);
  });
});

describe("initializer published-runtime gate", () => {
  const present = { state: "present" };
  const runtimeTag = tagAt(OTHER);

  test("passes only when the runtime it was prepared with is fully released", () => {
    const gate = assessRuntimeGate({ runtimeVersion: "0.4.0", templateRange: "^0.4.0", remoteTag: runtimeTag, registry: present, githubRelease: present });
    assert.deepEqual(gate, { ok: true, problems: [] });
  });

  test("blocks before the runtime is on npm, tagged and released", () => {
    const gate = assessRuntimeGate({
      runtimeVersion: "0.4.0",
      templateRange: "^0.4.0",
      remoteTag: null,
      registry: { state: "absent" },
      githubRelease: { state: "absent" },
    });
    assert.equal(gate.ok, false);
    assert.equal(gate.problems.length, 3);
    const plan = () =>
      planCoordinator(facts({ packageName: "initializer", version: "0.2.3", tag: "create-zudo-circuit-doc-v0.2.3", manifestVersion: "0.2.3", runtimeGate: gate }));
    assert.throws(plan, /Initializer gate: runtime 0\.4\.0 is not on npm yet/u);
  });

  test("blocks a template range that does not match the runtime manifest", () => {
    const gate = assessRuntimeGate({ runtimeVersion: "0.4.0", templateRange: "^0.3.1", remoteTag: runtimeTag, registry: present, githubRelease: present });
    assert.equal(gate.ok, false);
    assert.match(gate.problems[0], /selects runtime "\^0\.3\.1", not \^0\.4\.0/u);
    const exact = assessRuntimeGate({ runtimeVersion: "0.4.0", templateRange: "0.4.0", remoteTag: runtimeTag, registry: present, githubRelease: present });
    assert.equal(exact.ok, false);
  });

  test("uncertain runtime state stops instead of guessing", () => {
    assert.throws(
      () => assessRuntimeGate({ runtimeVersion: "0.4.0", templateRange: "^0.4.0", remoteTag: runtimeTag, registry: { state: "uncertain", reason: "x" }, githubRelease: present }),
      UncertainStateError,
    );
  });
});

describe("tag creation and diagnostics", () => {
  test("classifies the refs API answer", () => {
    assert.deepEqual(classifyTagCreate({ status: 201, body: {} }), { outcome: "created" });
    assert.deepEqual(classifyTagCreate({ status: 422, body: { message: "Reference already exists" } }), { outcome: "exists" });
    assert.equal(classifyTagCreate({ status: 403, body: { message: "Resource not accessible by integration" } }).outcome, "failed");
    assert.equal(classifyTagCreate({ status: 422, body: { message: "Repository rule violations found" } }).outcome, "failed");
  });

  test("an existing tag at the same SHA resumes; another SHA is refused", () => {
    assert.deepEqual(resolveExistingTag({ tag: "v0.4.0", sha: SHA, remoteTag: tagAt(SHA) }), { outcome: "resumed" });
    assert.throws(() => resolveExistingTag({ tag: "v0.4.0", sha: SHA, remoteTag: tagAt(OTHER) }), /refusing/u);
    assert.throws(() => resolveExistingTag({ tag: "v0.4.0", sha: SHA, remoteTag: null }), UncertainStateError);
  });

  test("a 403 is reported with GitHub's own words, permissions and candidate facts, without asserting a cause", () => {
    const lines = describeGithubWriteFailure({
      operation: "Create v0.4.0",
      status: 403,
      body: { message: "Resource not accessible by integration", documentation_url: "https://docs.github.com/rest/git/refs#create-a-reference" },
      headers: { "x-accepted-github-permissions": "contents=write", "x-github-request-id": "ABC:123" },
      declaredPermissions: "contents: write",
      sha: SHA,
      mainHead: NEWER,
      workflowDiff: [".github/workflows/publish-zudo-circuit-doc.yml"],
    });
    const text = lines.join("\n");
    assert.match(text, /HTTP 403/u);
    assert.match(text, /GitHub message: Resource not accessible by integration/u);
    assert.match(text, /Documentation: https:\/\/docs\.github\.com/u);
    assert.match(text, /accepts these token permissions for this call: contents=write/u);
    assert.match(text, /request id: ABC:123/u);
    assert.match(text, /declared GITHUB_TOKEN permissions: contents: write/u);
    assert.match(text, /main HEAD is 2{40}/u);
    assert.match(text, /differ between the candidate and main HEAD: \.github\/workflows\/publish-zudo-circuit-doc\.yml/u);
    assert.match(text, /Cause not determined/u);
    assert.match(text, /never retries with another credential/u);
  });

  test("a dispatch failure without a response still says so", () => {
    assert.match(describeGithubWriteFailure({ operation: "Dispatch", status: null, body: null }).join("\n"), /HTTP no response/u);
  });
});

describe("publisher run reconciliation", () => {
  test("separates active runs from runs that already published", () => {
    const summary = summarizePublisherRuns([
      { status: "queued", publishJob: null },
      { status: "completed", conclusion: "failure", publishJob: { conclusion: "success" } },
      { status: "completed", conclusion: "failure", publishJob: { conclusion: "failure" } },
      { status: "completed", conclusion: "success", publishJob: null },
    ]);
    assert.equal(summary.active.length, 1);
    assert.equal(summary.published.length, 1);
    assert.equal(summary.total, 4);
  });
});

describe("generated changelog entry", () => {
  test("requires a dated heading for exactly that version", () => {
    const text = "# Changelog\n\n## [0.4.0] - 2026-11-13\n\nBody\n\n## [0.3.1] - 2026-11-12\n";
    assert.equal(changelogHasEntry(text, "0.4.0"), true);
    assert.equal(changelogHasEntry(text, "0.3.1"), true);
    assert.equal(changelogHasEntry(text, "0.4"), false);
    assert.equal(changelogHasEntry("## [0.4.0] - unreleased\n", "0.4.0"), false);
    assert.equal(changelogHasEntry(null, "0.4.0"), false);
    assert.equal(changelogHasEntry(readFileSync(join(ROOT, "packages/circuit-doc/CHANGELOG.md"), "utf8"), "0.3.1"), true);
  });
});

// ---------------------------------------------------------------- workflow shape

function stripComments(source) {
  return source.replace(/^\s*#.*\n/gmu, "");
}

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

describe("release-coordinator.yml", () => {
  const source = readFileSync(join(ROOT, ".github/workflows/release-coordinator.yml"), "utf8");
  const { preamble, jobs } = parseJobs(source);

  test("is manual only, with the documented inputs and a safe dry-run default", () => {
    assert.match(preamble, /^on:\s*\n\s+workflow_dispatch:/mu);
    assert.doesNotMatch(preamble, /^\s+(push|pull_request|schedule|workflow_run|release):/mu);
    for (const input of ["package", "version", "sha", "dry_run", "allow_older_sha"]) {
      assert.match(preamble, new RegExp(`^ {6}${input}:`, "mu"), `missing input ${input}`);
    }
    assert.match(preamble, /dry_run:\s*\n(?:\s+.*\n)*?\s+default: true/u);
    assert.match(preamble, /allow_older_sha:\s*\n(?:\s+.*\n)*?\s+default: false/u);
    assert.match(preamble, /options:\s*\n\s+- runtime\n\s+- initializer/u);
    assert.match(preamble, /group: release-coordinator-\$\{\{ inputs\.package \}\}/u);
    assert.match(preamble, /cancel-in-progress: false/u);
  });

  test("grants least privilege per job and never an id-token or npm credential", () => {
    assert.match(preamble, /^permissions: \{\}\s*$/mu);
    assert.deepEqual(Object.keys(jobs).sort(), ["dispatch", "plan", "tag"]);
    assert.deepEqual(jobPermissions(jobs.plan), { contents: "read", actions: "read" });
    assert.deepEqual(jobPermissions(jobs.tag), { contents: "write" });
    assert.deepEqual(jobPermissions(jobs.dispatch), { actions: "write", contents: "read" });
    const code = stripComments(source);
    assert.doesNotMatch(code, /id-token|NPM_TOKEN|NODE_AUTH_TOKEN|_authToken|secrets\.|registry-url:/u);
    assert.doesNotMatch(code, /npm publish|pnpm publish|git push|gh release/u);
    for (const [name, text] of Object.entries(jobs)) {
      assert.match(text, /persist-credentials: false/u, `${name} must not persist checkout credentials`);
      assert.match(text, /GH_TOKEN: \$\{\{ github\.token \}\}/u, `${name} uses only the run's GITHUB_TOKEN`);
    }
  });

  test("dry-run and non-acting plans stop after plan", () => {
    assert.match(jobs.plan, /node scripts\/release\.mjs coordinate-plan\n/u);
    assert.match(jobs.plan, /INPUT_DRY_RUN: \$\{\{ inputs\.dry_run \}\}/u);
    assert.match(jobs.tag, /if: needs\.plan\.outputs\.act == 'true' && needs\.plan\.outputs\.action == 'create-tag'/u);
    assert.match(jobs.dispatch, /needs\.plan\.outputs\.act == 'true'/u);
    assert.match(jobs.dispatch, /needs\.tag\.result == 'success' \|\| \(needs\.tag\.result == 'skipped' && needs\.plan\.outputs\.action != 'create-tag'\)/u);
  });

  test("tags the planned SHA and dispatches the publisher explicitly", () => {
    assert.match(jobs.tag, /coordinate-tag --package "\$PACKAGE" --tag "\$TAG" --sha "\$SHA"/u);
    assert.match(jobs.tag, /SHA: \$\{\{ needs\.plan\.outputs\.sha \}\}/u);
    assert.match(jobs.dispatch, /coordinate-dispatch --package "\$PACKAGE"\s+--tag "\$TAG" --sha "\$SHA" --ref "\$DISPATCH_REF"/u);
  });

  test("pins every action to a full commit SHA", () => {
    const uses = [...source.matchAll(/uses: ([^@\s]+)@(\S+)/gu)];
    assert.ok(uses.length >= 6);
    for (const [, action, ref] of uses) assert.match(ref, /^[0-9a-f]{40}$/u, `${action} is not SHA-pinned`);
  });

  test("the publish workflows keep the job name the coordinator reconciles on", () => {
    for (const file of ["publish-zudo-circuit-doc.yml", "publish-create-zudo-circuit-doc.yml"]) {
      assert.match(readFileSync(join(ROOT, ".github/workflows", file), "utf8"), /name: Publish with OIDC\n/u);
    }
  });
});
