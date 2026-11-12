#!/usr/bin/env node
// Shared release entry point for the publish workflows, /l-make-release
// (Claude Code) and the repository Codex skill. Canonical procedure:
// dev-docs/publishing.md. Decisions live in scripts/lib/release-core.mjs;
// this file only gathers facts (git, npm registry, GitHub REST) and acts.
//
// Portable by design: Node >=24, git, and network. `gh` is optional (used only
// to borrow a token when GH_TOKEN/GITHUB_TOKEN is unset). No home-directory
// paths or shell state are required.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  COORDINATOR_WORKFLOW,
  INITIALIZER_TEMPLATE_MANIFEST,
  PACKAGES,
  PUBLISH_JOB_NAME,
  REGISTRY,
  REPOSITORY,
  ReleaseError,
  UncertainStateError,
  admitRelease,
  assessRuntimeGate,
  changelogHasEntry,
  changelogToReleaseNotes,
  classifyTagCreate,
  describeGithubWriteFailure,
  parseCoordinatorInputs,
  planCoordinator,
  resolveExistingTag,
  classifyRegistryResponse,
  evaluateCiRuns,
  evaluatePublication,
  extractProvenanceStatement,
  findStoredNpmCredentials,
  inspectPackedManifest,
  makeLatestFor,
  packageConfig,
  peelRemoteTag,
  planGithubRelease,
  parseReleaseTag,
  planResume,
  releaseTitle,
  resolveRequestedTag,
} from "./lib/release-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTTP_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------- helpers

function run(command, args, { allowFailure = false, cwd = ROOT, env = process.env } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env });
  if (result.error) {
    if (allowFailure) return { status: null, stdout: "", stderr: String(result.error.message) };
    throw new ReleaseError(`${command} could not run: ${result.error.message}`);
  }
  if (result.status !== 0 && !allowFailure) {
    throw new ReleaseError(`${command} ${args.join(" ")} failed (exit ${result.status}): ${result.stderr.trim()}`);
  }
  return result;
}

const git = (args, options) => run("git", args, options);

function log(message) {
  console.log(message);
}

function writeOutputs(values) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  appendFileSync(file, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""));
}

function writeSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${markdown}\n`);
}

function waitSeconds(values, fallback) {
  const raw = values.wait ?? String(fallback);
  if (!/^\d+$/u.test(raw)) throw new ReleaseError(`--wait must be a whole number of seconds; received ${JSON.stringify(raw)}.`);
  return Number(raw);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpJson(url, { method = "GET", headers = {}, body } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    return { status: null, body: null, error };
  }
  const text = await response.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Keep the raw text; callers classify it.
  }
  return { status: response.status, body: parsed, headers: Object.fromEntries(response.headers), error: null };
}

// ---------------------------------------------------------------- npm registry

function registryUrl(selector, suffix = "") {
  return `${REGISTRY}/${selector.replace("/", "%2f")}${suffix}`;
}

async function registryState(config, version) {
  const response = await httpJson(registryUrl(config.selector, `/${version}`), {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  return classifyRegistryResponse(response, { selector: config.selector, version });
}

/** Poll until the version is present; absence after the window is reported, never assumed final. */
async function waitForPresence(config, version, waitSeconds) {
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    const state = await registryState(config, version);
    if (state.state === "present" || Date.now() >= deadline) return state;
    log(`npm ${config.selector}@${version}: ${state.state}${state.reason ? ` (${state.reason})` : ""}; retrying...`);
    await sleep(15_000);
  }
}

// ---------------------------------------------------------------- GitHub REST

let cachedToken;
// Set by preflight when no credential exists or GitHub rejects it: public
// reads (runs, releases) then go out unauthenticated so the candidate report
// still works; writes keep requiring a real credential.
let anonymousReads = false;
function githubToken({ required = true } = {}) {
  if (cachedToken !== undefined && (cachedToken || !required)) return cachedToken;
  cachedToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null;
  if (!cachedToken) {
    const result = run("gh", ["auth", "token"], { allowFailure: true });
    if (result.status === 0 && result.stdout.trim()) cachedToken = result.stdout.trim();
  }
  if (!cachedToken && required) {
    throw new ReleaseError("No GitHub credential: set GH_TOKEN or GITHUB_TOKEN, or authenticate gh.", { code: "MISSING_AUTH" });
  }
  return cachedToken;
}

function repository() {
  return process.env.GITHUB_REPOSITORY || REPOSITORY;
}

async function github(pathname, options = {}) {
  const method = options.method ?? "GET";
  const anonymous = anonymousReads && method === "GET";
  const token = anonymous ? null : githubToken();
  return httpJson(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });
}

async function githubReleaseState(tag) {
  const response = await github(`/repos/${repository()}/releases/tags/${encodeURIComponent(tag)}`);
  if (response.status === 200) return { state: "present", release: response.body };
  if (response.status === 404) return { state: "absent" };
  return { state: "uncertain", reason: response.error ? String(response.error.message) : `HTTP ${response.status}` };
}

// ---------------------------------------------------------------- git facts

function remoteReleaseTags() {
  const result = git(["ls-remote", "--tags", "--refs", "origin"], { allowFailure: true });
  if (result.status !== 0) {
    throw new UncertainStateError(`git ls-remote origin failed: ${result.stderr.trim()}`);
  }
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+/u)[1])
    .filter((ref) => ref?.startsWith("refs/tags/"))
    .map((ref) => ref.slice("refs/tags/".length));
}

function remoteTag(tag) {
  const result = git(["ls-remote", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`], { allowFailure: true });
  if (result.status !== 0) {
    throw new UncertainStateError(`git ls-remote origin failed: ${result.stderr.trim()}`);
  }
  return peelRemoteTag(result.stdout, tag);
}

/** Fetch exactly refs/tags/<tag> into a private ref so no local tag is trusted or clobbered. */
function fetchTagCommit(tag) {
  const privateRef = `refs/release-admission/${tag}`;
  git(["fetch", "--no-tags", "--depth=1", "origin", `+refs/tags/${tag}:${privateRef}`]);
  return git(["rev-parse", `${privateRef}^{commit}`]).stdout.trim();
}

