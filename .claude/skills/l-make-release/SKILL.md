---
description: >-
  Release @takazudo/zudo-circuit-doc and create-zudo-circuit-doc end to end.
  By default, judge both packages and publish each that has something to ship,
  runtime first. An explicit runtime or initializer request selects one package.
  The invocation authorizes the complete release; --confirm adds a proposal
  checkpoint. Use for "bump version", "cut a release", "release zudo-circuit-doc",
  "release create-zudo-circuit-doc", "release the initializer", and "make a release".
user-invocable: true
argument-description: >-
  Optional major, minor, or patch forces that bump level; without one, judge
  commits under Scheme B. runtime selects @takazudo/zudo-circuit-doc;
  create-zudo-circuit-doc or initializer selects the initializer. In a combined
  run a level applies to the runtime and the initializer is commit-judged.
  --confirm waits at the proposal; cancel aborts a not-yet-published release.
---

# /l-make-release

[`dev-docs/publishing.md`](../../../dev-docs/publishing.md) is the canonical
procedure: release policy, workflow jobs and modes, the
`scripts/release.mjs` helper, dry runs, and failure recovery. Read it before
preparing or recovering a release. This skill adds the judgement (what to
release, which version, the changelog) and drives the runbook's steps. The
Codex skill [`release`](../../../.agents/skills/release/SKILL.md) mirrors these
rules.

| Package | Helper `--package` | Manifest | Tag | Workflow |
| --- | --- | --- | --- | --- |
| `@takazudo/zudo-circuit-doc` | `runtime` | `packages/circuit-doc/package.json` | `vX.Y.Z` | `publish-zudo-circuit-doc.yml` |
| `create-zudo-circuit-doc` | `initializer` | `packages/create-zudo-circuit-doc/package.json` | `create-zudo-circuit-doc-vX.Y.Z` | `publish-create-zudo-circuit-doc.yml` |

Each package's own manifest is its version source; never bump the private root
`package.json`. Stable npm `latest` only: no prerelease suffixes, no `next`.
Publishing happens only in the tag-triggered workflow via npm Trusted
Publishing (GitHub OIDC). No npm token exists or is needed. The skill never
runs `npm publish` / `pnpm publish` and never creates the GitHub Release
itself; the workflow's `finalize` job does.

**Heavy commands** (`pnpm build`, `pnpm doc:build`, `pnpm verify:pack ...`):
when `$HOME/.claude/scripts/heavy-guard.sh` is present (the owner's Mac;
`preflight` reports it), run them as
`bash $HOME/.claude/scripts/heavy-guard.sh -- <cmd>` in the foreground and obey
its `verdict=` and exit-75 rules. Otherwise run them directly.

## Selection and authorization

- With no package selected, judge both and release every package with work to
  ship. A request naming only `runtime` or `@takazudo/zudo-circuit-doc`
  selects the runtime. `create-zudo-circuit-doc` or `initializer` selects only
  the initializer. If both are selected, release runtime first and complete
  its verification (`status` shows `missing: []`) before beginning initializer
  mutation or its release gate. Use separate commits, tags, changelogs,
  workflows, and GitHub Releases.
- Runtime work means runtime-relevant commits since its latest `v*.*.*` tag.
  Initializer work means no initializer tag exists yet; or commits since the
  latest `create-zudo-circuit-doc-v*.*.*` tag touch
  `packages/create-zudo-circuit-doc/**`, `scripts/sync-create-template.mjs`, or
  `.github/workflows/publish-create-zudo-circuit-doc.yml`; or this run bumps
  the runtime minor or major version. Exclude a previous runtime release's
  generated template range rewrite when judging initializer-only work. A
  runtime patch alone does not force an initializer release because its caret
  dependency range already admits that patch. If neither has work, report it
  and stop.
