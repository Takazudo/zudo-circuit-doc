# First-party dependency and scaffold provenance

Recorded 2026-11-06 for the bounded update from merged main
`cd0cbb7` (#161). Historical release notes and the frozen LED corpus retain their
original pins. Runtime 0.3.0 and initializer 0.2.0 remain prepared, not published.

## Published family

| Package | Previous lockfile version | Selected version |
| --- | --- | --- |
| `@takazudo/zfb` | 5.1.5 | 5.2.2 |
| `@takazudo/zfb-runtime` | 5.1.5 | 5.2.2 |
| `@takazudo/zfb-md-wasm` | 5.1.5 | 5.2.2 |
| `@takazudo/zudo-doc` | 9.1.0 | 9.1.3 |
| `@takazudo/zudo-doc-history-server` | 9.1.0 | 9.1.3 |
| `create-zudo-doc` (unscoped, root tool only) | 9.1.0 | 9.1.3 |

All six targets are the `latest` stable releases, resolved from npm metadata (no stale-tag or
graduation flags). zudo-doc 9.1.3 requires the ZFB family at `^5.2.2`, so both families move
together; its history peer (`^9.0.0`) stays satisfied. Development and host pins stay exact;
runtime peers retain caret operators at `@takazudo/zudo-doc: ^9.1.3` and `@takazudo/zfb: ^5.2.2`.
Node stays on 24 LTS (`>=24 <25`), TypeScript 5.9, pnpm 11.5.2 and Python >=3.10.

The resolver scanned the same manifests as the 9.1.0 update. It again proposed moving
`@takazudo/zudo-circuit-doc` ranges to the latest published `^0.2.0`; that was rejected
because the template's `^0.3.0` targets the prepared, unpublished runtime and the test
fixtures pin their own contracts. `workspace:*` contracts are preserved.

The exact release-age exception becomes `@takazudo/zfb-slugify@5.2.2`, matching
ZFB's required dependency.

## create-zudo-doc scaffold

- repo: `zudolab/zudo-doc`
- source: `packages/create-zudo-doc/templates/base/` and
  `packages/create-zudo-doc/src/scaffold.ts` (feature composition)
- pinned: `dee47852d9c12500b2dacf7a4d2a1d6bb0a8ecf5` (npm `gitHead` of `create-zudo-doc@9.1.3`;
  the upstream repo was not reachable from the updating session, so tags were not re-verified)
- package: `create-zudo-doc@9.1.3`
- integrity: `sha512-U21u2inOSAjCLA0kHIkuzqYdbry96b1z2YhwTIoCXNVZOcKnkkMl7RLxLy0PB4k6FXR9M90uqwBRRk5BUOSwGg==`
- updated: 2026-11-06
- files: canonical `examples/empty/doc/{pages,tsconfig.json,src/styles/global.css,scripts/check-links.js}`;
  generated `packages/create-zudo-circuit-doc/templates/default`; corresponding
  minimal/documentation host glue; `scripts/lib/fixture-site.mjs`
- sync: generate a separate reference with `generateUpstreamScaffold()` from
  `scripts/check-upstream-scaffold.mjs`, then run `pnpm sync:template`,
  `pnpm check:upstream-scaffold` and `pnpm check:template`
- notes: exact parity against the published 9.1.3 generator passes without host-file
  edits; the eleven default features are unchanged (`dist/constants.js` is byte-identical
  to 9.1.0). Retain the eleven-feature selection, `DocHistoryBoundary`, circuit
  stylesheet after feature CSS, direct six-component MDX registry, islands route
  import and seed, local content/routes/header/sidebar, asset viewer, history
  exclusions, strict links, generated-project install policy and the explicit
  `themePack: "default"` (the 9.x generator omits it and defaults to Graphite).
  The relative aliases and absence of `baseUrl` remain unchanged.

## Impact assessment

- zudo-doc 9.1.0 -> 9.1.3: 9.1.1 fixes a 9.1.0 regression so a `categoryMatch` value owns
  `foo`, `foo/...` and `foo-*` again (still not `foo2`); 9.1.2 and 9.1.3 only raise the ZFB
  peer floors to ^5.2.0 and ^5.2.2. The tarball diff touches only nav-scope/sidebar matching,
  config assertions, README, changelog and manifest.
- history-server 9.1.0 -> 9.1.3 changes only its version and changelog.
- create-zudo-doc 9.1.0 -> 9.1.3 adds `AUTHORING.md`/`AGENTS.md`/README pointers to the
  generated CLAUDE.md, appends the MCP deployment section to the base README instead of
  replacing it, updates `scripts/setup-doc-skill.sh` and the writing skill, and raises its
  generated zudo-doc pin to ^9.1.3. None of the vendored scaffold files change; the upstream
  parity check passes with no host-file edits.
- ZFB 5.1.5 -> 5.2.2 (5.2.0, 5.2.2): the `zfb` tarball changes only manifests (platform
  binaries carry the engine); `zfb-runtime` changes only `dist/client-router/{router,prefetch}.js`
  (native link targets incl. document base targets, form actions and SVG/xlink URLs resolved
  against the document base, browser-equivalent form submission, cancelling obsolete
  navigation on Back); md-wasm ships rebuilt WASM with unchanged exports. The ZFB GitHub
  changelog was not reachable from the updating session; these notes come from the published
  tarball diff and zudo-doc's changelog.
- Published tarball diffs are the primary consumer evidence; no upstream checkout was
  installed or built.

Local implementation and verification do not authorize publication. After separate
release approval: runtime publication/approval, the existing `--published-runtime`
gate, then initializer publication/approval. A future push to main automatically
builds/deploys the documentation site; no workflow is dispatched by this update.
