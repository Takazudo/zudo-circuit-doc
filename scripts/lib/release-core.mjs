// Shared, deterministic release logic for both npm packages.
//
// Every decision here is a pure function over explicit inputs so the publish
// workflows, the local /l-make-release skill and a Codex Cloud caller all use
// the same rules, and each rule has a direct unit test. Side effects (git, npm
// registry, GitHub REST) live in scripts/release.mjs.

export const REPOSITORY = "Takazudo/zudo-circuit-doc";
export const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;
export const REGISTRY = "https://registry.npmjs.org";
export const SITE_URL = "https://zudo-circuit-doc.zudolab.dev";

// npm SLSA provenance predicate; npm attaches it to trusted-publisher uploads.
export const SLSA_PROVENANCE_V1 = "https://slsa.dev/provenance/v1";

export const PACKAGES = {
  runtime: {
    packageName: "runtime",
    selector: "@takazudo/zudo-circuit-doc",
    manifest: "packages/circuit-doc/package.json",
    packageDir: "packages/circuit-doc",
    workflow: "publish-zudo-circuit-doc.yml",
    changelogDir: "doc/src/content/docs/changelog/zudo-circuit-doc",
    tag: (version) => `v${version}`,
    tagPattern: /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u,
  },
  initializer: {
    packageName: "initializer",
    selector: "create-zudo-circuit-doc",
    manifest: "packages/create-zudo-circuit-doc/package.json",
    packageDir: "packages/create-zudo-circuit-doc",
    workflow: "publish-create-zudo-circuit-doc.yml",
    changelogDir: "doc/src/content/docs/changelog/create-zudo-circuit-doc",
    tag: (version) => `create-zudo-circuit-doc-v${version}`,
    tagPattern: /^create-zudo-circuit-doc-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u,
  },
};

const PACKAGE_ALIASES = {
  runtime: "runtime",
  "@takazudo/zudo-circuit-doc": "runtime",
  initializer: "initializer",
  "create-zudo-circuit-doc": "initializer",
};

export const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export class ReleaseError extends Error {
  constructor(message, { code = "RELEASE_REFUSED" } = {}) {
    super(message);
    this.name = "ReleaseError";
    this.code = code;
  }
}

/** Uncertain external state (network, auth, unexpected status). Never treat as absence. */
export class UncertainStateError extends ReleaseError {
  constructor(message) {
    super(message, { code: "UNCERTAIN" });
    this.name = "UncertainStateError";
  }
}

export function packageConfig(name) {
  const key = PACKAGE_ALIASES[name];
  if (!key) {
    throw new ReleaseError(`Unknown release package ${JSON.stringify(name)}; expected runtime or initializer.`);
  }
  return PACKAGES[key];
}

/** Map a tag to its package namespace. The two namespaces are disjoint. */
export function parseReleaseTag(tag) {
  for (const config of Object.values(PACKAGES)) {
    const match = typeof tag === "string" ? config.tagPattern.exec(tag) : null;
    if (match) return { packageName: config.packageName, version: `${match[1]}.${match[2]}.${match[3]}` };
  }
  return null;
}

/**
 * Validate that a ref is the stable release tag for one package and matches
 * the package version. `refType` is a claim, not proof: callers that publish
 * must also prove the tag exists (see admitRelease).
 */
export function assertReleaseTag({ packageName, refType, refName, version }) {
  const config = PACKAGES[packageName];
  if (!config) {
    throw new ReleaseError(`Unknown release package ${JSON.stringify(packageName)}; expected runtime or initializer.`);
  }
  if (refType !== "tag") {
    throw new ReleaseError(`Release ref must be a tag; received ${JSON.stringify(refType)}.`);
  }
  if (typeof version !== "string" || !STABLE_VERSION_PATTERN.test(version)) {
    throw new ReleaseError(`Manifest version ${JSON.stringify(version)} is not a stable X.Y.Z version.`);
  }
  if (typeof refName !== "string" || !config.tagPattern.test(refName)) {
    throw new ReleaseError(`Tag ${JSON.stringify(refName)} does not use the ${packageName} release namespace.`);
  }
  const expectedTag = config.tag(version);
  if (refName !== expectedTag) {
    throw new ReleaseError(
      `Tag ${JSON.stringify(refName)} does not match ${config.selector}@${version} (expected ${JSON.stringify(expectedTag)}).`,
    );
  }
  return { packageName, package: config.selector, version, tag: refName };
}

