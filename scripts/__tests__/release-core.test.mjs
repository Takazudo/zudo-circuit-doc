import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ReleaseError,
  UncertainStateError,
  admitRelease,
  changelogToReleaseNotes,
  classifyRegistryResponse,
  evaluateCiRuns,
  evaluatePublication,
  findStoredNpmCredentials,
  inspectPackedManifest,
  integrityToSha512Hex,
  parseReleaseTag,
  peelRemoteTag,
  planGithubRelease,
  planResume,
  resolveRequestedTag,
} from "../lib/release-core.mjs";

const TAG_SHA = "1111111111111111111111111111111111111111";
const MAIN_SHA = "2222222222222222222222222222222222222222";
const TAG_OBJECT = "3333333333333333333333333333333333333333";

function admitInput(overrides = {}) {
  return {
    packageName: "runtime",
    eventName: "push",
    ref: "refs/tags/v1.2.3",
    inputTag: "",
    dryRun: false,
    controlSha: TAG_SHA,
    remoteTag: { tagObject: TAG_SHA, commit: TAG_SHA, annotated: false },
    fetchedTagCommit: TAG_SHA,
    sourceVersion: "1.2.3",
    registry: { state: "absent" },
    ...overrides,
  };
}

describe("tag namespaces", () => {
  test("map each tag to exactly one package", () => {
    assert.deepEqual(parseReleaseTag("v1.2.3"), { packageName: "runtime", version: "1.2.3" });
    assert.deepEqual(parseReleaseTag("create-zudo-circuit-doc-v0.2.1"), { packageName: "initializer", version: "0.2.1" });
    assert.equal(parseReleaseTag("v1.2.3-rc.1"), null);
    assert.equal(parseReleaseTag("main"), null);
  });

  test("ls-remote parsing uses exact ref names and peels annotated tags", () => {
    const output = [
      `${TAG_OBJECT}\trefs/tags/v1.2.3`,
      `${TAG_SHA}\trefs/tags/v1.2.3^{}`,
      `${MAIN_SHA}\trefs/tags/other/refs/tags/v1.2.3`,
    ].join("\n");
    assert.deepEqual(peelRemoteTag(output, "v1.2.3"), { tagObject: TAG_OBJECT, commit: TAG_SHA, annotated: true });
    assert.equal(peelRemoteTag(`${MAIN_SHA}\trefs/tags/other/refs/tags/v1.2.3`, "v1.2.3"), null);
    assert.equal(peelRemoteTag("", "v1.2.3"), null);
  });
});

describe("requested tag", () => {
  test("branch push and branch dispatch without a tag are refused", () => {
    assert.throws(() => resolveRequestedTag({ eventName: "push", ref: "refs/heads/main" }), /must come from a tag ref/u);
    assert.throws(() => resolveRequestedTag({ eventName: "workflow_dispatch", ref: "refs/heads/main", inputTag: " " }), /branch publication is refused/u);
  });

  test("dispatch ref and input must agree when the ref is a tag", () => {
    assert.throws(
      () => resolveRequestedTag({ eventName: "workflow_dispatch", ref: "refs/tags/v1.2.3", inputTag: "v1.2.4" }),
      /name different tags/u,
    );
    assert.equal(resolveRequestedTag({ eventName: "workflow_dispatch", ref: "refs/heads/main", inputTag: "v1.2.3" }), "v1.2.3");
  });
});