function manifestVersionAt(config, sha) {
  const result = git(["show", `${sha}:${config.manifest}`]);
  return JSON.parse(result.stdout).version;
}

// ---------------------------------------------------------------- commands

async function cmdAdmit(values) {
  const config = packageConfig(values.package);
  const eventName = process.env.GITHUB_EVENT_NAME;
  const ref = process.env.GITHUB_REF;
  const controlSha = process.env.GITHUB_SHA;
  const inputTag = process.env.INPUT_TAG ?? "";
  const dryRun = /^true$/iu.test(process.env.INPUT_DRY_RUN ?? "");

  // Resolve first so a branch dispatch without a tag, or a tag from the other
  // namespace, fails before any network call.
  const tag = resolveRequestedTag({ eventName, ref, inputTag });
  const parsed = parseReleaseTag(tag);
  const inNamespace = parsed?.packageName === config.packageName;
  const peeled = inNamespace ? remoteTag(tag) : null;
  const fetchedTagCommit = peeled ? fetchTagCommit(tag) : null;
  const sourceVersion = fetchedTagCommit ? manifestVersionAt(config, fetchedTagCommit) : null;
  const registry = inNamespace && peeled ? await registryState(config, parsed.version) : null;

  const decision = admitRelease({
    packageName: config.packageName,
    eventName,
    ref,
    inputTag,
    dryRun,
    controlSha,
    remoteTag: peeled,
    fetchedTagCommit,
    sourceVersion,
    registry,
  });

  writeOutputs({
    tag: decision.tag,
    version: decision.version,
    source_sha: decision.sourceSha,
    control_sha: decision.controlSha,
    mode: decision.mode,
    registry_state: decision.registryState,
  });
  writeSummary(
    [
      `### Release admission: ${decision.package}@${decision.version}`,
      "",
      `| Field | Value |`,
      `| --- | --- |`,
      `| Tag | \`${decision.tag}\` |`,
      `| Source (tag commit) | \`${decision.sourceSha}\` |`,
      `| Control (run commit) | \`${decision.controlSha}\` |`,
      `| npm before run | ${decision.registryState} |`,
      `| Mode | **${decision.mode}** |`,
      "",
      decision.reason,
    ].join("\n"),
  );
  log(JSON.stringify(decision, null, 2));
}

async function cmdRegistryState(values) {
  const config = packageConfig(values.package);
  const state = await registryState(config, values.version);
  log(JSON.stringify({ package: config.selector, version: values.version, state: state.state, reason: state.reason ?? null }));
  if (state.state === "uncertain") process.exitCode = 3;
}

async function cmdVerifyPublication(values) {
  const config = packageConfig(values.package);
  const version = values.version;
  const deadline = Date.now() + waitSeconds(values, 600) * 1000;
  const state = await waitForPresence(config, version, Math.max(0, (deadline - Date.now()) / 1000));
  if (state.state !== "present") {
    throw new UncertainStateError(
      `${config.selector}@${version} is not visible on npm yet (${state.state}${state.reason ? `: ${state.reason}` : ""}). ` +
        "Do not republish; rerun verification later.",
    );
  }
  let statement = null;
  const attestationsUrl = state.manifest.dist?.attestations?.url;
  if (attestationsUrl) {
    statement = extractProvenanceStatement(await readAttestations(attestationsUrl, deadline));
  }
  const result = evaluatePublication({
    manifest: state.manifest,
    statement,
    expected: {
      packageName: config.packageName,
      tag: values.tag,
      sourceSha: values["source-sha"],
      integrity: values.integrity || undefined,
    },
  });
  writeSummary(
    [`### npm publication check: ${config.selector}@${version}`, "", `Verdict: **${result.verdict}**`, ...result.problems.map((p) => `- ${p}`)].join(
      "\n",
    ),
  );
  log(JSON.stringify(result, null, 2));
  if (result.verdict !== "oidc-verified") process.exitCode = 1;
}

// The attestations endpoint can 404 for a while after the packument already lists the version.
async function readAttestations(url, deadline) {
  for (;;) {
    const response = await httpJson(url, { headers: { Accept: "application/json" } });
    if (response.status === 200) return response.body;
    if (Date.now() >= deadline) {
      throw new UncertainStateError(`Could not read attestations (${response.status ?? response.error}).`);
    }
    log(`attestations ${url}: ${response.status ?? response.error}; retrying...`);
    await sleep(15_000);
  }
}

async function releaseNotesFor(config, version, sha) {
  const page = `${config.changelogDir}/${version}.mdx`;
  const mdx = sha ? git(["show", `${sha}:${page}`]).stdout : await readFile(path.join(ROOT, page), "utf8");
  return changelogToReleaseNotes(mdx, { packageName: config.packageName });
}

async function cmdReleaseNotes(values) {
  const config = packageConfig(values.package);
  process.stdout.write(await releaseNotesFor(config, values.version, values.ref));
}