/**
 * Parse `git ls-remote origin refs/tags/<tag> refs/tags/<tag>^{}` output into
 * the commit the tag peels to. ls-remote patterns tail-match, so only exact
 * ref names count. Returns null when the tag does not exist on the remote.
 */
export function peelRemoteTag(lsRemoteOutput, tag) {
  const exact = `refs/tags/${tag}`;
  let direct = null;
  let peeled = null;
  for (const line of String(lsRemoteOutput).split(/\r?\n/u)) {
    const [sha, ref] = line.trim().split(/\s+/u);
    if (!sha || !ref) continue;
    if (ref === exact) direct = sha;
    else if (ref === `${exact}^{}`) peeled = sha;
  }
  if (!direct) return null;
  return { tagObject: direct, commit: peeled ?? direct, annotated: peeled != null };
}

/** Resolve which tag a workflow run is asked to release, from event facts only. */
export function resolveRequestedTag({ eventName, ref, inputTag }) {
  const trimmedInput = typeof inputTag === "string" ? inputTag.trim() : "";
  const refTag = typeof ref === "string" && ref.startsWith("refs/tags/") ? ref.slice("refs/tags/".length) : null;

  if (eventName === "push") {
    if (!refTag) throw new ReleaseError(`A push run must come from a tag ref; received ${JSON.stringify(ref)}.`);
    return refTag;
  }
  if (eventName === "workflow_dispatch") {
    if (!trimmedInput) {
      throw new ReleaseError("A manual run must name the exact release tag in the `tag` input; branch publication is refused.");
    }
    if (refTag && refTag !== trimmedInput) {
      throw new ReleaseError(
        `Dispatch ref ${JSON.stringify(ref)} and tag input ${JSON.stringify(trimmedInput)} name different tags.`,
      );
    }
    return trimmedInput;
  }
  throw new ReleaseError(`Unsupported release event ${JSON.stringify(eventName)}.`);
}

/**
 * Classify one exact-version registry lookup. Only a definite answer is
 * presence or absence; anything else is uncertain and must stop the caller.
 */
