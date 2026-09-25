# fixtures/led

A pinned regression corpus vendored from
[Takazudo/zudo-led-lamp](https://github.com/Takazudo/zudo-led-lamp) @
`194d8a297e3545588197342130c3111a66c10973`. See `NOTICE.md` for licensing —
this content is not covered by this repository's MIT license.

## Layout

- `upstream/` — the pinned bytes, kept in the **LED repo-relative layout** (not
  reorganized) so the pinned validator (`ROOT = parents[4]`) and the preview
  manifest's footprint/model paths resolve unchanged.
- `fixture.lock.json` — the byte lock: every committed file's `size`, `sha256`
  and `gitBlob` (git blob SHA-1), plus the 25 STEP files as `materialized: true`
  entries (not committed — see below).
- `.gitignore` — excludes STEP files and scratch output the pinned oracle
  writes as a side effect (`upstream/tmp/`, `__pycache__/`).

## Why STEP is not committed

The 25 STEP files (~46 MB) are third-party SolidWorks/EasyEDA CAD exports.
Committing them permanently bloats this public repository's git history in a
way that a later history rewrite can't cleanly undo (ADR-013). They are
instead materialized on demand from the pinned commit and verified against
`fixture.lock.json`. No LED check reads STEP bytes — `references.ts` only
checks that the file exists — so nothing here is a fabricated stand-in.

## `scripts/sync-led-fixture.mjs`

```
node scripts/sync-led-fixture.mjs --check
node scripts/sync-led-fixture.mjs --materialize-step [--from-git <clone> | --from-github]
node scripts/sync-led-fixture.mjs --write --from-git <clone> | --from-github
node scripts/sync-led-fixture.mjs --verify-upstream
```

- `--check` (default, offline) verifies every committed file's size/sha256/gitBlob
  against the lock, checks any materialized STEP present on disk, and fails on a
  missing committed file, an extra file outside the lock/allowlist, or hash drift.
  It reports `materialized N/25`.
- `--materialize-step` writes the 25 STEP files from the pinned commit (default
  source: the GitHub codeload tarball; pass `--from-git <clone>` for a local
  clone, e.g. `$HOME/repos/circuits/zudo-led-lamp`) and verifies them against the
  lock.
- `--write` re-derives the whole file set from source and rewrites
  `fixture.lock.json` plus `upstream/` (excluding STEP). Only needed if the
  pinned commit or the derivation rules change.
- `--verify-upstream` (network) compares the lock's `gitBlob` values against the
  live GitHub tree API, to catch upstream history rewrites.

Also available as `pnpm fixtures:led:check` / `pnpm fixtures:led:materialize`.

## `scripts/run-led-oracle.mjs`

Copies `fixtures/led/upstream` to a scratch temp dir and runs the **pinned**
`validate.py`, its `unittest` suite and `check_forward_tests.py` unmodified,
then asserts `git status --porcelain fixtures/led` is unchanged. Also available
as `pnpm fixtures:led:oracle`. The validator never reads STEP, so this needs no
materialization.

## npm packing

`fixtures/` is never included in either published package's `files` list — it
exists only for this monorepo's own CI.