async function cmdFinalize(values) {
  const config = packageConfig(values.package);
  const version = values.version;
  const tag = config.tag(version);

  // Finalization never publishes. It requires the exact version to be on npm.
  const state = await waitForPresence(config, version, waitSeconds(values, 600));
  if (state.state !== "present") {
    throw new UncertainStateError(`${config.selector}@${version} is not confirmed on npm (${state.state}); GitHub Release not created.`);
  }
  const peeled = remoteTag(tag);
  if (!peeled) throw new ReleaseError(`Tag ${tag} does not exist on origin.`);
  if (values["source-sha"] && peeled.commit !== values["source-sha"]) {
    throw new ReleaseError(`Tag ${tag} now peels to ${peeled.commit}, not the admitted source ${values["source-sha"]}.`);
  }

  const plan = planGithubRelease({ existing: await githubReleaseState(tag), tag });
  if (plan.action === "keep") {
    log(`GitHub Release for ${tag} already exists; kept unchanged: ${plan.url}`);
    writeSummary(`GitHub Release for \`${tag}\` already existed and was kept unchanged: ${plan.url}`);
    return;
  }

  // Notes come from the tag commit, which may not be the checked-out control commit.
  if (fetchTagCommit(tag) !== peeled.commit) throw new ReleaseError(`Fetched ${tag} does not match origin.`);
  const notes = await releaseNotesFor(config, version, peeled.commit);
  const response = await github(`/repos/${repository()}/releases`, {
    method: "POST",
    body: {
      tag_name: tag,
      name: releaseTitle(config.packageName, version),
      body: notes,
      draft: false,
      prerelease: false,
      make_latest: makeLatestFor({ tag, remoteTags: remoteReleaseTags() }),
    },
  });
  if (response.status === 201) {
    log(`Created GitHub Release ${response.body.html_url}`);
    writeSummary(`Created GitHub Release: ${response.body.html_url}`);
    return;
  }
  // A concurrent finalizer may have won; re-read rather than overwrite.
  const reread = planGithubRelease({ existing: await githubReleaseState(tag), tag });
  if (reread.action === "keep") {
    log(`GitHub Release for ${tag} appeared concurrently; kept unchanged: ${reread.url}`);
    return;
  }
  throw new ReleaseError(`Creating the GitHub Release for ${tag} failed (HTTP ${response.status}).`);
}

async function listRunsForSha(sha) {
  const runs = [];
  for (let page = 1; page <= 5; page += 1) {
    const response = await github(`/repos/${repository()}/actions/runs?head_sha=${sha}&per_page=100&page=${page}`);
    if (response.status !== 200) throw new UncertainStateError(`Could not list Actions runs (${response.status ?? response.error}).`);
    for (const runInfo of response.body.workflow_runs) {
      runs.push({
        workflowName: runInfo.name,
        path: runInfo.path,
        event: runInfo.event,
        status: runInfo.status,
        conclusion: runInfo.conclusion,
        headSha: runInfo.head_sha,
        url: runInfo.html_url,
        headBranch: runInfo.head_branch,
        createdAt: runInfo.created_at,
      });
    }
    if (response.body.workflow_runs.length < 100) return runs;
  }
  throw new UncertainStateError(`More than 500 workflow runs for ${sha}; refusing to judge CI from a partial list.`);
}

