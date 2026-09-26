# ZUDO_DEPS_PINS

Provenance for artifacts vendored or generated from first-party (Takazudo/zudolab) upstreams.
Updated by `/dev-bump-zudo-deps` on every sync — keep `pinned:` accurate.

## create-zudo-doc

- repo: zudolab/zudo-doc
- what: doc-site host scaffold, copied with the `doc/` host-glue lines (chrome bindings import,
  islands seed import, `@takazudo/zudo-circuit-doc/styles.css` import) layered on top — see
  `circuit/WORKFLOW.md` and this project's own `zfb.config.ts`/`chrome-bindings.tsx` for what was
  added beyond the scaffold
- files: `doc/pages/docs/[[...slug]].tsx`, `doc/pages/index.tsx`, `doc/tsconfig.json`,
  `doc/src/styles/global.css` (the `@import`/`@source` chain; the `@theme` override slot is empty
  by design), `doc/scripts/check-links.js`
- source: `packages/create-zudo-doc/templates/default/app/{pages/docs/[[...slug]].tsx,pages/index.tsx,tsconfig.json,src/styles/global.css,scripts/check-links.js}`
  (the pinned `create-zudo-doc@5.27.0` output, probed during planning and re-derived by the zudo-circuit-doc monorepo's upstream-scaffold parity check)
- track: releases
- pinned: 50cbd5c6c9e5a795d72a74a855e105e4939d4eab (v5.27.0)
- updated: 2026-09-26
- sync: run `create-zudo-doc@5.27.0` into a scratch dir and diff its `app/` output against the
  files listed above; `/dev-bump-zudo-deps` performs the upstream-scaffold parity check (#24) the
  same way
- notes: `doc/scripts/check-links.js` is byte-identical to upstream — it resolves paths from
  `process.cwd()`, so this project's root `check:site` script invokes doc's own `check:links`
  script with pnpm's `--dir doc` flag (cwd becomes `doc/`) rather than pointing `node` at the
  script's path from the project root, to keep the vendored file unmodified.
  `doc/pages/docs/[[...slug]].tsx` carries one added line beyond the upstream docHistory-patched
  stub: `import "../lib/_circuit-doc-islands";` (ADR-016). `doc/src/styles/global.css` has one
  added `@import "@takazudo/zudo-circuit-doc/styles.css";` line after the upstream
  `@takazudo/zudo-doc/features.css` import (ADR-015). Re-apply both after any re-copy.

## zfb family (registry-pinned, not vendored)

- repo: Takazudo/zfb
- what: `@takazudo/zfb`, `@takazudo/zfb-runtime`, `@takazudo/zfb-md-wasm` — exact-pinned
  `dependencies` in `doc/package.json` (ADR-003), not a file copy; `/dev-bump-zudo-deps`'s
  registry-dep resolver already tracks these. This entry exists only so a `ZUDO_DEPS_PINS.md`
  sweep surfaces the fallback rule below instead of silently skipping the family.
- files: `doc/package.json`
- source: n/a (registry release, not a vendored file copy)
- track: releases
- pinned: 2.21.0
- updated: 2026-09-26
- sync: bump `doc/package.json` (registry dep edit), not a file sync
- notes: fallback rule (ADR-003) — if the build or island hydration ever fails on zfb 2.21.0 but
  passes on 2.20.3, pin the whole family (`@takazudo/zfb`, `-runtime`, `-md-wasm`) to 2.20.3 here
  and in `doc/package.json`, and file `/dev-upstream-report`.