- The invocation authorizes the selected release through npm publication and
  GitHub Release creation. Print the entire proposal before mutation and
  continue by default. With `--confirm`, perform the read-only proposal work,
  then wait for explicit confirmation before mutation. Once confirmed,
  continue through both selected packages without another prompt. `cancel`
  goes directly to [Cancelling](#cancelling).

## 1. Preflight and release mode

For each selected package run
`node scripts/release.mjs preflight --package <p>`. It checks Node/pnpm, a
clean `main` equal to `origin/main`, origin, git push and GitHub auth, npm
reachability, and binds HEAD to its manifest version, tag, push-event CI and
exact npm state. Stop on any `FAIL` and report the failing lines. This
skill pushes the release commit and tag with git, so its `info.gitPush` line
must also read `available`. Bring a
behind `main` current first; stop on divergence rather than guessing which tree
to release. Pending or failed CI at HEAD is a stop.

Read the manifest version (`CUR`) and the latest tag in **the package's own
namespace** (`git tag -l 'v*.*.*' --sort=-v:refname` for runtime,
`git tag -l 'create-zudo-circuit-doc-v*.*.*' --sort=-v:refname` for
initializer). Validate exact stable `X.Y.Z` tags before using them as bases.
Exact npm state always comes from
`node scripts/release.mjs registry-state --package <p> --version <v>`:
`present`, `absent`, or `uncertain` (exit 3). Uncertain is a stop, never an
absence.

- **first:** no tag exists in that namespace. Analyze the package's history,
  including the commit that introduced its manifest. A seeded `0.1.0` is
  unpublished preparation, not evidence of a release; `registry-state` must
  say `absent`.
- **bump:** the tag for `CUR` exists. Run
  `node scripts/release.mjs status --package <p> --version <CUR>`; if anything
  is `missing`, recover that version first (see
  [Failure recovery](#failure-recovery)). Otherwise analyze commits since the
  latest tag.
- **resume-candidate:** at least one prior tag exists but the tag for `CUR` is
  absent. Locate the commit that introduced `CUR` in the selected manifest
  (`git log -1 -S'"version": "<CUR>"' -- <manifest>`). Resume only when it is
  a complete preparation commit with subject `chore(release): <pkg> v<CUR>`,
  a matching manifest, a dated changelog page with no `unreleased` text, and
  the generated package `CHANGELOG.md` entry; check it with
  `status --package <p> --version <CUR> --sha <commit>`. Print a resume
  proposal with that commit. In `--confirm` mode wait unless this exact resume
  was already authorized in the session. Re-run the local gate on the **same
  tree** and tag that verified commit only. If later commits follow it,
  surface them and obtain a choice between validating the original tree and
  preparing a fresh release including them; never test `HEAD` and tag an
  earlier untested commit.

Each package is judged independently. Its first-release history begins at
the commit adding its manifest (`git log --diff-filter=A --format=%H --follow
-- <manifest> | tail -1`); include that commit explicitly because `base..HEAD`
excludes it. Otherwise inspect the full commit subjects, bodies, and paths
since its latest namespace tag. Before mutation, the **exact proposed
version** must be `absent` per `registry-state`; on `present` or `uncertain`,
stop and use [Failure recovery](#failure-recovery).

## 2. Version and proposal

Categorize relevant commits by subject and body. `feat!:` / `fix(scope)!:` or
a `BREAKING CHANGE` footer is breaking; `feat:` is a feature; `fix:` is a bug
fix; everything else is another change. Read paths too: unrelated docs or
deployment commits do not create a runtime release. Surface a breaking change
outside the package path when it actually changes that package's contract.

For automatic pre-1.0 Scheme B judgement, a breaking change bumps **minor**
(`0.Y.Z` to `0.(Y+1).0`); all other releasable work bumps **patch**. A feature
alone does not bump minor. An explicit `major`, `minor`, or `patch` overrides
the level for the selected package; `major` is the intentional escape hatch
for `1.0.0`. In a combined run, that argument applies to the runtime, while
the initializer remains commit-judged. Explain any patch proposal containing
only non-feature/non-fix commits.

A first release normally retains the seeded `0.1.0` and finalizes its
changelog; do not manufacture `0.1.1` because the manifest already reads
`0.1.0`. If evidence requires another first version or an explicit bump is
requested, explain the choice and never silently lower a prepared version. New
versions must exceed the current manifest version except when retaining an
unpublished first version. Never propose a lower version.

Present one proposal listing both selected packages, their current and new
versions, reason, tag, relevant commits with hashes, and changelog categories.
State when one package is omitted. State the fixed runtime → initializer
order. A confirmed `--confirm` proposal authorizes the whole selected flow.

## 3. Prepare one package

Prepare and finish each package separately in the selected order.

1. Set `version` in that package's manifest to the proposed version. For a
   runtime release, run `pnpm sync:template && pnpm check:template` and
   inspect the generated diff. Keep generated template files in the **same
   runtime release commit**. The generated template runtime dependency must be
   `^<runtime version>`, a caret range, never an exact pin. Leave generated
   `minimumReleaseAge: 0`; publishing.md states when it can be reconsidered.
2. Write English release notes in
   `doc/src/content/docs/changelog/zudo-circuit-doc/<version>.mdx` for runtime
   or `doc/src/content/docs/changelog/create-zudo-circuit-doc/<version>.mdx`
   for initializer. On a first `0.1.0`, finalize the existing seed in place:
   replace `Released: unreleased` and its `Finalized by` sentence with the
   actual release date and content. If the first version changes, move the
   seed to the chosen version; do not leave a fictional 0.1.0 page. Use the
   existing frontmatter shape: `title`, `description`, `sidebar_position`,
   `pagination_next: null`. Keep `sidebar_position: 1` for the first entry;
   later pages use one greater than the highest existing position in **that
   package's** changelog directory. Add only categories with real entries.
   This page is also the GitHub Release body (`release-notes` renders it).
3. Run `pnpm doc:build` (heavy). Its changelog generator in
   `doc/zfb.config.ts` writes `packages/circuit-doc/CHANGELOG.md` and
   `packages/create-zudo-circuit-doc/CHANGELOG.md`. Verify the selected
   package's generated file includes the new dated entry. Inspect any other
   generated diff before staging.

## 4. Local gate and commit

Run the runbook's local gate on the prepared tree: `pnpm build` (heavy),
`pnpm typecheck`, `pnpm test`, `pnpm check:template`, `pnpm release:dry-run`;
for the runtime also `pnpm verify:pack --fixture empty` and
`pnpm verify:pack --fixture minimal` (heavy). For the initializer run
`pnpm verify:pack --fixture empty --published-runtime` (heavy): it installs the
template's runtime range from npm, so it runs only after the required runtime
is live. Do not swap in the local tarball gate. Fix failures and repeat
affected checks before commit; if the gate cannot pass, stop without a tag.

Stage only this package's manifest, changelog MDX, generated CHANGELOG, and
expected generated template changes for a runtime bump. Review the staged
diff, then:

```bash
git commit -m "chore(release): <pkg> v<version>"
BUMP_SHA=$(git rev-parse HEAD)
git push origin main
```

Wait for that commit's own push-event CI, then confirm the binding with
`node scripts/release.mjs preflight --package <p> --sha "$BUMP_SHA"`. Only
push-event runs on exactly `BUMP_SHA` count; `pull_request` runs tested a merge
tree and are listed as ignored. If CI fails, fix, commit, push, re-run the
checks that cover the fix, and replace `BUMP_SHA` with the newly verified
commit. Never tag a SHA whose CI did not pass.

## 5. Tag, publish, verify

Recheck: `registry-state --package <p> --version <v>` is `absent` and
`git ls-remote origin refs/tags/<tag>` is empty. Then tag **`BUMP_SHA`** and
push only that tag:

```bash
git tag "<tag>" "$BUMP_SHA"
git push origin "<tag>"
node scripts/release.mjs ensure-run --package <p> --tag "<tag>"
```

A pushed tag is the irreversible release boundary. `ensure-run` reports the
publish run(s) for the tag, or dispatches one at the tag if none appears.
Watch it with `gh run watch <run-id> --exit-status` (or the Actions page). A
red run is not evidence of absence: go to [Failure recovery](#failure-recovery).

Verify with `node scripts/release.mjs status --package <p> --version <v>`. It
must show `npm: "present"`, a non-null `trustedPublisher`, a GitHub Release
URL, and `missing: []`. Report the npm URL, publish run URL, and GitHub Release
URL. In a combined run, start the initializer only after this. If the runtime
does not reach npm, stop and report why; the initializer can be released later
with `/l-make-release initializer`.

After a package's first release is live, make a **separate docs commit** on
`main` updating the unpublished-status notice in
`doc/src/content/docs/getting-started/create-a-project.mdx` and any other
content that says a package is not published. Keep the status accurate while
the other package remains unpublished. Once the initializer is live, replace
its unpublished notice with the working `pnpm create zudo-circuit-doc`
instructions. Run the relevant docs check and push the docs commit. Do this
only after publication, never in a release commit.

## Cancelling

For `/l-make-release cancel`, identify the selected package, exact tag, and
whether it was pushed. Before a tag push, delete a mistakenly created **local
only** tag if needed (`git tag -d <tag>`). If the bump commit is still `HEAD`,
revert it as one commit (`git revert --no-edit <BUMP_SHA>`) and push `main`;
if later commits bury it, leave it and explain that a later release must
supersede the prepared version. Do not rewrite shared history.

After a tag push, treat the version as potentially live. Never delete, move,
or recreate a pushed release tag. Run `status` and follow recovery. Retraction
of an already published package is an owner decision outside this skill.

## Failure recovery

After a tag push, start every recovery with
`node scripts/release.mjs status --package <p> --version <v> --sha <BUMP_SHA>`
and act on its `missing` list using the table in publishing.md
("If a release step fails"). In short:

- `missing: ["github-release"]`: npm has it. Run
  `node scripts/release.mjs dispatch --package <p> --tag <tag> --ref main`
  (finalize-only run). Never republish.
- `missing: ["publish", "github-release"]`: npm clearly lacks it. Read the
  failed run's log (`gh run view <run-id> --log-failed`), fix a transient or
  OIDC-configuration cause, then retry only via
  `dispatch --package <p> --tag <tag>` (ref = the tag). A code or workflow fix
  needs a new version. Pre-OIDC tags can only be finalized.
- Uncertain state (exit 3, timeout, auth error) or an inconsistent-history
  error: stop. Never dispatch on a failed query; never move, delete, or
  recreate a pushed tag.

Before a tag push, a local gate failure means fix and rerun without committing
an invalid release; a CI failure means fix, push a new commit, and verify its
SHA. If the proposed version was wrong after a bump commit but before tagging,
use [Cancelling](#cancelling) and prepare a corrected proposal.