function check(label, fn) {
  try {
    const detail = fn();
    return { label, ok: true, detail };
  } catch (error) {
    return { label, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function cmdPreflight(values) {
  const config = values.package ? packageConfig(values.package) : null;
  const checks = [];
  const rootManifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const explicitSha = values.sha || null;
  if (explicitSha && !/^[0-9a-f]{40}$/u.test(explicitSha)) {
    throw new ReleaseError(`--sha must be a full 40-character lowercase commit SHA; received ${JSON.stringify(explicitSha)}.`);
  }

  checks.push(
    check("node >=24 <25", () => {
      const major = Number(process.versions.node.split(".")[0]);
      if (major !== 24) throw new Error(`node ${process.versions.node}`);
      return process.versions.node;
    }),
  );
  checks.push(
    check(`pnpm = ${rootManifest.packageManager}`, () => {
      const wanted = rootManifest.packageManager.split("@")[1];
      const result = run("corepack", ["pnpm", "--version"], { allowFailure: true });
      const version = result.status === 0 ? result.stdout.trim() : run("pnpm", ["--version"]).stdout.trim();
      if (version !== wanted) throw new Error(`pnpm ${version}`);
      return version;
    }),
  );
  checks.push(check("origin is the release repository", () => {
    const url = git(["remote", "get-url", "origin"]).stdout.trim();
    if (!url.replace(/\.git$/u, "").endsWith(REPOSITORY)) throw new Error(url);
    return url;
  }));
  let mainHead = null;
  checks.push(check("fetch origin main", () => {
    git(["fetch", "--quiet", "--tags", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
    mainHead = git(["rev-parse", "origin/main"]).stdout.trim();
    return mainHead;
  }));
  // Local preparation needs a clean main checkout; binding an explicit
  // --sha (e.g. a release commit merged through a PR) does not.
  const localTree = [
    check("git work tree clean", () => {
      const status = git(["status", "--porcelain"]).stdout.trim();
      if (status) throw new Error("uncommitted changes present");
      return "clean";
    }),
    check("branch main == origin/main", () => {
      const branch = git(["branch", "--show-current"]).stdout.trim();
      const head = git(["rev-parse", "HEAD"]).stdout.trim();
      if (branch !== "main") throw new Error(`on ${branch || "detached HEAD"}`);
      if (head !== mainHead) throw new Error(`HEAD ${head} != origin/main ${mainHead}`);
      return head;
    }),
  ];
  if (explicitSha) {
    for (const item of localTree) item.label += " (informational with --sha)";
  } else {
    checks.push(...localTree);
  }

  const registryPing = await httpJson(`${REGISTRY}/-/ping`);
  checks.push({ label: "npm registry reachable", ok: registryPing.status === 200, detail: registryPing.status ?? String(registryPing.error) });

  // GitHub: a credential is a capability, not a requirement. Reads fall back
  // to anonymous access (the repository is public); writes need a credential
  // or another dispatch path (GitHub MCP, the Actions UI).
  const credential = await probeGithubCredential();
  if (!credential.valid) anonymousReads = true;
  const repo = await github(`/repos/${repository()}`);
  checks.push({
    label: `GitHub API reads (${credential.valid ? "authenticated" : "anonymous"})`,
    ok: repo.status === 200,
    detail: `${repo.status ?? String(repo.error)}${repo.status !== 200 && repo.body?.message ? `: ${repo.body.message}` : ""}`,
  });

  const pushProbe = git(["push", "--dry-run", "origin", "HEAD:refs/heads/main"], { allowFailure: true });
  const gitPush = pushProbe.status === 0 ? "available" : `unavailable (${pushProbe.stderr.trim().split("\n").pop()})`;
  const heavyGuard = process.env.HOME ? path.join(process.env.HOME, ".claude/scripts/heavy-guard.sh") : null;
  const canDispatchViaApi = credential.valid && credential.permissions?.push === true;
  const info = {
    platform: `${os.platform()} ${os.arch()}`,
    githubCredential: credential.summary,
    gitPush,
    releasePath: canDispatchViaApi
      ? "release coordinator via API: node scripts/release.mjs request-release ..."
      : "release coordinator via GitHub MCP actions_run_trigger if this session has it, otherwise Actions UI → Release coordinator → Run workflow",
    releaseCommitPath: gitPush === "available" ? "git push origin main" : "pull request merged by the owner",
    heavyGuard: heavyGuard && existsSync(heavyGuard) ? "available (Mac resource admission)" : "not present; run heavy gates directly",
  };
  // Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1; behind an
  // egress proxy (Cloud sessions) GitHub calls otherwise bypass it.
  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && process.env.NODE_USE_ENV_PROXY !== "1") {
    info.proxy = "HTTPS_PROXY is set but NODE_USE_ENV_PROXY is not 1; rerun with NODE_USE_ENV_PROXY=1 so fetch uses the proxy";
  }
  for (const item of explicitSha ? localTree : []) info[item.label] = `${item.ok ? "yes" : "no"}: ${item.detail}`;

  const candidate = {};
  if (config && mainHead && repo.status === 200) {
    const sha = explicitSha || git(["rev-parse", "HEAD"]).stdout.trim();
    try {
      const version = manifestVersionAt(config, sha);
      const tag = config.tag(version);
      const facts = await gatherCoordinatorFacts({ config, version, sha, tag, mainHead });
      Object.assign(candidate, { package: config.selector, sha, version, tag, ci: facts.ci, tagOnOrigin: facts.remoteTag, npm: facts.registry.state });
      checks.push({ label: `CI on ${sha.slice(0, 12)} (push runs only)`, ok: facts.ci.ok, detail: facts.ci.problems.join("; ") || facts.ci.counted.join(", ") });
      checks.push({ label: "npm state known", ok: facts.registry.state !== "uncertain", detail: facts.registry.reason ?? facts.registry.state });
      let plan;
      try {
        plan = planCoordinator({ ...facts, allowOlderSha: Boolean(values["allow-older-sha"]) });
        candidate.coordinator = { action: plan.action, reason: plan.reason };
      } catch (error) {
        candidate.coordinator = { refused: error.message };
      }
      // An explicit --sha asks "can the coordinator release this commit?".
      if (explicitSha) {
        checks.push({
          label: "release coordinator would accept this candidate",
          ok: Boolean(plan),
          detail: plan ? `${plan.action}: ${plan.reason}` : candidate.coordinator.refused,
        });
      }
    } catch (error) {
      checks.push({ label: `candidate ${sha.slice(0, 12)}`, ok: false, detail: error.message });
    }
  }

  for (const item of checks) log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}: ${item.detail}`);
  log(JSON.stringify({ info, candidate }, null, 2));
  if (checks.some((item) => !item.ok)) process.exitCode = 1;
}

/** Try the configured GitHub credential without failing: missing, rejected, or valid with its repo permissions. */
async function probeGithubCredential() {
  const source = process.env.GH_TOKEN ? "GH_TOKEN" : process.env.GITHUB_TOKEN ? "GITHUB_TOKEN" : "gh auth token";
  const token = githubToken({ required: false });
  if (!token) return { valid: false, summary: "none (no GH_TOKEN/GITHUB_TOKEN, gh not authenticated)" };
  const response = await github(`/repos/${repository()}`);
  if (response.status === 200) {
    const permissions = response.body?.permissions ?? {};
    return { valid: true, permissions, summary: `valid via ${source}; repo permissions ${JSON.stringify(permissions)}` };
  }
  const message = response.body?.message ? `: ${response.body.message}` : "";
  return { valid: false, summary: `rejected via ${source} (HTTP ${response.status ?? response.error}${message})` };
}

async function cmdStatus(values) {

  const config = packageConfig(values.package);
  const version = values.version || manifestVersionAt(config, "HEAD");
  const tag = config.tag(version);
  const peeled = remoteTag(tag);
  const registry = await registryState(config, version);
  const release = await githubReleaseState(tag);
  const plan = planResume({
    packageName: config.packageName,
    version,
    preparedSha: values.sha || null,
    remoteTag: peeled,
    registry,
    githubRelease: release,
  });
  log(
    JSON.stringify(
      {
        package: config.selector,
        version,
        tag,
        tagCommit: peeled?.commit ?? null,
        npm: registry.state,
        trustedPublisher: registry.manifest?._npmUser?.trustedPublisher ?? null,
        githubRelease: release.state === "present" ? release.release.html_url : release.state,
        missing: plan.steps,
      },
      null,
      2,
    ),
  );
}

async function listDispatchRuns(workflow, query = "") {
  const runs = await github(`/repos/${repository()}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=50${query}`);
  if (runs.status !== 200) throw new UncertainStateError(`Could not list ${workflow} runs (HTTP ${runs.status ?? runs.error}).`);
  return runs.body.workflow_runs;
}

/**
 * Dispatch one workflow and read the new run back. Runs that existed before
 * the dispatch are excluded, so a concurrent run at the same ref is not
 * mistaken for ours. Returns the run, or throws with diagnostics.
 */
async function dispatchWorkflowRun({ workflow, ref, inputs, diagnostics = {} }) {
  const before = new Set((await listDispatchRuns(workflow)).map((run) => run.id));
  const startedAt = new Date(Date.now() - 5_000).toISOString().replace(/\.\d{3}Z$/u, "Z");
  const response = await github(`/repos/${repository()}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    body: { ref, inputs },
  });
  if (response.status !== 204) {
    const lines = describeGithubWriteFailure({ operation: `Dispatch ${workflow} at ${ref}`, ...response, ...diagnostics });
    writeSummary(["### Dispatch failed", "", ...lines.map((line) => `- ${line}`)].join("\n"));
    throw new ReleaseError(lines.join("\n"), { code: "DISPATCH_FAILED" });
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(3_000);
    const runs = await listDispatchRuns(workflow, `&created=${encodeURIComponent(`>=${startedAt}`)}`);
    const found = runs.find((candidate) => candidate.head_branch === ref && !before.has(candidate.id));
    if (found) return found;
  }
  throw new UncertainStateError(
    `Dispatch of ${workflow} at ${ref} was accepted (HTTP 204) but no run appeared yet; check the Actions tab before dispatching again.`,
  );
}

async function cmdDispatch(values) {
  const config = packageConfig(values.package);
  const tag = values.tag;
  const ref = values.ref || tag;
  const found = await dispatchWorkflowRun({
    workflow: config.workflow,
    ref,
    inputs: { tag, dry_run: values["dry-run"] ? "true" : "false" },
  });
  log(JSON.stringify({ runId: found.id, url: found.html_url, ref, tag, dryRun: Boolean(values["dry-run"]) }));
}

/**
 * After a tag push, make sure the publish workflow actually started. A tag
 * created by a GITHUB_TOKEN never triggers workflows, so dispatch at the tag
 * explicitly when no push run appears. Admission makes a duplicate run safe.
 */
async function cmdEnsureRun(values) {
  const config = packageConfig(values.package);
  const tag = values.tag;
  const peeled = remoteTag(tag);
  if (!peeled) throw new ReleaseError(`Tag ${tag} does not exist on origin.`);
  const deadline = Date.now() + waitSeconds(values, 120) * 1000;
  while (Date.now() < deadline) {
    // Only runs whose ref is the tag itself can publish it; a main-ref run on
    // the same commit (dry-run/finalize) does not count.
    const runs = (await listRunsForSha(peeled.commit)).filter(
      (r) => r.path?.endsWith(config.workflow) && r.headBranch === tag && ["push", "workflow_dispatch"].includes(r.event),
    );
    if (runs.length > 0) {
      log(JSON.stringify({ tag, observed: runs.map((r) => ({ event: r.event, status: r.status, url: r.url })) }, null, 2));
      return;
    }
    await sleep(10_000);
  }
  log(`No ${config.workflow} run observed for ${tag}; dispatching explicitly at the tag.`);
  await cmdDispatch({ package: values.package, tag });
}

// ---------------------------------------------------------------- release coordinator

const COORDINATOR_MAIN_REF = "refs/release-coordinator/main";

/** Fetch origin main into a private ref and make sure the candidate commit is present locally. */
function fetchMainAndCandidate(sha) {
  git(["fetch", "--quiet", "--no-tags", "origin", `+refs/heads/main:${COORDINATOR_MAIN_REF}`]);
  const mainHead = git(["rev-parse", COORDINATOR_MAIN_REF]).stdout.trim();
  if (git(["cat-file", "-e", `${sha}^{commit}`], { allowFailure: true }).status !== 0) {
    git(["fetch", "--quiet", "--no-tags", "origin", sha], { allowFailure: true });
  }
  return mainHead;
}

function isAncestor(sha, mainHead) {
  const result = git(["merge-base", "--is-ancestor", sha, mainHead], { allowFailure: true });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new ReleaseError(`Commit ${sha} is not available from origin: ${result.stderr.trim()}`);
}

function fileAt(sha, file) {
  const result = git(["show", `${sha}:${file}`], { allowFailure: true });
  return result.status === 0 ? result.stdout : null;
}

function workflowDiff(sha, mainHead) {
  const result = git(["diff", "--name-only", sha, mainHead, "--", ".github/workflows"], { allowFailure: true });
  return result.status === 0 ? result.stdout.split("\n").filter(Boolean) : null;
}

/** Publish-workflow runs whose ref is the tag, each with its publish job's conclusion. */
async function publisherRunsForTag(config, tag) {
  const response = await github(
    `/repos/${repository()}/actions/workflows/${config.workflow}/runs?branch=${encodeURIComponent(tag)}&per_page=100`,
  );
  if (response.status !== 200) throw new UncertainStateError(`Could not list ${config.workflow} runs for ${tag} (HTTP ${response.status ?? response.error}).`);
  const runs = [];
  for (const runInfo of response.body.workflow_runs.filter((r) => r.head_branch === tag)) {
    const jobs = await github(`/repos/${repository()}/actions/runs/${runInfo.id}/jobs?filter=all&per_page=100`);
    if (jobs.status !== 200) throw new UncertainStateError(`Could not read jobs of run ${runInfo.html_url} (HTTP ${jobs.status ?? jobs.error}).`);
    const publishJob = jobs.body.jobs.find((job) => job.name === PUBLISH_JOB_NAME) ?? null;
    runs.push({
      id: runInfo.id,
      url: runInfo.html_url,
      event: runInfo.event,
      status: runInfo.status,
      conclusion: runInfo.conclusion,
      headSha: runInfo.head_sha,
      publishJob: publishJob ? { status: publishJob.status, conclusion: publishJob.conclusion } : null,
    });
  }
  return runs;
}

/** Every fact planCoordinator needs for one candidate. Read-only. */
async function gatherCoordinatorFacts({ config, version, sha, tag, mainHead }) {
  const inMain = isAncestor(sha, mainHead);
  const manifestText = fileAt(sha, config.manifest);
  const manifestVersion = manifestText ? JSON.parse(manifestText).version : null;

  const page = `${config.changelogDir}/${version}.mdx`;
  const pageText = fileAt(sha, page);
  let changelog;
  if (pageText === null) {
    changelog = { ok: false, problem: `${page} does not exist` };
  } else {
    try {
      changelogToReleaseNotes(pageText, { packageName: config.packageName });
      changelog = { ok: true };
    } catch (error) {
      changelog = { ok: false, problem: error.message };
    }
  }
  const generatedChangelogHasEntry = changelogHasEntry(fileAt(sha, `${config.packageDir}/CHANGELOG.md`), version);

  const ci = evaluateCiRuns({ runs: await listRunsForSha(sha), sha });
  const peeled = remoteTag(tag);
  const registry = await registryState(config, version);
  const githubRelease = await githubReleaseState(tag);
  const publisherRuns = peeled && registry.state === "absent" ? await publisherRunsForTag(config, tag) : [];

  let runtimeGate = null;
  if (config.packageName === "initializer") {
    const runtime = PACKAGES.runtime;
    const runtimeVersion = JSON.parse(fileAt(sha, runtime.manifest)).version;
    const template = JSON.parse(fileAt(sha, INITIALIZER_TEMPLATE_MANIFEST) ?? "{}");
    runtimeGate = assessRuntimeGate({
      runtimeVersion,
      templateRange: template.dependencies?.[runtime.selector] ?? null,
      remoteTag: remoteTag(runtime.tag(runtimeVersion)),
      registry: await registryState(runtime, runtimeVersion),
      githubRelease: await githubReleaseState(runtime.tag(runtimeVersion)),
    });
  }

  return {
    packageName: config.packageName,
    version,
    sha,
    tag,
    mainHead,
    inMain,
    manifestVersion,
    changelog,
    generatedChangelogHasEntry,
    ci,
    remoteTag: peeled,
    registry: registry.state === "present" ? { state: "present", trustedPublisher: registry.manifest?._npmUser?.trustedPublisher ?? null } : registry,
    githubRelease: githubRelease.state === "present" ? { state: "present", url: githubRelease.release.html_url } : githubRelease,
    publisherRuns,
    runtimeGate,
  };
}

function coordinatorInputsFromEnv() {
  return parseCoordinatorInputs({
    packageName: process.env.INPUT_PACKAGE,
    version: process.env.INPUT_VERSION,
    sha: process.env.INPUT_SHA,
    dryRun: process.env.INPUT_DRY_RUN,
    allowOlderSha: process.env.INPUT_ALLOW_OLDER_SHA,
    ref: process.env.GITHUB_REF,
  });
}

/** Coordinator `plan` job: read-only facts and the one next action. */
async function cmdCoordinatePlan() {
  const inputs = coordinatorInputsFromEnv();
  const config = PACKAGES[inputs.packageName];
  const mainHead = fetchMainAndCandidate(inputs.sha);
  const facts = await gatherCoordinatorFacts({ config, version: inputs.version, sha: inputs.sha, tag: inputs.tag, mainHead });
  const summaryHead = [
    `### Release coordinator: ${config.selector}@${inputs.version}${inputs.dryRun ? " (dry run)" : ""}`,
    "",
    "| Fact | Value |",
    "| --- | --- |",
    `| Candidate SHA | \`${inputs.sha}\` |`,
    `| main HEAD | \`${mainHead}\`${mainHead === inputs.sha ? " (same)" : ""} |`,
    `| On main | ${facts.inMain} |`,
    `| Manifest version at SHA | ${facts.manifestVersion} |`,
    `| Changelog page | ${facts.changelog.ok ? "finalized" : facts.changelog.problem} |`,
    `| Generated CHANGELOG.md entry | ${facts.generatedChangelogHasEntry} |`,
    `| Push CI on SHA | ${facts.ci.ok ? "green" : facts.ci.problems.join("; ")} |`,
    `| Tag \`${inputs.tag}\` | ${facts.remoteTag ? `exists at \`${facts.remoteTag.commit}\`` : "absent"} |`,
    `| npm | ${facts.registry.state}${facts.registry.reason ? ` (${facts.registry.reason})` : ""} |`,
    `| GitHub Release | ${facts.githubRelease.url ?? facts.githubRelease.state} |`,
    `| Publisher runs at the tag | ${facts.publisherRuns.map((r) => `[${r.status}/${r.conclusion ?? "-"}, publish ${r.publishJob?.conclusion ?? "-"}](${r.url})`).join(", ") || "none"} |`,
    ...(facts.runtimeGate ? [`| Runtime gate | ${facts.runtimeGate.ok ? "runtime released" : facts.runtimeGate.problems.join("; ")} |`] : []),
    "",
  ];
  let plan;
  try {
    plan = planCoordinator({ ...facts, allowOlderSha: inputs.allowOlderSha });
  } catch (error) {
    writeSummary([...summaryHead, `**Refused:** ${error.message}`, "", "Nothing was changed."].join("\n"));
    throw error;
  }
  const willAct = !inputs.dryRun && ["create-tag", "dispatch-publish", "dispatch-finalize"].includes(plan.action);
  writeOutputs({
    package: inputs.packageName,
    version: inputs.version,
    sha: inputs.sha,
    tag: inputs.tag,
    action: plan.action,
    dispatch_ref: plan.dispatchRef ?? "",
    main_head: mainHead,
    act: willAct ? "true" : "false",
  });
  writeSummary(
    [
      ...summaryHead,
      `**Action:** \`${plan.action}\`${inputs.dryRun ? " — dry run: not performed; nothing was changed" : ""}`,
      "",
      plan.reason,
    ].join("\n"),
  );
  log(JSON.stringify({ dryRun: inputs.dryRun, plan, facts }, null, 2));
}

