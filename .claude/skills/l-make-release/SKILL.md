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

This skill releases the two stable npm packages from `main`. The runtime is
`@takazudo/zudo-circuit-doc` (`packages/circuit-doc/package.json`, tag
`vX.Y.Z`, `.github/workflows/publish-zudo-circuit-doc.yml`). The initializer is
`create-zudo-circuit-doc` (`packages/create-zudo-circuit-doc/package.json`, tag
`create-zudo-circuit-doc-vX.Y.Z`,
`.github/workflows/publish-create-zudo-circuit-doc.yml`). Each package's own
manifest is its version source. Never bump the private root `package.json` as
a release version. These are stable-only releases to npm `latest`; do not use
prerelease suffixes or a `next` channel.

Read [the publishing runbook](../../../doc/src/content/docs/release/publishing.mdx)
when preparing or recovering a release. The two tag pushes start the publish
workflows; a GitHub Release does not start publishing. The skill never runs
`npm publish` or `pnpm publish` itself.

## Selection and authorization

- With no package selected, judge both and release every package with work to
  ship. A request naming only `runtime` or `@takazudo/zudo-circuit-doc`
  selects the runtime. `create-zudo-circuit-doc` or `initializer` selects only
  the initializer. If both are selected, release runtime first and complete
  its npm verification before beginning initializer mutation or its release
  gate. Use separate commits, tags, changelogs, workflows, and GitHub Releases.
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

## 1. Preconditions and release mode

Stop with a clear reason if any precondition fails:

1. `git branch --show-current` is `main`; `gh auth status` succeeds; and
   `git status --porcelain` is empty.
2. `git fetch origin` and `git fetch --tags origin`, then verify local `main`
   equals `origin/main`. Bring a behind branch current before proceeding;
   stop on divergence rather than guessing which tree to release.
3. Check Actions runs at the current `main` HEAD with
   `gh run list --branch main --limit 100 --json name,status,conclusion,headSha,workflowName`.
   All runs for that SHA must finish successfully, including applicable
   `ci-*.yml` checks and the documentation deployment in `main-deploy.yml`
   (the workflow name here is `Deploy Documentation Site`). Page through more
   runs if 100 does not cover that SHA. A path-filtered workflow need not have
   a run. Stop for pending, missing expected, or failed checks. Check the
   target SHA again after each release commit.
4. `NPM_TOKEN` is already a repository secret. Do not ask the operator for a
   speculative credential confirmation; authentication failures have a
   recovery path below.

For each selected package, read its manifest version (`CUR`) and latest tag in
**its own namespace**. `git tag -l 'v*.*.*' --sort=-v:refname` is for the
runtime; `git tag -l 'create-zudo-circuit-doc-v*.*.*' --sort=-v:refname` is for
the initializer. Validate exact stable `X.Y.Z` tags before using them as bases.

- **first:** no tag exists in that namespace. Analyze the package's history,
  including the commit that introduced its manifest. The seeded `0.1.0` is
  unpublished preparation, not evidence that a release happened. Confirm
  first-release status with `npm view <package> versions --json
  --registry=https://registry.npmjs.org/`: an `E404` means the name is absent;
  existing versions or an inconclusive query require reconciliation.
- **bump:** the tag for `CUR` exists. Check that version on npm before assuming
  the tag means publication; recover an unpublished tagged version first.
  Otherwise analyze commits since the latest tag.
- **resume-candidate:** at least one prior tag exists but the tag for `CUR` is
  absent. Locate the commit that introduced `CUR` in the selected manifest
  (`git log -1 -S'"version": "<CUR>"' -- <manifest>`). Resume only when it is
  a complete preparation commit with subject `chore(release): <pkg> v<CUR>`,
  a matching manifest, a dated changelog page with no `unreleased` text, and
  the generated package `CHANGELOG.md` entry. Check the exact version on npm.
  Print a resume proposal with that commit. In `--confirm` mode wait unless
  this exact resume was already authorized in the session. Re-run the local
  gate on the **same tree** and tag that verified commit only. If later commits
  follow it, surface them and obtain a choice between validating the original
  tree and preparing a fresh release including them; never test `HEAD` and
  tag an earlier untested commit.