describe("release admission", () => {
  test("publishes from a tag push whose control and source commits match", () => {
    const decision = admitRelease(admitInput());
    assert.equal(decision.mode, "publish");
    assert.equal(decision.sourceSha, TAG_SHA);
    assert.equal(decision.version, "1.2.3");
  });

  test("rejects the other package's namespace in both directions", () => {
    assert.throws(() => admitRelease(admitInput({ ref: "refs/tags/create-zudo-circuit-doc-v1.2.3" })), /runtime release namespace/u);
    assert.throws(
      () => admitRelease(admitInput({ packageName: "initializer" })),
      /initializer release namespace/u,
    );
  });

  test("an input labelled as a tag must exist on origin", () => {
    assert.throws(
      () => admitRelease(admitInput({ eventName: "workflow_dispatch", ref: "refs/heads/main", inputTag: "v1.2.3", remoteTag: null })),
      /does not exist as refs\/tags\/v1\.2\.3 on origin/u,
    );
  });

  test("the fetched tag must peel to the commit origin reports", () => {
    assert.throws(() => admitRelease(admitInput({ fetchedTagCommit: MAIN_SHA })), /peels to/u);
  });

  test("the manifest version at the tag commit must match the tag", () => {
    assert.throws(() => admitRelease(admitInput({ sourceVersion: "1.2.4" })), /does not match/u);
    assert.throws(() => admitRelease(admitInput({ sourceVersion: "1.2.3-rc.1" })), /not a stable/u);
  });

  test("main-controlled dispatch of a tag cannot publish (provenance would name the control commit)", () => {
    const input = admitInput({ eventName: "workflow_dispatch", ref: "refs/heads/main", inputTag: "v1.2.3", controlSha: MAIN_SHA });
    assert.throws(() => admitRelease(input), (error) => error instanceof ReleaseError && /provenance would attest the wrong source/u.test(error.message));
  });

  test("main-controlled dispatch may dry-run or finalize, keeping control and source distinct", () => {
    const base = { eventName: "workflow_dispatch", ref: "refs/heads/main", inputTag: "v1.2.3", controlSha: MAIN_SHA };
    const dry = admitRelease(admitInput({ ...base, dryRun: true }));
    assert.equal(dry.mode, "dry-run");
    assert.equal(dry.controlSha, MAIN_SHA);
    assert.equal(dry.sourceSha, TAG_SHA);
    const finalize = admitRelease(admitInput({ ...base, registry: { state: "present" } }));
    assert.equal(finalize.mode, "finalize");
  });

  test("an existing version is never published again", () => {
    assert.equal(admitRelease(admitInput({ registry: { state: "present" } })).mode, "finalize");
  });

  test("registry uncertainty stops admission, even for a dry-run", () => {
    for (const dryRun of [false, true]) {
      assert.throws(
        () => admitRelease(admitInput({ dryRun, registry: { state: "uncertain", reason: "HTTP 503" } })),
        UncertainStateError,
      );
    }
  });
});

describe("registry classification", () => {
  const target = { selector: "@takazudo/zudo-circuit-doc", version: "1.2.3" };

  test("only definite answers are presence or absence", () => {
    assert.equal(classifyRegistryResponse({ status: 200, body: { name: target.selector, version: "1.2.3" } }, target).state, "present");
    assert.equal(classifyRegistryResponse({ status: 404, body: "version not found: 1.2.3" }, target).state, "absent");
    assert.equal(classifyRegistryResponse({ status: 404, body: { error: "Not found" } }, target).state, "absent");
  });

  test("network errors, auth failures and odd answers are uncertain, not absent", () => {
    assert.equal(classifyRegistryResponse({ error: new Error("ETIMEDOUT") }, target).state, "uncertain");
    assert.equal(classifyRegistryResponse({ status: 401, body: {} }, target).state, "uncertain");
    assert.equal(classifyRegistryResponse({ status: 503, body: "" }, target).state, "uncertain");
    assert.equal(classifyRegistryResponse({ status: 404, body: "<html>gateway</html>" }, target).state, "uncertain");
    assert.equal(classifyRegistryResponse({ status: 404, body: "<html><h1>404 Not Found</h1></html>" }, target).state, "uncertain");
    assert.equal(classifyRegistryResponse({ status: 404, body: "version not found: 1.2.4" }, target).state, "uncertain");
    assert.equal(classifyRegistryResponse({ status: 200, body: { name: target.selector, version: "1.2.2" } }, target).state, "uncertain");
  });
});