/** Coordinator `tag` job: create the tag with the job's GITHUB_TOKEN, idempotently. */
async function cmdCoordinateTag(values) {
  const config = packageConfig(values.package);
  const { tag, sha } = values;
  if (parseReleaseTag(tag)?.packageName !== config.packageName) throw new ReleaseError(`${tag} is not a ${config.packageName} tag.`);
  // Recheck right before the irreversible step.
  const registry = await registryState(config, parseReleaseTag(tag).version);
  if (registry.state !== "absent") {
    throw new UncertainStateError(`npm state of ${config.selector} for ${tag} is ${registry.state} just before tagging; not tagging.`);
  }
  const existing = remoteTag(tag);
  if (existing) {
    resolveExistingTag({ tag, sha, remoteTag: existing });
    log(`Tag ${tag} already exists at ${sha}; resuming.`);
    writeSummary(`Tag \`${tag}\` already existed at \`${sha}\`; resumed without writing.`);
    return;
  }
  const response = await github(`/repos/${repository()}/git/refs`, { method: "POST", body: { ref: `refs/tags/${tag}`, sha } });
  const result = classifyTagCreate(response);
  if (result.outcome === "created") {
    log(`Created tag ${tag} at ${sha}.`);
    writeSummary(`Created tag \`${tag}\` at \`${sha}\` with the job's GITHUB_TOKEN.`);
    return;
  }
  if (result.outcome === "exists") {
    resolveExistingTag({ tag, sha, remoteTag: remoteTag(tag) });
    log(`Tag ${tag} appeared concurrently at ${sha}; resuming.`);
    return;
  }
  const mainHead = fetchMainAndCandidate(sha);
  const lines = describeGithubWriteFailure({
    operation: `Create ${tag} at ${sha}`,
    ...response,
    declaredPermissions: "contents: write",
    sha,
    mainHead,
    workflowDiff: workflowDiff(sha, mainHead),
  });
  writeSummary(["### Tag creation failed", "", ...lines.map((line) => `- ${line}`)].join("\n"));
  throw new ReleaseError(lines.join("\n"), { code: "TAG_CREATE_FAILED" });
}

