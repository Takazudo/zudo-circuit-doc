---
name: release
description: >-
  Release @takazudo/zudo-circuit-doc (runtime) and/or create-zudo-circuit-doc
  (initializer) to npm: the release-coordinator workflow creates the tag and
  dispatches the Trusted Publishing (OIDC) workflows; scripts/release.mjs
  checks and drives it. Use when the task explicitly asks to
  cut, publish, resume, or recover a release of either package, or to check a
  release's state.
---

# release

Canonical procedure: [`dev-docs/publishing.md`](../../../dev-docs/publishing.md).
Read it first; when this skill and the runbook differ, the runbook wins.
Judgement rules (package selection, Scheme B, resume, changelog page format)
are the same as the Claude Code skill
[`.claude/skills/l-make-release/SKILL.md`](../../../.claude/skills/l-make-release/SKILL.md);
read its sections 1-3 for detail. This file is self-contained otherwise: it
needs no home-directory files, personal skills, or shell state carried between
commands (re-derive SHAs and versions in each command).

## Authorization: a real release needs explicit consent

A release tag publishes to npm and cannot be undone. Run the release
coordinator with `dry_run: false` only when the task explicitly authorizes
publishing the named package(s). Without
that, do the read-only work (preflight, proposal, `status`) and stop with a
proposal. Never create or run anything that publishes outside the workflows:
no `npm publish`, `pnpm publish`, or `gh release create`.

## Packages

| Package | `--package` | Manifest | Tag | Workflow |
| --- | --- | --- | --- | --- |
| `@takazudo/zudo-circuit-doc` | `runtime` | `packages/circuit-doc/package.json` | `vX.Y.Z` | `.github/workflows/publish-zudo-circuit-doc.yml` |
| `create-zudo-circuit-doc` | `initializer` | `packages/create-zudo-circuit-doc/package.json` | `create-zudo-circuit-doc-vX.Y.Z` | `.github/workflows/publish-create-zudo-circuit-doc.yml` |

- Stable npm `latest` only; no prerelease versions, no `next`.
- The package manifest is the version source. Never bump the root `package.json`.
- Runtime first. The initializer's gate installs the runtime from npm, so the
  runtime it selects must be live before the initializer is prepared.