Each package is judged independently. Its first-release history begins at
the commit adding its manifest (`git log --diff-filter=A --format=%H --follow
-- <manifest> | tail -1`); include that commit explicitly because `base..HEAD`
excludes it. Otherwise inspect the full commit subjects, bodies, and paths
since its latest namespace tag. Check the public registry for the **exact
proposed version** before mutation with `npm view "<pkg>@<version>" version
--registry=https://registry.npmjs.org/`. Proceed only on a confirmed absence
(`E404` or no matching version); if present or inconclusive, stop and use
[Failure recovery](#failure-recovery).

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

The first release normally retains the seeded `0.1.0` in each manifest and
finalizes its changelog. Still analyze history and print a proposal; do not
manufacture `0.1.1` because the manifest already reads `0.1.0`. If evidence
requires another first version or an explicit bump is requested, explain the
choice and never silently lower a prepared version. New versions must exceed
the current manifest version except when retaining an unpublished first
version. Never propose a lower version.

Present one proposal listing both selected packages, their current and new
versions, reason, tag, relevant commits with hashes, and changelog categories.
State when one package is omitted. State the fixed runtime → initializer
order. A confirmed `--confirm` proposal authorizes the whole selected flow.

## 3. Prepare one package

Prepare and finish each package separately in the selected order.

1. Set `version` in that package's manifest to the proposed version. The
   default first release retains `0.1.0`. For a runtime release, run
   `pnpm sync:template && pnpm check:template` and inspect the generated diff.
   Keep generated template files in the **same runtime release commit**. The
   generated template runtime dependency must be `^<runtime version>`, a
   caret range, never an exact pin. Leave generated `minimumReleaseAge: 0` for
   the first release; [publishing.mdx](../../../doc/src/content/docs/release/publishing.mdx)
   states when it can be reconsidered.
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
3. Run `bash $HOME/.claude/scripts/heavy-guard.sh -- pnpm doc:build`. Its
   changelog generator in `doc/zfb.config.ts`
   writes `packages/circuit-doc/CHANGELOG.md` and
   `packages/create-zudo-circuit-doc/CHANGELOG.md`. Verify the selected
   package's generated file includes the new dated entry. Inspect any other
   generated diff before staging.

## 4. Local gate and commit

Run all applicable checks on the prepared tree. Route heavy commands through
the shared gate in the repository guide; keep the queue and command in the
foreground and obey its `verdict=` and exit-75 rules. Use
`bash $HOME/.claude/scripts/heavy-guard.sh -- pnpm build` and the same wrapper
for `pnpm verify:pack --fixture empty` and
`pnpm verify:pack --fixture minimal`. Run `pnpm typecheck`, `pnpm test`,
`pnpm check:template`, and `pnpm release:dry-run` too. For the initializer,
also run `bash $HOME/.claude/scripts/heavy-guard.sh -- pnpm verify:pack
--fixture empty --published-runtime`. That last gate must install the range
from npm and can run only after the required runtime is live. Do not swap in
the local tarball gate. Fix failures and repeat affected checks before commit;
if the gate cannot pass, stop without a release tag.

Stage only this package's manifest, changelog MDX, generated CHANGELOG, and
expected generated template changes for a runtime bump. Review the staged
diff, then:

```bash
git commit -m "chore(release): <pkg> v<version>"
BUMP_SHA=$(git rev-parse HEAD)
git push origin main
```

Confirm `origin/main` contains `BUMP_SHA`. Wait for every applicable Actions
run at exactly `BUMP_SHA` to finish successfully, using `gh run list --branch
main --limit 100 --json name,status,conclusion,headSha,workflowName` and
additional pages as needed. Include the `ci-*.yml` workflows triggered for
that commit and `main-deploy.yml`. If CI fails, fix, commit, push, re-run the
checks that cover the fix, and replace `BUMP_SHA` with the newly verified
commit. Never tag a SHA whose CI did not pass.

## 5. Tag, publish, and GitHub Release

Recheck that the exact version is absent from npm and the proposed tag does
not exist. Create the appropriate tag at **`BUMP_SHA`**, then push it:

```bash
git tag "v<version>" "$BUMP_SHA"                         # runtime only
git push origin "v<version>"                              # runtime only
git tag "create-zudo-circuit-doc-v<version>" "$BUMP_SHA" # initializer only
git push origin "create-zudo-circuit-doc-v<version>"      # initializer only
```

Run only the two lines for the selected package. A pushed tag is the
irreversible release boundary. The runtime tag triggers
`publish-zudo-circuit-doc.yml`; the initializer tag triggers
`publish-create-zudo-circuit-doc.yml`.

Find the new run with `gh run list --workflow <workflow-file> --limit 30
--json databaseId,headSha,event,createdAt,status,conclusion`. Match the
workflow, push event, exact `BUMP_SHA`, and creation after this tag push;
`headBranch` may be empty for tags. If ambiguous, inspect candidates with
`gh run view <run-id>` and verify their tag before selecting. Wait with
`gh run watch <run-id> --exit-status`. If it fails, check the exact npm version
first, then follow [Failure recovery](#failure-recovery). Never infer absence
from a red workflow.

Once the exact version is confirmed live, verify the tag still points to the
published commit. Reuse an existing `gh release view <tag>` if present.
Otherwise put the changelog body after YAML frontmatter in a temporary notes
file and use `gh release create <tag> --verify-tag --title "<pkg> <version>"
--notes-file <notes-file>`. Verify `npm view "<pkg>@<version>" version
--registry=https://registry.npmjs.org/` and `npm dist-tag ls <pkg>` show the
version on `latest`. Report npm URL, publish run URL, and GitHub Release URL.
In a combined run, start the initializer only after this runtime verification.
If runtime does not reach npm, stop and report why; the initializer can be
released later with `/l-make-release initializer`.

After **both first releases** are live, make a **separate docs commit** on
`main` replacing the "neither package is published" instructions in
`doc/src/content/docs/release/index.mdx` and
`doc/src/content/docs/getting-started/create-a-project.mdx` with working
`pnpm create zudo-circuit-doc` instructions; run the relevant docs check and
push the docs commit. Do this only once, after publication, never in either
release commit. Remind the owner to configure npm Trusted Publishing (OIDC)
for both workflows and verify an OIDC publish before removing `NPM_TOKEN`;
the [publishing runbook](../../../doc/src/content/docs/release/publishing.mdx)
records the January 2027 token deadline.

## Cancelling

For `/l-make-release cancel`, identify the selected package, exact tag, and
whether it was pushed. Before a tag push, delete a mistakenly created **local
only** tag if needed (`git tag -d <tag>`). If the bump commit is still `HEAD`,
revert it as one commit (`git revert --no-edit <BUMP_SHA>`) and push `main`;
if later commits bury it, leave it and explain that a later release must
supersede the prepared version. Do not rewrite shared history.

After a tag push, treat the version as potentially live. Never delete, move,
or recreate a pushed release tag. Check the registry and follow recovery.
Retraction of an already published package is an owner decision outside this
skill.

## Failure recovery

For **any** failure after a tag push, first query the exact package version:

```bash
npm view "<pkg>@<version>" version --registry=https://registry.npmjs.org/
```

- If it resolves to that version, publication succeeded. Keep the tag and
  commit; do not rerun the publish job. Finish or reuse the GitHub Release and
  verify `latest`. If its tag is missing or points elsewhere, stop to
  reconcile; never retag.
- If npm clearly confirms the version absent (`E404` or no matching version),
  inspect `gh run view <run-id> --log-failed`. Correct a transient or
  credential-only cause, recheck absence immediately before retry, then use
  the guarded dispatch at the **unchanged tag**:
  `gh workflow run publish-zudo-circuit-doc.yml --ref v<version>` for runtime
  or `gh workflow run publish-create-zudo-circuit-doc.yml --ref
  create-zudo-circuit-doc-v<version>` for initializer. Watch the new run and
  recheck npm. A code fix requires a new release version; never repoint the
  pushed tag.
- A timeout, network/authentication error, or ambiguous registry response is
  inconclusive. Stop until npm status can be established. Do not dispatch or
  publish again based on a failed query.

Before a tag push, a local gate failure means fix and rerun without committing
an invalid release; a CI failure means fix, push a new commit, and verify its
SHA. If the proposed version was wrong after a bump commit but before tagging,
use [Cancelling](#cancelling) and prepare a corrected proposal.