const TERMINAL_RUN = new Set(["completed"]);

/**
 * Coordinator `dispatch` job: start the package's publish workflow at the
 * given ref (unless a run for the tag is already in flight), watch it, and
 * report the exact npm / provenance / GitHub Release state afterwards.
 */
async function cmdCoordinateDispatch(values) {
  const config = packageConfig(values.package);
  const { tag } = values;
  const ref = values.ref;
  const version = parseReleaseTag(tag)?.version;
  if (parseReleaseTag(tag)?.packageName !== config.packageName) throw new ReleaseError(`${tag} is not a ${config.packageName} tag.`);
  if (ref !== tag && ref !== "main") throw new ReleaseError(`Dispatch ref must be the tag (publish) or main (finalize); got ${ref}.`);
  const peeled = remoteTag(tag);
  if (!peeled) throw new ReleaseError(`Tag ${tag} does not exist on origin; nothing to dispatch.`);
  if (values.sha && peeled.commit !== values.sha) throw new ReleaseError(`Tag ${tag} peels to ${peeled.commit}, not ${values.sha}.`);

  // A GITHUB_TOKEN tag never starts the tag-push trigger; if a run at the tag
  // exists anyway (or a previous coordinator dispatched one), watch it.
  let target = null;
  if (ref === tag) {
    const runs = await publisherRunsForTag(config, tag);
    target = runs.find((run) => !TERMINAL_RUN.has(run.status)) ?? null;
    if (runs.some((run) => run.publishJob?.conclusion === "success")) {
      throw new ReleaseError(`An earlier run for ${tag} already published; not dispatching again. Rerun the coordinator later to finalize.`);
    }
  }
  if (target) {
    log(`A ${config.workflow} run for ${tag} is already in flight: ${target.url}; watching it instead of dispatching.`);
  } else {
    const mainHead = fetchMainAndCandidate(peeled.commit);
    const found = await dispatchWorkflowRun({
      workflow: config.workflow,
      ref,
      inputs: { tag, dry_run: "false" },
      diagnostics: { declaredPermissions: "actions: write, contents: read", sha: peeled.commit, mainHead },
    });
    target = { id: found.id, url: found.html_url };
    log(`Dispatched ${config.workflow} at ${ref} for ${tag}: ${target.url}`);
  }
  writeSummary(`Publisher run for \`${tag}\` (ref \`${ref}\`): ${target.url}`);
  writeOutputs({ run_url: target.url });

  const deadline = Date.now() + waitSeconds(values, 4800) * 1000;
  let runInfo;
  for (;;) {
    const response = await github(`/repos/${repository()}/actions/runs/${target.id}`);
    if (response.status === 200) {
      runInfo = response.body;
      if (TERMINAL_RUN.has(runInfo.status)) break;
    }
    if (Date.now() >= deadline) {
      throw new UncertainStateError(`Publisher run ${target.url} has not finished yet; watch it and rerun the coordinator afterwards.`);
    }
    await sleep(30_000);
  }
  const jobs = await github(`/repos/${repository()}/actions/runs/${target.id}/jobs?filter=latest&per_page=100`);
  const jobLines = jobs.status === 200 ? jobs.body.jobs.map((job) => `${job.name}: ${job.conclusion ?? job.status}`) : [`jobs unavailable (HTTP ${jobs.status})`];
  const registry = await registryState(config, version);
  const release = await githubReleaseState(tag);
  const state = {
    run: target.url,
    conclusion: runInfo.conclusion,
    jobs: jobLines,
    npm: registry.state,
    trustedPublisher: registry.manifest?._npmUser?.trustedPublisher ?? null,
    integrity: registry.manifest?.dist?.integrity ?? null,
    githubRelease: release.state === "present" ? release.release.html_url : release.state,
  };
  writeSummary(
    [
      `### Publisher result: ${config.selector}@${version}`,
      "",
      `Run: ${target.url} — **${runInfo.conclusion}**`,
      ...jobLines.map((line) => `- ${line}`),
      "",
      `npm: ${state.npm}; trustedPublisher: ${state.trustedPublisher ? JSON.stringify(state.trustedPublisher) : "none"}; GitHub Release: ${state.githubRelease}`,
      "",
      runInfo.conclusion === "success"
        ? "The publish workflow's own confirm job is the provenance check of record."
        : "A failed run is not proof that npm lacks the version. Rerun the coordinator with the same inputs: it reconciles npm and earlier runs and only finalizes or resumes what is missing.",
    ].join("\n"),
  );
  log(JSON.stringify(state, null, 2));
  if (runInfo.conclusion !== "success") throw new ReleaseError(`Publisher run ${target.url} concluded ${runInfo.conclusion}.`);
}

