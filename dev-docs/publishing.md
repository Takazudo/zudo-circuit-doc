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

Pushing a release tag is the human gate. There is no stored npm credential: each workflow publishes
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
(`release.mjs ensure-run` / `dispatch`).

## Release helper

`scripts/release.mjs` is the single deterministic entry point for local, Cloud, and workflow
callers. It needs Node 24, git, network access, and a GitHub credential (`GH_TOKEN` or
`GITHUB_TOKEN`, or an authenticated `gh`). It needs no home-directory files, global skills, or
persistent shell state.

| Command | Use |
| --- | --- |
| `node scripts/release.mjs preflight --package <p> [--sha <sha>]` | Capability and candidate report: Node/pnpm versions, clean `main` equal to `origin/main`, origin URL, npm reachability, and GitHub API auth with push permission. It also reports whether `git push` is available and which tag path applies; that line is informational, not a `FAIL`. It also binds the candidate SHA to its manifest version and tag, and checks the CI runs and exact npm state for that SHA. Exits non-zero on any failure. |
| `node scripts/release.mjs status --package <p> [--version <v>] [--sha <sha>]` | Tag, npm, and GitHub Release state, plus the release operations still missing (`push-tag`, `publish`, `github-release`). |
| `node scripts/release.mjs registry-state --package <p> --version <v>` | Exact npm state: `present`, `absent`, or `uncertain` (exit 3). |
| `node scripts/release.mjs release-notes --package <p> --version <v>` | The GitHub Release body generated from the changelog page. |
| `node scripts/release.mjs ensure-run --package <p> --tag <t>` | After a tag push, waits for a publish-workflow run whose ref is the tag. If none appears, it dispatches one at the tag. A run dispatched at the tag with `dry_run` also counts, so check the run's mode. |
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

1. **Preflight.** `node scripts/release.mjs preflight --package <p>`. Stop on any `FAIL`.
2. **Prepare** the release commit: the manifest version and changelog page. For the runtime,
   regenerate the template (`pnpm sync:template`). Then run `pnpm doc:build` to regenerate the
   package `CHANGELOG.md`.
3. **Local gate** on the prepared tree: `pnpm build`, `pnpm typecheck`, `pnpm test`,
   `pnpm check:template`, `pnpm release:dry-run`. For the runtime, also run
   `pnpm verify:pack --fixture empty` and `--fixture minimal`. For the initializer, run
   `pnpm verify:pack --fixture empty --published-runtime` once the runtime it selects is live.
4. **Commit and push** `chore(release): <pkg> v<version>` to `main`. Wait for that commit's
   push-event CI, then confirm with `preflight --package <p> --sha <sha>`.
5. **Recheck** that the exact version is absent (`registry-state`) and that the tag does not exist.
   Then tag the verified commit and push the tag:
   `git tag <tag> <sha> && git push origin <tag>`.
   A pushed tag is the irreversible release boundary.
6. **Confirm the run started:** `node scripts/release.mjs ensure-run --package <p> --tag <tag>`.
   Watch it (`gh run watch <id> --exit-status`, or the Actions page).
7. **Verify:** `status --package <p> --version <v>` must show npm `present`, a non-null
   `trustedPublisher`, a GitHub Release, and `missing: []`.
8. Release the initializer the same way, after the runtime, when its rules require it.

## Dry runs

- **Local:** `pnpm release:dry-run` checks the tag naming for each manifest, runs
  `pnpm publish --dry-run`, and checks the tarball contents. It does **not** verify that a tag
  exists, GitHub OIDC, the npm Trusted Publisher mapping, provenance issuance, or CI.
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
| `["github-release"]` | npm accepted the version, then the run failed or was cancelled before finalizing | `dispatch --package <p> --tag <tag> --ref main`. The run sees the version on npm, skips publishing and creates only the Release. You can also run `finalize` locally. Never republish. |
| `["publish", "github-release"]` | The tag exists, but npm clearly does not have the version | Read the failed run's log. For a transient cause or an OIDC configuration cause (mapping, workflow name, `repository.url`), fix it, then `dispatch --package <p> --tag <tag>` (ref = the tag). |
| `["push-tag", …]` | Prepared but not tagged | Continue from step 5 of the procedure. |
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

## Codex Cloud

The Codex `release` skill uses this same procedure and helper. A Cloud task needs these things:
the repository checkout, Node 24 with Corepack (pnpm 11.5.2 from `packageManager`), Python 3.10+,
outbound HTTPS to `registry.npmjs.org`, `api.github.com`, and `github.com`, and a GitHub credential
that can push tags and dispatch workflows. Run
`node scripts/release.mjs preflight --package <p>` first. It reports what the environment can
actually do. If `git push` is unavailable, deliver the `chore(release)` commit as a pull request.
After the owner merges it, the resulting commit on `main` (with its own push-event CI) is the
candidate; bind it with `preflight --sha`. If the GitHub credential has push permission, create the
tag ref through the API instead of `git push` (`POST /repos/Takazudo/zudo-circuit-doc/git/refs` with
`ref=refs/tags/<tag>` and the verified `sha`). Then run `ensure-run`: it dispatches the workflow
explicitly if the tag event did not start one. If neither path is available, stop before the tag
step and hand over to the owner. The Mac `heavy-guard.sh` queue does not exist there, so run heavy
gates directly.

## Generated template install age

Keep `minimumReleaseAge: 0` in the generated template for now. The initializer's
published-runtime gate and a fresh scaffold both need to install a just-published runtime at once.
Revisit the setting after pnpm fixes the peer-nested-lockfile limitation documented in the
template. Then restore the intended release age with a supported exception for the first-party
runtime. Change the template only after both the published-runtime gate and a fresh scaffold
install pass with that policy.
