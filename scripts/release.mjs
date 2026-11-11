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
  REGISTRY,
  REPOSITORY,
  ReleaseError,
  UncertainStateError,
  admitRelease,
  changelogToReleaseNotes,
  classifyRegistryResponse,
  evaluateCiRuns,
  evaluatePublication,
  extractProvenanceStatement,
  findStoredNpmCredentials,
  inspectPackedManifest,
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
  return { status: response.status, body: parsed, error: null };
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
function githubToken({ required = true } = {}) {
  if (cachedToken !== undefined) return cachedToken;
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
  const token = githubToken();
  return httpJson(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
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
  const state = await waitForPresence(config, version, waitSeconds(values, 600));
  if (state.state !== "present") {
    throw new UncertainStateError(
      `${config.selector}@${version} is not visible on npm yet (${state.state}${state.reason ? `: ${state.reason}` : ""}). ` +
        "Do not republish; rerun verification later.",
    );
  }
  let statement = null;
  const attestationsUrl = state.manifest.dist?.attestations?.url;
  if (attestationsUrl) {
    const response = await httpJson(attestationsUrl, { headers: { Accept: "application/json" } });
    if (response.status !== 200) throw new UncertainStateError(`Could not read attestations (${response.status ?? response.error}).`);
    statement = extractProvenanceStatement(response.body);
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
    body: { tag_name: tag, name: releaseTitle(config.packageName, version), body: notes, draft: false, prerelease: false },
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
  checks.push(check("git work tree clean", () => {
    const status = git(["status", "--porcelain"]).stdout.trim();
    if (status) throw new Error("uncommitted changes present");
    return "clean";
  }));
  checks.push(check("branch main == origin/main", () => {
    git(["fetch", "--quiet", "--tags", "origin"]);
    const branch = git(["branch", "--show-current"]).stdout.trim();
    const head = git(["rev-parse", "HEAD"]).stdout.trim();
    const upstream = git(["rev-parse", "origin/main"]).stdout.trim();
    if (branch !== "main") throw new Error(`on ${branch || "detached HEAD"}`);
    if (head !== upstream) throw new Error(`HEAD ${head} != origin/main ${upstream}`);
    return head;
  }));
  checks.push(check("origin is the release repository", () => {
    const url = git(["remote", "get-url", "origin"]).stdout.trim();
    if (!url.replace(/\.git$/u, "").endsWith(REPOSITORY)) throw new Error(url);
    return url;
  }));
  // Capability, not a requirement: without git push, the release commit lands
  // through a merged PR and the tag through the GitHub refs API.
  const pushProbe = git(["push", "--dry-run", "origin", "HEAD:refs/heads/main"], { allowFailure: true });
  const gitPush = pushProbe.status === 0 ? "available" : `unavailable (${pushProbe.stderr.trim().split("\n").pop()})`;

  const registryPing = await httpJson(`${REGISTRY}/-/ping`);
  checks.push({ label: "npm registry reachable", ok: registryPing.status === 200, detail: registryPing.status ?? String(registryPing.error) });

  let tokenOk = false;
  try {
    githubToken();
    tokenOk = true;
    const repo = await github(`/repos/${repository()}`);
    const permissions = repo.body?.permissions ?? {};
    checks.push({ label: "GitHub API auth", ok: repo.status === 200, detail: repo.status });
    checks.push({ label: "GitHub push permission (tag ref, dispatch)", ok: Boolean(permissions.push), detail: JSON.stringify(permissions) });
  } catch (error) {
    checks.push({ label: "GitHub API auth", ok: false, detail: error.message });
  }

  const heavyGuard = process.env.HOME ? path.join(process.env.HOME, ".claude/scripts/heavy-guard.sh") : null;
  const info = {
    platform: `${os.platform()} ${os.arch()}`,
    gitPush,
    tagPath: gitPush === "available" ? "git push origin <tag>" : "GitHub refs API (POST /repos/{repo}/git/refs), then ensure-run",
    heavyGuard: heavyGuard && existsSync(heavyGuard) ? "available (Mac resource admission)" : "not present; run heavy gates directly",
  };

  const candidate = {};
  if (config && tokenOk) {
    const sha = values.sha || git(["rev-parse", "HEAD"]).stdout.trim();
    const version = manifestVersionAt(config, sha);
    const tag = config.tag(version);
    const ci = evaluateCiRuns({ runs: await listRunsForSha(sha), sha });
    Object.assign(candidate, { package: config.selector, sha, version, tag, ci });
    candidate.tagOnOrigin = remoteTag(tag);
    candidate.registry = await registryState(config, version);
    delete candidate.registry.manifest;
    checks.push({ label: `CI on ${sha.slice(0, 12)} (push runs only)`, ok: ci.ok, detail: ci.problems.join("; ") || ci.counted.join(", ") });
    checks.push({ label: "npm state known", ok: candidate.registry.state !== "uncertain", detail: candidate.registry.state });
  }

  for (const item of checks) log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}: ${item.detail}`);
  log(JSON.stringify({ info, candidate }, null, 2));
  if (checks.some((item) => !item.ok)) process.exitCode = 1;
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

async function cmdDispatch(values) {
  const config = packageConfig(values.package);
  const tag = values.tag;
  const ref = values.ref || tag;
  const startedAt = new Date(Date.now() - 5_000).toISOString().replace(/\.\d{3}Z$/u, "Z");
  const response = await github(`/repos/${repository()}/actions/workflows/${config.workflow}/dispatches`, {
    method: "POST",
    body: { ref, inputs: { tag, dry_run: values["dry-run"] ? "true" : "false" } },
  });
  if (response.status !== 204) throw new ReleaseError(`Dispatch failed (HTTP ${response.status ?? response.error}).`);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(3_000);
    const runs = await github(
      `/repos/${repository()}/actions/workflows/${config.workflow}/runs?event=workflow_dispatch&per_page=20&created=${encodeURIComponent(`>=${startedAt}`)}`,
    );
    if (runs.status !== 200) throw new UncertainStateError(`Could not list dispatched runs (HTTP ${runs.status ?? runs.error}).`);
    // Match the ref we dispatched; a concurrent dispatch at another ref is not ours.
    const found = runs.body.workflow_runs.find((candidate) => candidate.head_branch === ref);
    if (found) {
      log(JSON.stringify({ runId: found.id, url: found.html_url, ref, tag, dryRun: Boolean(values["dry-run"]) }));
      return;
    }
  }
  throw new UncertainStateError("Dispatch was accepted but no run appeared yet; check the Actions tab before dispatching again.");
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
  "tarball-info": { fn: cmdTarballInfo, required: ["package", "version", "tarball"] },
  "publish-preflight": { fn: cmdPublishPreflight, required: ["tarball", "integrity"] },
};

const USAGE = `Usage: node scripts/release.mjs <command> [options]

Commands (see dev-docs/publishing.md):
  preflight [--package p] [--sha SHA]       capability + candidate/CI binding report
  status --package p [--version V] [--sha SHA]  tag / npm / GitHub Release state and missing steps
  registry-state --package p --version V    exact npm state (exit 3 = uncertain)
  release-notes --package p --version V [--ref SHA]
  ensure-run --package p --tag T [--wait S] confirm the tag run started, else dispatch it
  dispatch --package p --tag T [--ref R] [--dry-run]
  verify-publication --package p --version V --tag T --source-sha SHA [--integrity SRI] [--wait S]
  finalize --package p --version V [--source-sha SHA] [--wait S]   idempotent GitHub Release
  admit --package p                          (publish workflows only)
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
