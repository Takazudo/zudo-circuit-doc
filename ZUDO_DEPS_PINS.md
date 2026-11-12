# First-party dependency and scaffold provenance

Recorded 2026-11-12 for the zudo-doc 10.0.3 / ZFB 6.0.1 update (ADR-027), on top of the
9.1.4 / 5.2.2 family (ADR-026). Historical release notes and the frozen LED corpus retain
their original pins. Runtime 0.3.1 and initializer 0.2.2 are published; this family ships
in the next runtime (0.4.0) and initializer releases.

## Published family

| Package | Previous lockfile version | Selected version |
| --- | --- | --- |
| `@takazudo/zfb` | 5.2.2 | 6.0.1 |
| `@takazudo/zfb-runtime` | 5.2.2 | 6.0.1 |
| `@takazudo/zfb-md-wasm` | 5.2.2 | 6.0.1 |
| `@takazudo/zudo-doc` | 9.1.4 | 10.0.3 |
| `@takazudo/zudo-doc-history-server` | 9.1.4 | 10.0.3 |
| `create-zudo-doc` (unscoped, root tool only) | 9.1.4 | 10.0.3 |

All six targets are the `latest` stable releases, resolved from npm metadata (no stale-tag or
graduation flags). zudo-doc 10.0.3 requires the ZFB family at `^6.0.1` and history-server at
`^10.0.0`, so the family moves together. Development and host pins stay exact. Runtime peers
rise to `@takazudo/zudo-doc: ^10.0.3` and `@takazudo/zfb: ^6.0.1` (breaking for hosts on
zudo-doc 9). Node stays on 24 LTS (`>=24 <25`), pnpm 11.5.2 and Python >=3.10. The monorepo
toolchain stays on TypeScript 5.9; the doc hosts and the generated template pin TypeScript
`^7.0.2` and `diff ^8.0.4 || ^9.0.0`, following create-zudo-doc 10's generator (parity-checked).

The resolver again proposed moving the initializer test fixture's `@takazudo/zudo-circuit-doc`
range (to `^0.3.1`); that was rejected because the test fixtures pin their own contracts.
`workspace:*` contracts are preserved.

The exact release-age exception becomes `@takazudo/zfb-slugify@6.0.1`, matching
ZFB's required dependency.

## create-zudo-doc scaffold

- repo: `zudolab/zudo-doc`
- source: `packages/create-zudo-doc/templates/base/` and
  `packages/create-zudo-doc/src/scaffold.ts` (feature composition)
- pinned: `c7210d5cbb26c3b765271b71c0c8effd01f54995` (npm `gitHead` of `create-zudo-doc@10.0.3`;
  tags were not re-verified from the updating session)
- package: `create-zudo-doc@10.0.3`
- integrity: `sha512-kr8DJEI51TmnS/fAzeH5IQM2mRLBgXKjJp7R0KABS5fwdcuxr5EXk8FUCYIZ/Sg2tuhTNMMjNJoWgrwQXeo3Hw==`
- updated: 2026-11-12
- files: canonical `examples/empty/doc/{pages,tsconfig.json,src/styles/global.css,scripts/check-links.js}`;
  generated `packages/create-zudo-circuit-doc/templates/default`; corresponding
  minimal/documentation host glue; `scripts/lib/fixture-site.mjs`
- sync: generate a separate reference with `generateUpstreamScaffold()` from
  `scripts/check-upstream-scaffold.mjs`, then run `pnpm sync:template`,
  `pnpm check:upstream-scaffold` and `pnpm check:template`
- notes: the 10.0.3 generator changes the comment on the docHistory-patched docs route
  (`DocHistoryBoundary as DocHistory` from `@takazudo/zudo-doc/doc-history-area`) and the
  generated `typescript`/`diff` pins; all four hosts take them. The eleven default features are
  unchanged. Retain the eleven-feature selection, `DocHistoryBoundary`, circuit
  stylesheet after feature CSS, direct six-component MDX registry, islands route
  import and seed, local content/routes/header/sidebar, asset viewer, history
  exclusions, strict links, generated-project install policy (`allowBuilds: esbuild: true`,
  still written by the 10.x generator) and the explicit `themePack: "graphite"` with
  `themePacks: ["graphite"]` (ADR-026). The relative aliases and absence of `baseUrl` remain unchanged.

## Impact assessment

- zudo-doc 10.0.0: `themePack: "default"` becomes an alias of Graphite and Classic moves to
  `classic`; `DEFAULT_THEME_PACK_SLUG` is replaced by `CLASSIC_THEME_PACK_SLUG`. Every host
  already selects `graphite` explicitly and no code uses the removed constant: no change.
- zudo-doc 10.0.0: requires ZFB 6.0.1 (Rolldown bundling; removed bundler selectors must stay
  unset — none is set here) and history-server 10. 10.0.1 fixes the theme CLI's `themePack`
  detection; 10.0.2 widens the optional `diff` peer to `^8 || ^9` and adopts ZDTP 0.9.4.
- history-server 9.1.4 -> 10.0.3: no package-specific changes.
- create-zudo-doc 9.1.4 -> 10.0.3: Classic slug `classic`; generated pins zudo-doc/history
  `^10`, ZFB `^6.0.1`, TypeScript `^7.0.2`, `diff ^8.0.4 || ^9.0.0`, ZDTP 0.9.4. TypeScript 7
  rejects command-line files beside a `tsconfig.json` (TS5112), so the packed-consumer strict
  registration probe passes `--ignoreConfig`.
- ZFB 5.2.2 -> 6.0.1: Rolldown bundler; transcluded files now honour `markdown.gfm`, math, CJK
  and hard-break settings. The hosts do not transclude; the LED
  publication scan is the gate for rendering changes.

Previous update (9.1.3 -> 9.1.4, Graphite adoption):

- zudo-doc 9.1.3 -> 9.1.4 and history-server 9.1.3 -> 9.1.4 change only their version and
  changelog (published tarball diff).
- create-zudo-doc 9.1.3 -> 9.1.4 hardens the generated `setup-doc-skill.sh` for linked and
  bare-main worktrees and raises its generated pins to ^9.1.4. That script is not vendored
  here; the upstream parity check passes with no host-file edits.
- Theme: every host and the generated template move from Classic (`themePack: "default"`) to
  Graphite, zudo-doc 9's default look (ADR-026).

Previous update (9.1.0 -> 9.1.3, ZFB 5.1.5 -> 5.2.2):

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