export function classifyRegistryResponse({ status, body, error }, { selector, version }) {
  if (error) {
    return { state: "uncertain", reason: `registry request failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (status === 200) {
    if (body && typeof body === "object" && body.name === selector && body.version === version) {
      return { state: "present", manifest: body };
    }
    return { state: "uncertain", reason: "registry returned 200 with a document for a different package or version" };
  }
  if (status === 404) {
    // npm answers an unknown version with the JSON string
    // `"version not found: X"` and an unknown package with
    // `{"error":"Not found"}`. Only those exact shapes are definite; a proxy
    // or CDN "404 Not Found" page is not.
    if (body === `version not found: ${version}`) return { state: "absent" };
    if (body && typeof body === "object" && body.error === "Not found") return { state: "absent" };
    const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
    return { state: "uncertain", reason: `registry returned 404 without npm's not-found body: ${text.slice(0, 200)}` };
  }
  return { state: "uncertain", reason: `registry returned HTTP ${status}` };
}

/**
 * Decide what a publish workflow run may do. Inputs are facts gathered by the
 * CLI; the result is the only thing later jobs act on.
 *
 * - The tag must exist on origin and peel to the fetched commit.
 * - The manifest version at that commit must match the tag.
 * - control (github.sha) and source (tag commit) stay distinct: a publish
 *   carries provenance for the control commit, so it is admitted only when
 *   control === source and the run's ref is the tag itself.
 */
export function admitRelease({
  packageName,
  eventName,
  ref,
  inputTag,
  dryRun,
  controlSha,
  remoteTag,
  fetchedTagCommit,
  sourceVersion,
  registry,
}) {
  const config = PACKAGES[packageName];
  if (!config) throw new ReleaseError(`Unknown release package ${JSON.stringify(packageName)}.`);

  const tag = resolveRequestedTag({ eventName, ref, inputTag });
  const parsed = parseReleaseTag(tag);
  if (!parsed || parsed.packageName !== packageName) {
    throw new ReleaseError(`Tag ${JSON.stringify(tag)} does not use the ${packageName} release namespace.`);
  }
  if (!remoteTag) {
    throw new ReleaseError(`Tag ${JSON.stringify(tag)} does not exist as refs/tags/${tag} on origin.`);
  }
  if (!SHA_PATTERN.test(remoteTag.commit ?? "") || remoteTag.commit !== fetchedTagCommit) {
    throw new ReleaseError(
      `Tag ${tag} peels to ${remoteTag.commit} on origin but the fetched tag resolves to ${fetchedTagCommit}.`,
    );
  }
  assertReleaseTag({ packageName, refType: "tag", refName: tag, version: sourceVersion });

  const sourceSha = remoteTag.commit;
  const base = {
    packageName,
    package: config.selector,
    version: parsed.version,
    tag,
    sourceSha,
    controlSha,
    registryState: registry?.state ?? "uncertain",
  };

  if (!registry || registry.state === "uncertain") {
    throw new UncertainStateError(
      `npm registry state of ${config.selector}@${parsed.version} is uncertain (${registry?.reason ?? "no answer"}); refusing to continue.`,
    );
  }

  if (dryRun) {
    return { ...base, mode: "dry-run", reason: "dry_run requested; no publish, no GitHub Release." };
  }
  if (registry.state === "present") {
    return {
      ...base,
      mode: "finalize",
      reason: `${config.selector}@${parsed.version} already exists on npm; publish is skipped and only missing GitHub Release work runs.`,
    };
  }
  if (controlSha !== sourceSha || ref !== `refs/tags/${tag}`) {
    throw new ReleaseError(
      `Refusing to publish ${tag}: the run's control commit ${controlSha} (ref ${ref}) is not the tag commit ${sourceSha}, ` +
        `so provenance would attest the wrong source. Dispatch with --ref ${tag} -f tag=${tag}, or use dry_run.`,
    );
  }
  return { ...base, mode: "publish", reason: `${config.selector}@${parsed.version} is absent on npm; publishing from ${tag}.` };
}

/** Convert an npm SRI `sha512-<base64>` into the hex digest used in attestations. */
export function integrityToSha512Hex(integrity) {
  const match = /^sha512-([A-Za-z0-9+/=]+)$/u.exec(integrity ?? "");
  if (!match) return null;
  return Buffer.from(match[1], "base64").toString("hex");
}

/** Decode the SLSA provenance statement from an npm attestations response. */
export function extractProvenanceStatement(attestationsDocument) {
  const entries = attestationsDocument?.attestations;
  if (!Array.isArray(entries)) return null;
  const entry = entries.find((candidate) => candidate?.predicateType === SLSA_PROVENANCE_V1);
  const payload = entry?.bundle?.dsseEnvelope?.payload;
  if (typeof payload !== "string") return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Judge a registry document (and its provenance statement) against the
 * release we expect. Distinguishes an actual trusted-publisher (OIDC) upload
 * from a version that exists for any other reason.
 */
export function evaluatePublication({ manifest, statement, expected }) {
  const config = PACKAGES[expected.packageName];
  const problems = [];
  const trustedPublisher = manifest?._npmUser?.trustedPublisher ?? null;
  if (!trustedPublisher) problems.push("registry shows no trusted-publisher (OIDC) uploader for this version");
  if (expected.integrity && manifest?.dist?.integrity !== expected.integrity) {
    problems.push(`registry integrity ${manifest?.dist?.integrity} differs from the verified tarball ${expected.integrity}`);
  }

  if (!statement) {
    problems.push("no SLSA provenance attestation is attached");
  } else {
    const dependency = statement.predicate?.buildDefinition?.resolvedDependencies?.[0];
    const workflow = statement.predicate?.buildDefinition?.externalParameters?.workflow;
    const expectedUri = `git+${REPOSITORY_URL}@refs/tags/${expected.tag}`;
    if (dependency?.uri !== expectedUri) problems.push(`provenance source ${dependency?.uri} is not ${expectedUri}`);
    if (dependency?.digest?.gitCommit !== expected.sourceSha) {
      problems.push(`provenance commit ${dependency?.digest?.gitCommit} is not the tag commit ${expected.sourceSha}`);
    }
    if (workflow?.path !== `.github/workflows/${config.workflow}` || workflow?.repository !== REPOSITORY_URL) {
      problems.push(`provenance workflow ${workflow?.repository}/${workflow?.path} is not ${REPOSITORY_URL}/.github/workflows/${config.workflow}`);
    }
    const expectedHex = integrityToSha512Hex(manifest?.dist?.integrity);
    const subjectHex = statement.subject?.[0]?.digest?.sha512;
    if (expectedHex && subjectHex !== expectedHex) problems.push("provenance subject digest does not match the registry tarball");
  }

  return {
    verdict: problems.length === 0 ? "oidc-verified" : trustedPublisher ? "oidc-mismatch" : "not-oidc",
    trustedPublisher,
    problems,
  };
}

/** Release title shape used by every existing GitHub Release. */
export function releaseTitle(packageName, version) {
  return `${PACKAGES[packageName].selector} ${version}`;
}

/**
 * Turn a changelog MDX page into GitHub Release notes: drop frontmatter and
 * rewrite relative .mdx links to the published documentation site.
 */
export function changelogToReleaseNotes(mdx, { packageName }) {
  const config = PACKAGES[packageName];
  const withoutFrontmatter = String(mdx).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, "");
  const pageDir = config.changelogDir.replace(/^doc\/src\/content\//u, "");
  const rewritten = withoutFrontmatter.replace(/\]\((\.{1,2}\/[^)\s]+?)\.mdx(#[^)\s]*)?\)/gu, (_match, relative, hash = "") => {
    const parts = `${pageDir}/${relative}`.split("/");
    const resolved = [];
    for (const part of parts) {
      if (part === "..") resolved.pop();
      else if (part !== "." && part !== "") resolved.push(part);
    }
    const target = resolved.join("/");
    // A link to another changelog page points at that version's GitHub Release,
    // matching how earlier releases were written.
    for (const other of Object.values(PACKAGES)) {
      const otherDir = other.changelogDir.replace(/^doc\/src\/content\//u, "");
      const version = target.startsWith(`${otherDir}/`) ? target.slice(otherDir.length + 1) : null;
      if (version && STABLE_VERSION_PATTERN.test(version)) {
        return `](${REPOSITORY_URL}/releases/tag/${other.tag(version)}${hash})`;
      }
    }
    return `](${SITE_URL}/${target}/${hash})`;
  });
  const notes = rewritten.trim();
  if (!notes) throw new ReleaseError("Changelog page has no body to use as release notes.");
  if (/Released:\s*unreleased/iu.test(notes)) throw new ReleaseError("Changelog page is still marked unreleased.");
  return `${notes}\n`;
}

/**
 * Decide GitHub Release work for a tag. Existing published releases are kept
 * exactly as they are (notes included); only an absent release is created.
 */
export function planGithubRelease({ existing, tag }) {
  if (existing.state === "uncertain") {
    throw new UncertainStateError(`GitHub Release state for ${tag} is uncertain (${existing.reason}).`);
  }
  if (existing.state === "absent") return { action: "create" };
  const release = existing.release;
  if (release.tag_name !== tag) throw new ReleaseError(`GitHub returned release for ${release.tag_name}, not ${tag}.`);
  if (release.draft) {
    throw new ReleaseError(`GitHub Release for ${tag} is a draft; publish or delete it manually, then rerun finalization.`);
  }
  if (release.prerelease) {
    throw new ReleaseError(`GitHub Release for ${tag} is marked prerelease, which contradicts the stable-only policy.`);
  }
  return { action: "keep", url: release.html_url };
}

/**
 * GitHub labels a newly created Release "Latest" unless `make_latest` says
 * otherwise, so backfilling an older version must not take that label from a
 * newer release in the same package namespace.
 */
export function makeLatestFor({ tag, remoteTags }) {
  const target = parseReleaseTag(tag);
  if (!target) throw new ReleaseError(`${JSON.stringify(tag)} is not a release tag.`);
  const newer = remoteTags
    .map((name) => parseReleaseTag(name))
    .filter((parsed) => parsed && parsed.packageName === target.packageName)
    .some((parsed) => compareVersions(parsed.version, target.version) > 0);
  return newer ? "false" : "true";
}

function compareVersions(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * Executed-CI binding for a candidate commit. Only push-event runs whose
 * head SHA is the candidate count: a pull_request run tested a merge tree,
 * which is a different tree from the commit that would be tagged.
 */
export function evaluateCiRuns({ runs, sha }) {
  // The publish workflows also run on push (of a tag at this commit); they
  // are release attempts, not CI for the candidate.
  const publishPaths = new Set(Object.values(PACKAGES).map((config) => `.github/workflows/${config.workflow}`));
  const forSha = runs.filter((run) => run.headSha === sha && !publishPaths.has(run.path));
  const counted = forSha.filter((run) => run.event === "push");
  const ignored = forSha.filter((run) => run.event !== "push");
  const pending = counted.filter((run) => run.status !== "completed");
  const failed = counted.filter(
    (run) => run.status === "completed" && !["success", "skipped", "neutral"].includes(run.conclusion),
  );
  const problems = [];
  if (counted.length === 0) problems.push(`no push-event workflow runs found for ${sha}`);
  for (const run of pending) problems.push(`${run.workflowName} is ${run.status}`);
  for (const run of failed) problems.push(`${run.workflowName} concluded ${run.conclusion}`);
  return {
    ok: problems.length === 0,
    problems,
    counted: counted.map((run) => `${run.workflowName}: ${run.conclusion ?? run.status}`),
    ignored: ignored.map((run) => `${run.workflowName} (${run.event})`),
  };
}

/**
 * Which release operations are still missing for one prepared version.
 * Uncertain inputs stop the plan; nothing is guessed.
 */
export function planResume({ packageName, version, preparedSha, remoteTag, registry, githubRelease }) {
  const config = PACKAGES[packageName];
  const tag = config.tag(version);
  if (registry.state === "uncertain") {
    throw new UncertainStateError(`npm state of ${config.selector}@${version} is uncertain (${registry.reason}).`);
  }
  if (githubRelease.state === "uncertain") {
    throw new UncertainStateError(`GitHub Release state for ${tag} is uncertain (${githubRelease.reason}).`);
  }
  if (remoteTag && preparedSha && remoteTag.commit !== preparedSha) {
    throw new ReleaseError(`Tag ${tag} already points to ${remoteTag.commit}, not ${preparedSha}; never move a pushed tag.`);
  }
  if (!remoteTag && registry.state === "present") {
    throw new ReleaseError(`${config.selector}@${version} is on npm but ${tag} is missing on origin; reconcile manually.`);
  }

  const steps = [];
  if (!remoteTag) steps.push("push-tag");
  if (registry.state === "absent") steps.push("publish");
  if (githubRelease.state === "absent") steps.push("github-release");
  return { tag, steps, done: steps.length === 0 };
}

/** A packed manifest must be the admitted package/version with workspace ranges rewritten. */
export function inspectPackedManifest(manifest, { selector, version }) {
  const problems = [];
  if (manifest?.name !== selector) problems.push(`name ${manifest?.name} is not ${selector}`);
  if (manifest?.version !== version) problems.push(`version ${manifest?.version} is not ${version}`);
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [name, range] of Object.entries(manifest?.[field] ?? {})) {
      if (/^(workspace|link|file|catalog):/u.test(String(range))) problems.push(`${field}.${name} still uses ${range}`);
    }
  }
  return problems;
}

/**
 * Stored npm write credentials that pnpm could fall back to when the OIDC
 * exchange fails ("Skipped OIDC"). The publish job must have none.
 */
export function findStoredNpmCredentials({ env, npmrcFiles }) {
  const problems = [];
  for (const name of Object.keys(env)) {
    if (/^(NODE_AUTH_TOKEN|NPM_TOKEN)$/u.test(name) || /^npm_config_.*(_authtoken|_auth|_password)$/iu.test(name)) {
      if (env[name]) problems.push(`environment variable ${name} is set`);
    }
  }
  for (const { file, text } of npmrcFiles) {
    if (/(^|\n)\s*[^#;\n]*:?_(authToken|auth|password)\s*=/u.test(text)) problems.push(`${file} contains an npm auth entry`);
  }
  return problems;
}

// ---------------------------------------------------------------- release coordinator
//
// .github/workflows/release-coordinator.yml creates the release tag with the
// run's GITHUB_TOKEN and then dispatches the package's existing publish
// workflow explicitly. These functions decide what one coordinator run may do
// from facts gathered by scripts/release.mjs.

export const COORDINATOR_WORKFLOW = "release-coordinator.yml";
// Job display name in both publish workflows; its conclusion tells whether an
// earlier run already reached npm.
export const PUBLISH_JOB_NAME = "Publish with OIDC";
// The generated project manifest whose runtime range the published-runtime gate installs.
export const INITIALIZER_TEMPLATE_MANIFEST = "packages/create-zudo-circuit-doc/templates/default/package.json";

const ACTIVE_RUN_STATES = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);

/** Validate the coordinator's dispatch inputs before any network call. */
export function parseCoordinatorInputs({ packageName, version, sha, dryRun, allowOlderSha, ref }) {
  const config = packageConfig(String(packageName ?? "").trim());
  const trimmedVersion = String(version ?? "").trim();
  const trimmedSha = String(sha ?? "").trim();
  if (ref !== "refs/heads/main") {
    throw new ReleaseError(`The release coordinator runs only from main; this run's ref is ${JSON.stringify(ref)}.`);
  }
  if (!STABLE_VERSION_PATTERN.test(trimmedVersion)) {
    throw new ReleaseError(`Version ${JSON.stringify(trimmedVersion)} is not a stable X.Y.Z version (no prerelease, no leading v).`);
  }
  if (!SHA_PATTERN.test(trimmedSha)) {
    throw new ReleaseError(`sha must be a full 40-character lowercase commit SHA; received ${JSON.stringify(trimmedSha)}.`);
  }
  return {
    packageName: config.packageName,
    version: trimmedVersion,
    sha: trimmedSha,
    tag: config.tag(trimmedVersion),
    dryRun: /^true$/iu.test(String(dryRun ?? "")),
    allowOlderSha: /^true$/iu.test(String(allowOlderSha ?? "")),
  };
}

/** Does the generated package CHANGELOG.md carry a dated entry for this version? */
export function changelogHasEntry(markdown, version) {
  const escaped = version.replace(/\./gu, "\\.");
  return new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}\\s*$`, "mu").test(String(markdown ?? ""));
}

/**
 * Reduce the publish-workflow runs whose ref is the tag to what matters for
 * a resume: is one still running, and did any earlier run's publish job
 * succeed (npm accepted an upload even if the run later failed)?
 */
export function summarizePublisherRuns(runs) {
  const active = runs.filter((run) => ACTIVE_RUN_STATES.has(run.status));
  const published = runs.filter((run) => run.publishJob?.conclusion === "success");
  return { active, published, total: runs.length };
}

/** The runtime range a generated project installs; the template lists it under devDependencies. */
export function templateRuntimeRange(manifest, selector) {
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const range = manifest?.[field]?.[selector];
    if (range) return range;
  }
  return null;
}

/**
 * The initializer's published-runtime gate needs the runtime it was prepared
 * with to be completely released first. `runtime` holds the runtime manifest
 * version at the candidate commit and that version's release facts.
 */
export function assessRuntimeGate({ runtimeVersion, templateRange, remoteTag, registry, githubRelease }) {
  const problems = [];
  const expectedRange = `^${runtimeVersion}`;
  if (templateRange !== expectedRange) {
    problems.push(`initializer template selects runtime ${JSON.stringify(templateRange)}, not ${expectedRange} (the runtime manifest at this commit)`);
  }
  if (registry.state === "uncertain") {
    throw new UncertainStateError(`npm state of @takazudo/zudo-circuit-doc@${runtimeVersion} is uncertain (${registry.reason}).`);
  }
  if (githubRelease.state === "uncertain") {
    throw new UncertainStateError(`GitHub Release state for v${runtimeVersion} is uncertain (${githubRelease.reason}).`);
  }
  if (registry.state !== "present") problems.push(`runtime ${runtimeVersion} is not on npm yet; release the runtime first`);
  if (!remoteTag) problems.push(`runtime tag v${runtimeVersion} does not exist`);
  if (githubRelease.state !== "present") problems.push(`runtime v${runtimeVersion} has no GitHub Release yet; finish the runtime release first`);
  return { ok: problems.length === 0, problems };
}

/**
 * Decide one coordinator run. Throws (refuses) on anything inconsistent or
 * uncertain; otherwise returns the single next action:
 *
 * - `create-tag`: tag absent, npm absent, candidate fully verified. Create the
 *   tag at `sha`, then dispatch the publisher at the tag.
 * - `dispatch-publish`: tag already at `sha`, npm definitely absent, no run in
 *   flight and no earlier run's publish job succeeded. Dispatch at the tag.
 * - `dispatch-finalize`: npm has the version, the GitHub Release is missing.
 *   Dispatch at main (finalize-only; never republishes).
 * - `wait`: a publisher run is in flight, or an earlier run's publish job
 *   succeeded while npm does not show the version yet. Do nothing; rerun later.
 * - `complete`: tag, npm and GitHub Release all present.
 */
export function planCoordinator(facts) {
  const {
    packageName,
    version,
    sha,
    tag,
    allowOlderSha = false,
    mainHead,
    inMain,
    manifestVersion,
    changelog,
    generatedChangelogHasEntry,
    ci,
    remoteTag,
    registry,
    githubRelease,
    publisherRuns = [],
    runtimeGate = null,
  } = facts;
  const config = PACKAGES[packageName];
  if (!config) throw new ReleaseError(`Unknown release package ${JSON.stringify(packageName)}.`);
  if (tag !== config.tag(version)) throw new ReleaseError(`Tag ${tag} is not the ${packageName} tag for ${version}.`);

  const base = { packageName, package: config.selector, version, sha, tag, mainHead, workflow: config.workflow };

  // Candidate identity: the commit is on main and is this package's release
  // commit for this version. A runtime version given to the initializer (or
  // the reverse) fails here because the other manifest carries another version.
  if (!inMain) throw new ReleaseError(`${sha} is not on main (not an ancestor of ${mainHead}).`);
  if (manifestVersion !== version) {
    throw new ReleaseError(`${config.manifest} at ${sha} is ${JSON.stringify(manifestVersion)}, not ${version}.`);
  }
  if (!changelog.ok) throw new ReleaseError(`Changelog page for ${config.selector} ${version} at ${sha}: ${changelog.problem}`);
  if (!generatedChangelogHasEntry) {
    throw new ReleaseError(`${config.packageDir}/CHANGELOG.md at ${sha} has no dated "## [${version}]" entry; run pnpm doc:build.`);
  }

  // Exact external state. Uncertain never counts as absence.
  if (registry.state === "uncertain") {
    throw new UncertainStateError(`npm state of ${config.selector}@${version} is uncertain (${registry.reason}); nothing was changed.`);
  }
  if (githubRelease.state === "uncertain") {
    throw new UncertainStateError(`GitHub Release state for ${tag} is uncertain (${githubRelease.reason}); nothing was changed.`);
  }

  if (remoteTag) {
    if (remoteTag.commit !== sha) {
      throw new ReleaseError(
        `Tag ${tag} already exists at ${remoteTag.commit}, not the requested ${sha}. A pushed tag is never moved; ` +
          `resume with sha=${remoteTag.commit}, or release a new version.`,
      );
    }
    if (registry.state === "present") {
      if (githubRelease.state === "present") {
        return { ...base, action: "complete", reason: `${tag} is tagged, on npm and has a GitHub Release; nothing to do.` };
      }
      return {
        ...base,
        action: "dispatch-finalize",
        dispatchRef: "main",
        reason: `${config.selector}@${version} is on npm but has no GitHub Release; dispatching a finalize-only run at main.`,
      };
    }
    // npm definitely absent. A failed run alone is not proof of absence; an
    // earlier run whose publish job succeeded means npm accepted an upload.
    const runs = summarizePublisherRuns(publisherRuns);
    if (runs.active.length > 0) {
      return {
        ...base,
        action: "wait",
        reason: `A ${config.workflow} run for ${tag} is still running (${runs.active.map((run) => run.url).join(", ")}); not dispatching another.`,
      };
    }
    if (runs.published.length > 0) {
      return {
        ...base,
        action: "wait",
        reason:
          `An earlier ${config.workflow} run's publish job succeeded (${runs.published.map((run) => run.url).join(", ")}) ` +
          `but npm does not show ${version} yet. Never republish: rerun the coordinator later, and it will finalize once npm shows the version.`,
      };
    }
    if (runtimeGate && !runtimeGate.ok) throw new ReleaseError(`Initializer gate: ${runtimeGate.problems.join("; ")}.`);
    if (!ci.ok) throw new ReleaseError(`CI on ${sha} is not green: ${ci.problems.join("; ")}.`);
    return {
      ...base,
      action: "dispatch-publish",
      dispatchRef: tag,
      reason: `Resuming ${tag} at its original commit: npm does not have ${version} and no earlier run published it.`,
    };
  }

  // New release: no tag yet.
  if (registry.state === "present") {
    throw new ReleaseError(`${config.selector}@${version} is on npm but ${tag} is missing on origin; reconcile manually.`);
  }
  if (githubRelease.state === "present") {
    throw new ReleaseError(`A GitHub Release for ${tag} exists without the tag; reconcile manually.`);
  }
  if (!ci.ok) throw new ReleaseError(`CI on ${sha} is not green: ${ci.problems.join("; ")}.`);
  if (sha !== mainHead && !allowOlderSha) {
    throw new ReleaseError(
      `main has moved to ${mainHead} since ${sha}. The coordinator never swaps the candidate silently: ` +
        `dispatch again with sha=${mainHead} once its push CI is green, or set allow_older_sha to tag ${sha} on purpose.`,
    );
  }
  if (runtimeGate && !runtimeGate.ok) throw new ReleaseError(`Initializer gate: ${runtimeGate.problems.join("; ")}.`);
  return {
    ...base,
    action: "create-tag",
    dispatchRef: tag,
    reason: `New release: tag ${tag} at ${sha}, then dispatch ${config.workflow} at the tag.`,
  };
}