/** Ask GitHub Actions to run the coordinator (needs a credential that may dispatch workflows). */
async function cmdRequestRelease(values) {
  const config = packageConfig(values.package);
  const inputs = parseCoordinatorInputs({
    packageName: config.packageName,
    version: values.version,
    sha: values.sha,
    dryRun: values["dry-run"] ? "true" : "false",
    allowOlderSha: values["allow-older-sha"] ? "true" : "false",
    ref: "refs/heads/main",
  });
  const found = await dispatchWorkflowRun({
    workflow: COORDINATOR_WORKFLOW,
    ref: "main",
    inputs: {
      package: inputs.packageName,
      version: inputs.version,
      sha: inputs.sha,
      dry_run: String(inputs.dryRun),
      allow_older_sha: String(inputs.allowOlderSha),
    },
    diagnostics: { sha: inputs.sha },
  });
  log(JSON.stringify({ runId: found.id, url: found.html_url, ...inputs }, null, 2));
}

function tarballIntegrity(file) {

  return `sha512-${createHash("sha512").update(readFileSync(file)).digest("base64")}`;
}

/** Bind the packed tarball to the admitted package/version and print its SRI. */
async function cmdTarballInfo(values) {
  const config = packageConfig(values.package);
  const manifest = JSON.parse(run("tar", ["-xzOf", values.tarball, "package/package.json"]).stdout);
  const problems = inspectPackedManifest(manifest, { selector: config.selector, version: values.version });
  if (problems.length > 0) throw new ReleaseError(`Tarball ${values.tarball}: ${problems.join("; ")}`);
  const integrity = tarballIntegrity(values.tarball);
  writeOutputs({ tarball: path.basename(values.tarball), integrity });
  log(JSON.stringify({ tarball: values.tarball, package: manifest.name, version: manifest.version, integrity }));
}