describe("publication evidence", () => {
  const integrity = `sha512-${Buffer.from("tarball-digest").toString("base64")}`;
  const statement = {
    subject: [{ digest: { sha512: integrityToSha512Hex(integrity) } }],
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            repository: "https://github.com/Takazudo/zudo-circuit-doc",
            path: ".github/workflows/publish-zudo-circuit-doc.yml",
          },
        },
        resolvedDependencies: [
          { uri: "git+https://github.com/Takazudo/zudo-circuit-doc@refs/tags/v1.2.3", digest: { gitCommit: TAG_SHA } },
        ],
      },
    },
  };
  const expected = { packageName: "runtime", tag: "v1.2.3", sourceSha: TAG_SHA, integrity };
  const oidcManifest = { _npmUser: { name: "GitHub Actions", trustedPublisher: { id: "github" } }, dist: { integrity } };

  test("an OIDC upload with provenance for the tag commit is verified", () => {
    assert.equal(evaluatePublication({ manifest: oidcManifest, statement, expected }).verdict, "oidc-verified");
  });

  test("an existing token-published version is not counted as an OIDC success", () => {
    const tokenManifest = { _npmUser: { name: "takazudo" }, dist: { integrity } };
    assert.equal(evaluatePublication({ manifest: tokenManifest, statement, expected }).verdict, "not-oidc");
  });

  test("provenance for another commit or tag is a mismatch", () => {
    const wrong = structuredClone(statement);
    wrong.predicate.buildDefinition.resolvedDependencies[0] = {
      uri: "git+https://github.com/Takazudo/zudo-circuit-doc@refs/heads/main",
      digest: { gitCommit: MAIN_SHA },
    };
    const result = evaluatePublication({ manifest: oidcManifest, statement: wrong, expected });
    assert.equal(result.verdict, "oidc-mismatch");
    assert.equal(result.problems.length, 2);
  });

  test("missing provenance or a different tarball is a mismatch", () => {
    assert.equal(evaluatePublication({ manifest: oidcManifest, statement: null, expected }).verdict, "oidc-mismatch");
    const other = { ...expected, integrity: "sha512-AAAA" };
    assert.equal(evaluatePublication({ manifest: oidcManifest, statement, expected: other }).verdict, "oidc-mismatch");
  });
});

describe("publish job inputs", () => {
  test("stored npm credentials are detected in env and npmrc", () => {
    assert.deepEqual(findStoredNpmCredentials({ env: { PATH: "/bin" }, npmrcFiles: [] }), []);
    assert.equal(findStoredNpmCredentials({ env: { NODE_AUTH_TOKEN: "XXXXX-XXXXX" }, npmrcFiles: [] }).length, 1);
    assert.equal(findStoredNpmCredentials({ env: { npm_config__authToken: "x" }, npmrcFiles: [] }).length, 1);
    assert.equal(
      findStoredNpmCredentials({ env: {}, npmrcFiles: [{ file: ".npmrc", text: "//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n" }] }).length,
      1,
    );
    assert.equal(findStoredNpmCredentials({ env: {}, npmrcFiles: [{ file: ".npmrc", text: "# _authToken=old\nstrict-ssl=true\n" }] }).length, 0);
  });

  test("a packed manifest must be the admitted version with workspace ranges rewritten", () => {
    const target = { selector: "create-zudo-circuit-doc", version: "0.2.1" };
    assert.deepEqual(inspectPackedManifest({ name: target.selector, version: "0.2.1", dependencies: { a: "^1.0.0" } }, target), []);
    assert.equal(inspectPackedManifest({ name: target.selector, version: "0.2.2" }, target).length, 1);
    assert.equal(inspectPackedManifest({ name: target.selector, version: "0.2.1", dependencies: { a: "workspace:*" } }, target).length, 1);
  });
});

describe("GitHub Release finalization", () => {
  test("creates only when absent and keeps an existing release untouched", () => {
    assert.deepEqual(planGithubRelease({ existing: { state: "absent" }, tag: "v1.2.3" }), { action: "create" });
    const existing = { state: "present", release: { tag_name: "v1.2.3", draft: false, prerelease: false, html_url: "u" } };
    assert.deepEqual(planGithubRelease({ existing, tag: "v1.2.3" }), { action: "keep", url: "u" });
  });

  test("drafts, prereleases and uncertain lookups stop instead of being rewritten", () => {
    const draft = { state: "present", release: { tag_name: "v1.2.3", draft: true, prerelease: false } };
    assert.throws(() => planGithubRelease({ existing: draft, tag: "v1.2.3" }), /draft/u);
    const pre = { state: "present", release: { tag_name: "v1.2.3", draft: false, prerelease: true } };
    assert.throws(() => planGithubRelease({ existing: pre, tag: "v1.2.3" }), /prerelease/u);
    assert.throws(() => planGithubRelease({ existing: { state: "uncertain", reason: "HTTP 401" }, tag: "v1.2.3" }), UncertainStateError);
  });

  test("release notes drop frontmatter and link to the site or the other release", () => {
    const mdx = [
      "---",
      "title: 0.2.1",
      "sidebar_position: 3",
      "---",
      "",
      "Released: 2026-11-07",
      "",
      "Uses [runtime](../zudo-circuit-doc/0.3.0.mdx) and the [guide](../../concepts/ownership-and-upgrades.mdx#top).",
      "",
    ].join("\n");
    assert.equal(
      changelogToReleaseNotes(mdx, { packageName: "initializer" }),
      "Released: 2026-11-07\n\nUses [runtime](https://github.com/Takazudo/zudo-circuit-doc/releases/tag/v0.3.0) and the " +
        "[guide](https://zudo-circuit-doc.zudolab.dev/docs/concepts/ownership-and-upgrades/#top).\n",
    );
    assert.throws(() => changelogToReleaseNotes("---\ntitle: x\n---\nReleased: unreleased\n", { packageName: "runtime" }), /unreleased/u);
  });
});