- A runtime patch alone does not force an initializer release; a runtime
  minor/major does (the template's `^X.Y.Z` range must move).
- Scheme B (pre-1.0): breaking change bumps minor, anything else releasable
  bumps patch. A feature alone does not bump minor.

## Procedure

1. **Preflight.** `node scripts/release.mjs preflight --package <p>` (behind
   an egress proxy: `NODE_USE_ENV_PROXY=1`). On any `FAIL`, stop and report
   every `PASS`/`FAIL` line plus the `info` block verbatim. The `info` block
   lists capabilities, not failures: `githubCredential`, `gitPush`,
   `releasePath`, `heavyGuard`.
2. **Judge and propose.** Commits since the package's latest namespace tag
   (see l-make-release for what counts). Check the exact proposed version with
   `node scripts/release.mjs registry-state --package <p> --version <v>`; it
   must be `absent`. `present` means recover, not re-release; `uncertain`
   (exit 3) means stop.
3. **Prepare** the manifest version and the changelog page
   `doc/src/content/docs/changelog/<zudo-circuit-doc|create-zudo-circuit-doc>/<v>.mdx`
   (frontmatter `title`, `description`, `sidebar_position` = highest in that
   directory + 1, `pagination_next: null`). Runtime only:
   `corepack pnpm sync:template && corepack pnpm check:template`; the template
   range must stay a caret `^<version>`. Then `corepack pnpm doc:build` and
   confirm the package `CHANGELOG.md` gained the dated entry.
4. **Local gate**, run directly (the `heavy-guard.sh` queue exists only on the
   owner's Mac): `corepack pnpm build`, `corepack pnpm typecheck`,
   `corepack pnpm test`, `corepack pnpm check:template`,
   `corepack pnpm release:dry-run`. Runtime: `corepack pnpm verify:pack --fixture empty`
   and `--fixture minimal`. Initializer:
   `corepack pnpm verify:pack --fixture empty --published-runtime`. Any
   failure: fix or stop; no tag.
5. **Commit and land** only the release files as
   `chore(release): <pkg> v<version>` on `main`: push when preflight's
   `gitPush` is `available`, otherwise open a pull request and, after the
   owner merges it, use the resulting `main` commit as `<sha>`. Wait for that
   commit's push-event CI, then
   `node scripts/release.mjs preflight --package <p> --sha <sha>` must pass
   (it also shows the coordinator's plan). Only push-event runs on that exact
   SHA count.
6. **Coordinator dry run.** Start `.github/workflows/release-coordinator.yml`
   on `main` with inputs `package`, `version`, `sha` (full 40 characters),
   `dry_run: true`, `allow_older_sha: false`, using the first available path:
   - `node scripts/release.mjs request-release --package <p> --version <v> --sha <sha> --dry-run`
     (needs a GitHub credential that can dispatch workflows);
   - a GitHub MCP / connector tool that runs a workflow (`run_workflow` on
     `release-coordinator.yml`, ref `main`, inputs as strings), then read the
     run back;
   - otherwise stop and hand the owner the exact inputs for **Actions →
     Release coordinator → Run workflow**.
   The plan must be `create-tag` (or a resume action). A refusal is a stop.
   Never push a tag from the task environment and never swap `sha` for a
   newer `main` commit on your own.
7. **Coordinator real run (irreversible).** Same inputs with
   `dry_run: false`. The coordinator creates the tag with its own
   `GITHUB_TOKEN`, dispatches the publish workflow at the tag, watches it, and
   reports npm, `trustedPublisher` and the GitHub Release. Record the
   coordinator and publisher run URLs. If tag creation or dispatch fails, the
   run summary has GitHub's status, message, permissions and candidate facts;
   report them, do not retry with another credential, and do not change
   settings.
8. **Verify.** `node scripts/release.mjs status --package <p> --version <v>`
   must show `npm: "present"`, non-null `trustedPublisher`, a GitHub Release
   URL, and `missing: []`. The workflow's `finalize` job creates the Release.
9. Initializer next, if its rules require it. The coordinator refuses the
   initializer until the runtime it was prepared with is on npm, tagged and
   released.

## Recovery

Start with `node scripts/release.mjs status --package <p> --version <v> --sha <sha>`
and follow the `missing` table in publishing.md. Rerunning the coordinator with
the same inputs is always safe: it finalizes (`["github-release"]`), resumes a
publish at the tag's original SHA (`["publish", "github-release"]`, after the
failed run's cause is fixed), waits while a run is in flight or an accepted
upload is not visible yet, or reports `complete`. Without a coordinator path:
`dispatch --package <p> --tag <tag> --ref main` (finalize) or
`dispatch --package <p> --tag <tag>` (publish, ref = tag). Never republish an existing version, never move, delete, or
recreate a pushed tag. Uncertain registry or GitHub state is a stop, never
absence.

## Report

State the outcome precisely; these are not the same thing:

- **OIDC publish:** a run whose `confirm` job passed and `status` shows a
  non-null `trustedPublisher`. Only this proves Trusted Publishing.
- **Finalize/skip:** the version already existed; the run only created or kept
  the Release.
- **Dry run** (`pnpm release:dry-run`, `dispatch --dry-run`, or a coordinator
  `dry_run: true` plan): checks only; nothing tagged or published.
- **Public read:** `registry-state`/`status` saw the version; says nothing
  about how it was published.

Include the run URL(s), npm URL (`https://www.npmjs.com/package/<pkg>/v/<v>`),
GitHub Release URL, and any step skipped or blocked.