/**
 * Last check before `pnpm publish` in the id-token job: the bytes are the
 * verified ones, OIDC is reachable, and no stored npm credential exists that
 * pnpm could silently fall back to.
 */
async function cmdPublishPreflight(values) {
  const integrity = tarballIntegrity(values.tarball);
  if (integrity !== values.integrity) {
    throw new ReleaseError(`Downloaded tarball integrity ${integrity} differs from the verified ${values.integrity}.`);
  }
  const npmrcFiles = [
    path.join(os.homedir(), ".npmrc"),
    path.join(ROOT, ".npmrc"),
    process.env.npm_config_userconfig,
    process.env.NPM_CONFIG_USERCONFIG,
  ]
    .filter(Boolean)
    .filter((file) => existsSync(file))
    .map((file) => ({ file, text: readFileSync(file, "utf8") }));
  const problems = findStoredNpmCredentials({ env: process.env, npmrcFiles });
  if (problems.length > 0) throw new ReleaseError(`Stored npm credentials present: ${problems.join("; ")}`, { code: "TOKEN_PRESENT" });
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new ReleaseError("GitHub OIDC is unavailable in this job; it needs `permissions: id-token: write`.", { code: "MISSING_AUTH" });
  }
  log("Publish preflight passed: verified tarball, OIDC available, no stored npm credentials.");
}

// ---------------------------------------------------------------- main

const COMMANDS = {
  admit: { fn: cmdAdmit, required: ["package"] },
  "registry-state": { fn: cmdRegistryState, required: ["package", "version"] },
  "verify-publication": { fn: cmdVerifyPublication, required: ["package", "version", "tag", "source-sha"] },
  "release-notes": { fn: cmdReleaseNotes, required: ["package", "version"] },
  finalize: { fn: cmdFinalize, required: ["package", "version"] },
  preflight: { fn: cmdPreflight, required: [] },
  status: { fn: cmdStatus, required: ["package"] },
  dispatch: { fn: cmdDispatch, required: ["package", "tag"] },
  "ensure-run": { fn: cmdEnsureRun, required: ["package", "tag"] },
  "request-release": { fn: cmdRequestRelease, required: ["package", "version", "sha"] },
  "coordinate-plan": { fn: cmdCoordinatePlan, required: [] },
  "coordinate-tag": { fn: cmdCoordinateTag, required: ["package", "tag", "sha"] },
  "coordinate-dispatch": { fn: cmdCoordinateDispatch, required: ["package", "tag", "ref"] },
  "tarball-info": { fn: cmdTarballInfo, required: ["package", "version", "tarball"] },
  "publish-preflight": { fn: cmdPublishPreflight, required: ["tarball", "integrity"] },
};

const USAGE = `Usage: node scripts/release.mjs <command> [options]

Commands (see dev-docs/publishing.md):
  preflight [--package p] [--sha SHA] [--allow-older-sha]
                                            capability + candidate/CI binding report
  request-release --package p --version V --sha SHA [--dry-run] [--allow-older-sha]
                                            run the release coordinator workflow on main
  status --package p [--version V] [--sha SHA]  tag / npm / GitHub Release state and missing steps
  registry-state --package p --version V    exact npm state (exit 3 = uncertain)
  release-notes --package p --version V [--ref SHA]
  ensure-run --package p --tag T [--wait S] confirm the tag run started, else dispatch it
  dispatch --package p --tag T [--ref R] [--dry-run]
  verify-publication --package p --version V --tag T --source-sha SHA [--integrity SRI] [--wait S]
  finalize --package p --version V [--source-sha SHA] [--wait S]   idempotent GitHub Release
  admit --package p                          (publish workflows only)
  coordinate-plan | coordinate-tag | coordinate-dispatch   (release coordinator only)
  tarball-info --package p --version V --tarball F   (publish workflows only)
  publish-preflight --tarball F --integrity SRI      (publish workflows only)

Packages: runtime | initializer`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const spec = COMMANDS[command];
  if (!spec) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      package: { type: "string" },
      version: { type: "string" },
      tag: { type: "string" },
      ref: { type: "string" },
      sha: { type: "string" },
      "source-sha": { type: "string" },
      integrity: { type: "string" },
      wait: { type: "string" },
      tarball: { type: "string" },
      "dry-run": { type: "boolean" },
      "allow-older-sha": { type: "boolean" },
    },
    strict: true,
  });
  for (const name of spec.required) {
    if (!values[name]) throw new ReleaseError(`--${name} is required for ${command}.\n\n${USAGE}`);
  }
  if (values.package) packageConfig(values.package);
  await spec.fn(values);
}

main().catch((error) => {
  const code = error?.code ? ` [${error.code}]` : "";
  console.error(`release ${process.argv[2] ?? ""} failed${code}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = error?.code === "UNCERTAIN" ? 3 : 1;
});