describe("resume after partial success", () => {
  const remote = { tagObject: TAG_SHA, commit: TAG_SHA, annotated: false };
  const base = { packageName: "runtime", version: "1.2.3", preparedSha: TAG_SHA };

  test("npm published but the run failed later: only the GitHub Release is missing", () => {
    const plan = planResume({ ...base, remoteTag: remote, registry: { state: "present" }, githubRelease: { state: "absent" } });
    assert.deepEqual(plan.steps, ["github-release"]);
  });

  test("nothing pushed yet: every step is missing", () => {
    const plan = planResume({ ...base, remoteTag: null, registry: { state: "absent" }, githubRelease: { state: "absent" } });
    assert.deepEqual(plan.steps, ["push-tag", "publish", "github-release"]);
  });

  test("complete releases need nothing", () => {
    assert.equal(planResume({ ...base, remoteTag: remote, registry: { state: "present" }, githubRelease: { state: "present" } }).done, true);
  });

  test("never moves a pushed tag or invents a version", () => {
    assert.throws(
      () => planResume({ ...base, preparedSha: MAIN_SHA, remoteTag: remote, registry: { state: "present" }, githubRelease: { state: "absent" } }),
      /never move a pushed tag/u,
    );
    assert.throws(
      () => planResume({ ...base, remoteTag: null, registry: { state: "present" }, githubRelease: { state: "absent" } }),
      /reconcile manually/u,
    );
  });

  test("uncertain registry or GitHub state stops the plan", () => {
    assert.throws(
      () => planResume({ ...base, remoteTag: remote, registry: { state: "uncertain", reason: "ECONNRESET" }, githubRelease: { state: "absent" } }),
      UncertainStateError,
    );
    assert.throws(
      () => planResume({ ...base, remoteTag: remote, registry: { state: "present" }, githubRelease: { state: "uncertain", reason: "401" } }),
      UncertainStateError,
    );
  });
});

describe("executed CI binding", () => {
  const run = (overrides) => ({ workflowName: "CI Core", event: "push", status: "completed", conclusion: "success", headSha: TAG_SHA, ...overrides });

  test("green push runs on the exact commit pass", () => {
    assert.equal(evaluateCiRuns({ runs: [run({}), run({ workflowName: "Docs", conclusion: "skipped" })], sha: TAG_SHA }).ok, true);
  });

  test("pull_request merge-tree runs do not count for the candidate commit", () => {
    const result = evaluateCiRuns({ runs: [run({ event: "pull_request" })], sha: TAG_SHA });
    assert.equal(result.ok, false);
    assert.deepEqual(result.ignored, ["CI Core (pull_request)"]);
  });

  test("earlier publish-workflow attempts on the same commit are not CI", () => {
    const publishRun = run({ workflowName: "Publish zudo-circuit-doc to npm", path: ".github/workflows/publish-zudo-circuit-doc.yml", conclusion: "failure" });
    assert.equal(evaluateCiRuns({ runs: [run({ path: ".github/workflows/ci-core.yml" }), publishRun], sha: TAG_SHA }).ok, true);
  });

  test("pending or failed runs and other commits' runs block", () => {
    assert.equal(evaluateCiRuns({ runs: [run({ status: "in_progress", conclusion: null })], sha: TAG_SHA }).ok, false);
    assert.equal(evaluateCiRuns({ runs: [run({ conclusion: "failure" })], sha: TAG_SHA }).ok, false);
    assert.equal(evaluateCiRuns({ runs: [run({ headSha: MAIN_SHA })], sha: TAG_SHA }).ok, false);
  });
});
