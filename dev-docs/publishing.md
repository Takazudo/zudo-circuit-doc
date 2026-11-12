# Publishing

Canonical release procedure for both npm packages: policy, the publish workflows, the shared
release helper, recovery, and owner-only npm/credential steps.

Both the Claude Code skill [`/l-make-release`](../.claude/skills/l-make-release/SKILL.md) and the
Codex skill [`release`](../.agents/skills/release/SKILL.md) follow this page. They add judgement
(what to release, changelog writing). The rules and the deterministic steps live here and in
`scripts/release.mjs`, not in either skill.

## Release policy

Releases use the stable npm `latest` channel only. There are no `next` tags or prerelease versions.
Each package's own `package.json` is its version source; the private root `package.json` is never
bumped for a release.

| Package | Release tag | Publish workflow |
| --- | --- | --- |
| `@takazudo/zudo-circuit-doc` | `vX.Y.Z` (`v*.*.*`) | [publish-zudo-circuit-doc.yml](https://github.com/Takazudo/zudo-circuit-doc/blob/main/.github/workflows/publish-zudo-circuit-doc.yml) |
| `create-zudo-circuit-doc` | `create-zudo-circuit-doc-vX.Y.Z` (`create-zudo-circuit-doc-v*.*.*`) | [publish-create-zudo-circuit-doc.yml](https://github.com/Takazudo/zudo-circuit-doc/blob/main/.github/workflows/publish-create-zudo-circuit-doc.yml) |

For pre-1.0 releases, use Scheme B: a breaking change increments the minor version; other changes
increment the patch version. Finalize the package's [changelog](/docs/changelog) page, create the
release commit, and tag that new commit. Never tag an old commit whose tree was not verified.

Publish the runtime before the initializer. The initializer's publish gate,
`pnpm verify:pack --fixture empty --published-runtime`, installs the runtime version selected by
the template's `^X.Y.Z` range from npm. That version must already be live. A runtime patch by itself
does not require an initializer release; a runtime minor or major release does, because the
initializer's runtime range must be updated and verified.

## How the publish workflows work

Creating the release tag is the release boundary. The [release coordinator](#release-coordinator)
creates it from GitHub Actions and then starts the publish workflow explicitly; a tag pushed by the
owner still starts it through the tag trigger. There is no stored npm credential: each workflow publishes
through [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) with a short-lived
GitHub OIDC identity, and npm attaches SLSA provenance for the tag commit.

Each workflow has five jobs. Each job gets only the permissions listed for it:

| Job | Permissions | What it does |
| --- | --- | --- |
| `admit` | `contents: read` | Resolves the requested tag and proves it exists as `refs/tags/<tag>` on origin. It peels the tag to its commit, checks the package version at that commit, and reads the exact npm state. Then it picks a mode. |
| `verify` | `contents: read` | Checks out the tag commit and runs every release gate. Then it packs the tarball and runs `pnpm publish --dry-run` on it. |
| `publish` | `contents: read`, `id-token: write` | Downloads the verified tarball and checks its integrity. It refuses to run if any stored npm credential exists. Then it runs `pnpm publish <tarball> --provenance`. No dependency install runs in this job. |
| `confirm` | `contents: read` | Requires `_npmUser.trustedPublisher` on the new version, plus provenance whose source is this tag and its commit and whose subject is the verified tarball. |
| `finalize` | `contents: write` | Creates the GitHub Release from the changelog page if it is missing. It keeps an existing release exactly as it is and never publishes. |

Release gates in `verify`: build, typecheck, `pnpm test` (TypeScript, Python and script tests),
template drift (`check:template`), the docs build plus the generated-changelog diff, and consumer
installs. The runtime runs `check:shape`, `verify:pack --fixture empty` and
`verify:pack --fixture minimal`. The initializer runs
`verify:pack --fixture empty --published-runtime`.

`admit` chooses one mode:

| Mode | When | Jobs that run |
| --- | --- | --- |
| `publish` | The version is absent on npm, and the run's ref **is** the tag (a tag push, or a dispatch with `--ref <tag>`) | all |
| `finalize` | The version already exists on npm | `admit`, `finalize` |
| `dry-run` | `dry_run: true` | `admit`, `verify` |
| *(refused)* | Wrong namespace, missing tag, version mismatch, a branch without a tag, uncertain npm state, or a publish whose run commit is not the tag commit | `admit` fails |

**Control vs source.** `github.sha` (the run's *control* commit) and the tag commit (the *source*)
are recorded separately. npm provenance attests the run's own commit. A dispatch from `main` for
an older tag would therefore attest old contents as `main`, so such a run may only dry-run or
finalize. To actually publish a tag, the run must use that tag as its ref.

The publishing executable is pnpm (`packageManager`, currently 11.5.2). It publishes natively and
performs the npm OIDC token exchange itself; npm CLI is not involved. pnpm only *warns* ("Skipped
OIDC") when the exchange fails. The `publish` job therefore refuses to start if any token
configuration exists, and `confirm` fails unless npm recorded a trusted-publisher upload.

Every GitHub write uses the run's own `GITHUB_TOKEN`, scoped to the one job that needs it. Nothing
relies on a `GITHUB_TOKEN`-created tag or Release to start another workflow, because GitHub never
triggers workflows from those. When orchestration needs a run, it dispatches one explicitly
(the coordinator's `dispatch` job, or `release.mjs ensure-run` / `dispatch`).

## Release coordinator

[release-coordinator.yml](https://github.com/Takazudo/zudo-circuit-doc/blob/main/.github/workflows/release-coordinator.yml)
is a manual (`workflow_dispatch`) workflow that runs on `main`. It turns a verified release commit
into a tag and a publish run without any caller pushing a tag. No caller needs `git push`, `gh`, or
a personal token for the tag.

Inputs:

| Input | Meaning |
| --- | --- |
| `package` | `runtime` or `initializer` |
| `version` | The exact stable version in that package's manifest at `sha` (`X.Y.Z`) |
| `sha` | The full 40-character release commit. It is used exactly as given. |
| `dry_run` | Default **true**. Plan and report only. |
| `allow_older_sha` | Default false. Allows a *new* tag on a SHA that is no longer `main` HEAD. |

Jobs, each with only the permissions listed:

| Job | Permissions | What it does |
| --- | --- | --- |
| `plan` | `contents: read`, `actions: read` | Refuses unless the run's ref is `main`, `sha` is on `main`, the package manifest at `sha` is `version`, the changelog page is finalized, the generated `CHANGELOG.md` has the dated entry, and the tag name is the package's own. Reads push-event CI on exactly `sha`, the exact npm state, the tag, the GitHub Release and earlier publisher runs at the tag. Then picks one action (below). It writes a summary table of every fact. |
| `tag` | `contents: write` | Only for `create-tag`. Rechecks npm is absent and creates `refs/tags/<tag>` at `sha` with `GITHUB_TOKEN`. An existing tag at the same SHA resumes; another SHA is refused. |
| `dispatch` | `actions: write`, `contents: read` | Dispatches the package's publish workflow, at the tag for a publish or at `main` for finalize-only. It reads the new run back, watches it, and reports the run's jobs, npm state, `trustedPublisher`, and GitHub Release. |

| Action | When | What happens |
| --- | --- | --- |
| `create-tag` | No tag, npm absent, CI green, `sha` is `main` HEAD (or `allow_older_sha`), and the initializer gate passes | Tag, then dispatch at the tag |
| `dispatch-publish` | Tag exists **at `sha`**, npm definitely absent, no publisher run in flight, no earlier run's `Publish with OIDC` job succeeded, CI green, initializer gate passes | Dispatch at the tag. The original SHA is kept even if `main` moved. |
| `dispatch-finalize` | Tag at `sha`, npm present, GitHub Release missing | Dispatch at `main`: finalize-only, never republishes |
| `wait` | A publisher run for the tag is in flight, or an earlier run's publish job succeeded but npm does not show the version yet | Nothing. Rerun the coordinator later. |
| `complete` | Tag, npm and GitHub Release all present | Nothing |
| *(refused)* | Tag at another SHA, npm present without a tag, a Release without a tag, version or package mismatch, `sha` outside `main`, stale or red CI, `main` moved past a new candidate, uncertain npm or GitHub state, or an unreleased runtime for the initializer | `plan` fails and nothing is written |

`dry_run` runs `plan` only. It creates no tag, dispatches nothing, and writes nothing. It cannot
prove the publish itself; that needs the real run.

**Initializer gate.** For an initializer publish, the runtime manifest version at `sha` must be on
npm, tagged, and have its GitHub Release, and the initializer template must select it as
`^<that version>`. So the runtime release finishes before the initializer can start.

**A failed run is not proof of absence.** Before redispatching a publish, `plan` reads npm exactly
and checks every earlier publisher run at the tag. If any run's `Publish with OIDC` job succeeded,
npm accepted an upload (as with runtime 0.3.1, whose attestations appeared late), so the coordinator
waits rather than republishing. Rerunning it later with the same inputs finalizes once npm shows
the version. Resubmitting the same inputs is always safe: it resumes, waits, or reports `complete`.

**Diagnosing a failed tag or dispatch.** A failed write prints GitHub's status, message,
documentation URL, accepted-permissions header and request id. It also prints the job's declared
`GITHUB_TOKEN` permissions, the candidate SHA against `main` HEAD, and any workflow files that
differ between them. It does not guess a cause. In another repository, a `GITHUB_TOKEN` tag on the
latest `main` commit worked while one on an older commit was refused with 403; the reason was not
confirmed, which is why new candidates default to `main` HEAD. The coordinator never retries with
another credential, and it changes no repository setting. Owner checks for a 403: **Settings →
Actions → General → Workflow permissions**, tag rulesets or protection, and whether the candidate's
workflow files differ from `main`.

### Starting the coordinator

Use the first one that works. Each needs only the inputs above.

1. **API:** `node scripts/release.mjs request-release --package <p> --version <v> --sha <sha> [--dry-run]`.
   This needs a GitHub credential that can dispatch workflows. It prints the run URL.
2. **GitHub MCP** (for example a Cloud session without `gh`): `actions_run_trigger` with
   `method: run_workflow`, `workflow_id: release-coordinator.yml`, `ref: main`, and inputs
   `{package, version, sha, dry_run, allow_older_sha}` as strings. Read it back with
   `actions_list` (`list_workflow_runs` for `release-coordinator.yml`) and `actions_get`
   (`get_workflow_run`), and read the run's job summary.
3. **Manually:** on GitHub, **Actions → Release coordinator → Run workflow**, branch `main`. Fill in
   the inputs, untick `dry_run` for a real release, and open the run's summary.

Run it with `dry_run` first and read the plan. Then run it again with the same inputs and
`dry_run` unticked.

## Release helper

`scripts/release.mjs` is the single deterministic entry point for local, Cloud, and workflow
callers. It needs Node 24, git, network access, and a GitHub credential (`GH_TOKEN` or
`GITHUB_TOKEN`, or an authenticated `gh`). It needs no home-directory files, global skills, or
persistent shell state.

| Command | Use |
| --- | --- |
| `node scripts/release.mjs preflight --package <p> [--sha <sha>]` | Capability and candidate report. Required: Node/pnpm versions, origin URL, npm reachability, and GitHub reads. Without `--sha` it also requires a clean `main` equal to `origin/main`, because local HEAD is the candidate; with `--sha` those are informational. Capabilities, never a `FAIL` on their own: the GitHub credential (valid, rejected, or none; reads fall back to anonymous), `git push`, and the release path to use. It binds the candidate SHA to its manifest version and tag, checks push CI and exact npm state, and shows the coordinator's plan; with `--sha`, a coordinator refusal is a `FAIL`. Exits non-zero on any failure. |
| `node scripts/release.mjs request-release --package <p> --version <v> --sha <sha> [--dry-run] [--allow-older-sha]` | Run the release coordinator on `main` through the API and print its run URL. |
| `node scripts/release.mjs status --package <p> [--version <v>] [--sha <sha>]` | Tag, npm, and GitHub Release state, plus the release operations still missing (`push-tag`, `publish`, `github-release`). |
| `node scripts/release.mjs registry-state --package <p> --version <v>` | Exact npm state: `present`, `absent`, or `uncertain` (exit 3). |
| `node scripts/release.mjs release-notes --package <p> --version <v>` | The GitHub Release body generated from the changelog page. |
| `node scripts/release.mjs ensure-run --package <p> --tag <t>` | After an owner's own tag push, waits for a publish-workflow run whose ref is the tag. If none appears, it dispatches one at the tag. A run dispatched at the tag with `dry_run` also counts, so check the run's mode. |
| `node scripts/release.mjs dispatch --package <p> --tag <t> [--ref main] [--dry-run]` | Explicit workflow dispatch. |
| `node scripts/release.mjs finalize --package <p> --version <v>` | Idempotent GitHub Release completion. It requires the exact version on npm and never publishes. |

`<p>` is `runtime` or `initializer`.

**CI binding.** A candidate counts as tested only when its *push-event* runs on the exact commit
have all finished green. `pull_request` runs tested GitHub's merge tree, which is a different tree,
so `preflight` lists them as ignored rather than counting them. Push the release commit to `main`
and wait for its own runs before tagging it.

**Heavy commands.** On the owner's Mac, run builds and `verify:pack` through
`bash $HOME/.claude/scripts/heavy-guard.sh -- <command>`, as described in [CLAUDE.md](../CLAUDE.md).
That guard is a Mac-local resource queue. If `preflight` reports it as not present (for example
in Codex Cloud), run the same commands directly.

## Release procedure

`/l-make-release` (Claude Code) and the Codex `release` skill drive these steps. Package selection,
version judgement, and changelog writing are described in those skills.

1. **Preflight.** `node scripts/release.mjs preflight --package <p>`. Stop on any `FAIL`. Read the
   `info` block: it says which credential works and which release path to use.
2. **Prepare** the release commit: the manifest version and changelog page. For the runtime,
   regenerate the template (`pnpm sync:template`). Then run `pnpm doc:build` to regenerate the
   package `CHANGELOG.md`.
3. **Local gate** on the prepared tree: `pnpm build`, `pnpm typecheck`, `pnpm test`,
   `pnpm check:template`, `pnpm release:dry-run`. For the runtime, also run
   `pnpm verify:pack --fixture empty` and `--fixture minimal`. For the initializer, run
   `pnpm verify:pack --fixture empty --published-runtime` once the runtime it selects is live.
4. **Land** `chore(release): <pkg> v<version>` on `main`: push it directly when `git push` is
   available, otherwise open a pull request for the owner to merge. Wait for the resulting `main`
   commit's own push-event CI, then bind it with `preflight --package <p> --sha <sha>`.
5. **Coordinator dry run.** Start the [release coordinator](#starting-the-coordinator) with
   `dry_run: true` for that package, version and SHA. Its plan must be `create-tag` (or a resume
   action for an interrupted release).
6. **Coordinator real run.** Start it again with the same inputs and `dry_run: false`. It creates
   the tag (the irreversible release boundary), dispatches the publish workflow at the tag, and
   watches it.
7. **Verify:** `status --package <p> --version <v>` must show npm `present`, a non-null
   `trustedPublisher`, a GitHub Release, and `missing: []`. The publish run's `confirm` job is the
   provenance check of record.
8. Release the initializer the same way, after the runtime, when its rules require it. The
   coordinator refuses it until the runtime release is complete.

The owner may still tag from their own machine (`git tag <tag> <sha> && git push origin <tag>`,
then `ensure-run`). No step requires it.

## Dry runs

- **Local:** `pnpm release:dry-run` checks the tag naming for each manifest, runs
  `pnpm publish --dry-run`, and checks the tarball contents. It does **not** verify that a tag
  exists, GitHub OIDC, the npm Trusted Publisher mapping, provenance issuance, or CI.
- **Coordinator:** `dry_run: true` verifies a candidate before any tag exists (see
  [Release coordinator](#release-coordinator)). It reads state only.
- **Actions:** `node scripts/release.mjs dispatch --package <p> --tag <tag> --dry-run`.
  You can also dispatch the workflow with `dry_run: true`. The run admits the existing tag and runs
  every gate on its commit. It packs the tarball and runs `pnpm publish --dry-run` in a job that has
  no `id-token` permission and no credential. Nothing is written to npm or GitHub. It still cannot
  prove the Trusted Publisher mapping; only a real publish can.

A dry run is not evidence of an OIDC publish. Neither is a public registry read, or a run that
skipped publishing because the version already existed.

## If a release step fails

Start every recovery with
`node scripts/release.mjs status --package <p> --version <v> --sha <release-commit>`. It reads
exact state and lists only the missing operations. A timeout, authentication error, or unexpected
registry answer is reported as *uncertain*: stop and check again later. Uncertain state never
counts as absence.

| `missing` | Meaning | Action |
| --- | --- | --- |
| `[]` | Released | Nothing to do. |
| `["github-release"]` | npm accepted the version, then the run failed or was cancelled before finalizing | Rerun the coordinator with the same inputs (it plans `dispatch-finalize`), or `dispatch --package <p> --tag <tag> --ref main`. The run sees the version on npm, skips publishing and creates only the Release. You can also run `finalize` locally. Never republish. |
| `["publish", "github-release"]` | The tag exists, but npm clearly does not have the version | Read the failed run's log. For a transient cause or an OIDC configuration cause (mapping, workflow name, `repository.url`), fix it, then rerun the coordinator with the same inputs (`dispatch-publish` at the tag's original SHA), or `dispatch --package <p> --tag <tag>` (ref = the tag). The coordinator waits instead if an earlier run's publish job succeeded. |
| `["push-tag", …]` | Prepared but not tagged | Continue from step 5 of the procedure. |
| coordinator `wait` | A run is in flight, or npm accepted an upload that is not visible yet | Rerun the coordinator later. Never republish. |
| error: tag points elsewhere / npm has it but the tag is missing | Inconsistent history | Stop and reconcile by hand. Never move, delete, or recreate a pushed tag. |

A dispatch at an older tag runs *that tag's* workflow file. Tags cut before the OIDC migration
(`v0.3.0` and `create-zudo-circuit-doc-v0.2.1` and earlier) contain the retired token workflow, so
they can only be finalized, from `main`. A Release created for an older version than its
package's newest tag is created with `make_latest: false`, so a backfill never takes the
"Latest" label. If a package needs a code or workflow fix, release a new
version; never repoint the existing tag.

## Owner setup: npm Trusted Publishing

On npmjs.com, add one GitHub Actions trusted publisher per package (**package → Settings →
Trusted Publisher**):

| Package | Organization or user | Repository | Workflow filename | Environment | Allowed actions |
| --- | --- | --- | --- | --- | --- |
| `@takazudo/zudo-circuit-doc` | `Takazudo` | `zudo-circuit-doc` | `publish-zudo-circuit-doc.yml` | *(leave empty)* | `npm publish` |
| `create-zudo-circuit-doc` | `Takazudo` | `zudo-circuit-doc` | `publish-create-zudo-circuit-doc.yml` | *(leave empty)* | `npm publish` |

- The workflows use no GitHub Environment, so leave **Environment** empty.
- Allow direct `npm publish`. These stable-only publishers do not manage dist-tags, so do not allow
  `npm dist-tag`.
- npm does not validate the mapping when you save it. A new mapping expires if no publish succeeds
  within two days. Configure each package shortly before its next real release, and never cut a
  release only to test the mapping.
- `repository.url` in each manifest must stay `git+https://github.com/Takazudo/zudo-circuit-doc.git`.

## Credential retirement

The workflows no longer read any npm secret. Retire the old token path only after OIDC is proven:

1. **Prove.** For each package, a real release run's `confirm` job is green and `status` shows a
   non-null `trustedPublisher`. Record the run URL.
2. **Inventory.** Before revoking anything, list every consumer of the npm token(s): other
   repositories' `NPM_TOKEN` secrets, organization or environment secrets, CI systems, and local
   `.npmrc` files. A token shared with another repository is retired only once that consumer has
   migrated too. Until then, record it as retained, not retired.
3. **Remove GitHub access.** `gh secret delete NPM_TOKEN --repo Takazudo/zudo-circuit-doc`. Also
   remove any organization or environment secret that exposes the token to this repository.
4. **Revoke** the obsolete npm write tokens on npmjs.com (**Access Tokens**).
5. **Restrict** each package under **Settings → Publishing access** to "Require two-factor
   authentication and disallow tokens". Trusted publishers keep working.

npm has scheduled the end of token-based direct publishing for January 2027.

## Cloud sessions (Claude Code and Codex)

The Claude Code `/l-make-release` skill and the Codex `release` skill use this same procedure and
helper. A Cloud task needs these things: the repository checkout, Node 24 with Corepack (pnpm 11.5.2
from `packageManager`), Python 3.10+, and outbound HTTPS to `registry.npmjs.org`,
`api.github.com`, and `github.com`. Behind an egress proxy, run the helper with
`NODE_USE_ENV_PROXY=1` so Node's `fetch` uses it; `preflight` says so when it is needed.

Tagging never needs a Cloud credential that can push. Run
`node scripts/release.mjs preflight --package <p>` first and follow its `releasePath` line:

- **Release commit:** push to `main` when `gitPush` is `available`. Otherwise deliver it as a pull
  request. After the owner merges it, the resulting `main` commit (with its own push-event CI) is
  the candidate; bind it with `preflight --sha`.
- **Tag and publish:** start the [release coordinator](#starting-the-coordinator) through the API,
  else through GitHub MCP `actions_run_trigger`, else ask the owner to click **Run workflow** with the
  exact inputs. Read the run back (run URL and job summary) before reporting.

If no path can start the coordinator, stop before the tag step and hand over the exact inputs. The
Mac `heavy-guard.sh` queue does not exist in Cloud, so run heavy gates directly.

## Generated template install age

Keep `minimumReleaseAge: 0` in the generated template for now. The initializer's
published-runtime gate and a fresh scaffold both need to install a just-published runtime at once.
Revisit the setting after pnpm fixes the peer-nested-lockfile limitation documented in the
template. Then restore the intended release age with a supported exception for the first-party
runtime. Change the template only after both the published-runtime gate and a fresh scaffold
install pass with that policy.