/**
 * Interpret the refs API answer to `POST /git/refs` for a release tag.
 * 201 created; 422 "Reference already exists" must be re-read by the caller
 * (same SHA resumes, another SHA is refused). Anything else is a failure the
 * caller reports with diagnostics.
 */
export function classifyTagCreate({ status, body }) {
  if (status === 201) return { outcome: "created" };
  const message = typeof body === "object" && body ? String(body.message ?? "") : String(body ?? "");
  if (status === 422 && /reference already exists/iu.test(message)) return { outcome: "exists" };
  return { outcome: "failed", message };
}

/** Decide after a 422 re-read: an existing tag at the same commit resumes, any other commit is refused. */
export function resolveExistingTag({ tag, sha, remoteTag }) {
  if (!remoteTag) throw new UncertainStateError(`GitHub said ${tag} exists, but origin does not list it; check again.`);
  if (remoteTag.commit !== sha) {
    throw new ReleaseError(`Tag ${tag} was created concurrently at ${remoteTag.commit}, not ${sha}; refusing. Never move a pushed tag.`);
  }
  return { outcome: "resumed" };
}

/**
 * Human-readable diagnostics for a failed GitHub write (tag creation or a
 * dispatch). States facts only; the cause of a 403 is not asserted.
 */
export function describeGithubWriteFailure({ operation, status, body, headers = {}, declaredPermissions, sha, mainHead, workflowDiff }) {
  const lines = [`${operation} failed: HTTP ${status ?? "no response"}`];
  if (body && typeof body === "object") {
    if (body.message) lines.push(`GitHub message: ${body.message}`);
    if (body.documentation_url) lines.push(`Documentation: ${body.documentation_url}`);
    for (const error of body.errors ?? []) lines.push(`Detail: ${typeof error === "string" ? error : JSON.stringify(error)}`);
  } else if (body) {
    lines.push(`GitHub body: ${String(body).slice(0, 500)}`);
  }
  const accepted = headers["x-accepted-github-permissions"];
  if (accepted) lines.push(`GitHub accepts these token permissions for this call: ${accepted}`);
  if (headers["x-github-request-id"]) lines.push(`GitHub request id: ${headers["x-github-request-id"]}`);
  if (declaredPermissions) lines.push(`This job's declared GITHUB_TOKEN permissions: ${declaredPermissions}`);
  if (sha) {
    lines.push(`Candidate SHA: ${sha}${mainHead ? (sha === mainHead ? " (= main HEAD)" : ` (main HEAD is ${mainHead})`) : ""}`);
  }
  if (workflowDiff) {
    lines.push(
      workflowDiff.length === 0
        ? "Workflow files: identical between the candidate and main HEAD"
        : `Workflow files that differ between the candidate and main HEAD: ${workflowDiff.join(", ")}`,
    );
  }
  if (status === 403 || status === 401) {
    lines.push(
      "Cause not determined by this run. Possible owner checks: Settings → Actions → General → Workflow permissions, " +
        "tag rulesets or protection, and whether GitHub restricts GITHUB_TOKEN refs on commits whose workflow files differ from main. " +
        "Nothing was changed; this coordinator never retries with another credential.",
    );
  }
  return lines;
}
