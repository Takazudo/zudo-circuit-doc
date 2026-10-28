# First-party dependency and scaffold provenance

Recorded 2026-10-28 for the bounded update from merged main
`0090ecc` (#158). Historical release notes and the frozen LED corpus retain their
original pins. Runtime 0.3.0 and initializer 0.2.0 remain prepared, not published.

## Published family

| Package | Previous lockfile version | Selected version |
| --- | --- | --- |
| `@takazudo/zfb` | 5.0.1 | 5.1.5 |
| `@takazudo/zfb-runtime` | 5.0.1 | 5.1.5 |
| `@takazudo/zfb-md-wasm` | 5.0.1 | 5.1.5 |
| `@takazudo/zudo-doc` | 8.0.0 | 9.1.0 |
| `@takazudo/zudo-doc-history-server` | 8.0.0 | 9.1.0 |
| `create-zudo-doc` (unscoped, root tool only) | 8.0.0 | 9.1.0 |

All six targets are the `latest` stable releases, resolved from npm metadata (no stale-tag or
graduation flags); zudo-doc 9.1.0's ZFB-family peers (`^5.1.5`) and history peer (`^9.0.0`)
are satisfied with no peer warnings. Development and host pins stay exact; runtime peers
retain caret operators at `@takazudo/zudo-doc: ^9.1.0` and `@takazudo/zfb: ^5.1.5`. Node
stays on 24 LTS (`>=24 <25`), TypeScript 5.9, pnpm 11.5.2 and Python >=3.10.

The resolver scanned 12 manifests. Direct external dependency edits are limited
to root `package.json`, `packages/circuit-doc/package.json`, `doc/package.json`,
`examples/empty/doc/package.json` and `examples/minimal/doc/package.json`; the
template copy is kept in step and checked with `pnpm check:template`. The resolver
again proposed moving `@takazudo/zudo-circuit-doc` ranges to the latest published
`^0.2.0`; that was rejected because the template's `^0.3.0` targets the prepared,
unpublished runtime and the test fixtures pin their own contracts. `workspace:*`
contracts are preserved.

The exact release-age exception becomes `@takazudo/zfb-slugify@5.1.5`, matching
ZFB's required dependency.

zudo-doc 9.0.0 fails the build for an explicit `themePacks` list without `"graphite"`
and no `themePack`, so every host config (`doc/`, both examples, the template and the
LED fixture site) adds `themePack: "default"`, keeping the Classic look (ADR-024).

## create-zudo-doc scaffold

- repo: `zudolab/zudo-doc`
- source: `packages/create-zudo-doc/templates/base/` and
  `packages/create-zudo-doc/src/scaffold.ts` (feature composition)
- pinned: `f264a9331025cc7a94ce1bb4def1c5d8b8ffaf29`, verified tags
  `v9.1.0`, `zudo-doc-v9.1.0`, `zudo-doc-history-server-9.1.0`
- package: `create-zudo-doc@9.1.0`; npm `gitHead` matches that commit
- integrity: `sha512-WtzvAn33mpyVwvYn4/wZPZaK4ENSsnx4FTfHiHUWRU09Ur7Wl6IrI16m8aOKToD6CzhG0uT+NCIkMO4IbBq51w==`
- updated: 2026-10-28
- files: canonical `examples/empty/doc/{pages,tsconfig.json,src/styles/global.css,scripts/check-links.js}`;
  generated `packages/create-zudo-circuit-doc/templates/default`; corresponding
  minimal/documentation host glue; `scripts/lib/fixture-site.mjs`
- sync: generate a separate reference with `generateUpstreamScaffold()` from
  `scripts/check-upstream-scaffold.mjs`, then run `pnpm sync:template`,
  `pnpm check:upstream-scaffold` and `pnpm check:template`
- notes: exact parity against the published 9.1.0 generator passes without host-file
  edits; `templates/base` is unchanged since 8.0.0 and the eleven default features match.
  Retain the eleven-feature selection, `DocHistoryBoundary`, circuit
  stylesheet after feature CSS, direct six-component MDX registry, islands route
  import and seed, local content/routes/header/sidebar, asset viewer, history
  exclusions, strict links, generated-project install policy and the explicit
  `themePack: "default"` (the 9.x generator now omits it and defaults to Graphite).
  The relative aliases and absence of `baseUrl` remain unchanged.

## Impact assessment

- zudo-doc 8.0.0 -> 9.1.0 (via 8.1.0-8.1.3, 9.0.0): 9.0.0 makes Graphite the default
  theme pack and rejects an explicit `themePacks` list lacking `"graphite"` without a
  `themePack` (handled above); history peer moves to ^9.0.0; ZFB peers step up to ^5.1.5.
  8.1.0 adds opt-in `headerBrand` and a package-owned inline head script (matters only
  for CSP hash pins; none here); 8.1.1 adds katex/diff loader subpaths that silence
  optional-peer warnings; 8.1.3 polishes heading rules in nine non-default packs; 9.1.0
  restyles the sidebar branch-focus control, restores the full-viewport loading scrim and
  matches `categoryMatch` on the whole top-level segment (every match here already is
  one). zdtp 0.9 joins the optional peer range (unused here).
- history-server 8.0.0 -> 9.1.0 changes only its version and changelog.
- create-zudo-doc 8.0.0 -> 9.1.0 changes generated pins (ZFB 5.1.5, history ^9.1.0,
  zdtp 0.9.0, wrangler) and its theme-pack default/catalog. Scaffold file output is
  unchanged; the upstream parity check passes with no host-file edits.
- ZFB 5.0.1 -> 5.1.5: the `zfb` and `zfb-runtime` tarballs change only manifests
  (platform binaries carry the engine). 5.1.0 fails the build when an emitted islands
  chunk imports the islands entry (the 5.0.1 failure class, now guarded); 5.1.1-5.1.4
  fix Rolldown metafile/symlink spelling and Windows pnpm/link resolution; 5.1.5
  rebuilds against tokio 1.54.1 (RUSTSEC-2026-0386). md-wasm ships rebuilt WASM with
  unchanged exports.
- Endpoints: zudo-doc `1e6fb670` -> `f264a933` (tag v9.1.0); ZFB tag v5.1.5
  `526bcc55`. Published tarball diffs are the primary consumer evidence; no upstream
  checkout was installed or built.

Local implementation and verification do not authorize publication. After separate
release approval: runtime publication/approval, the existing `--published-runtime`
gate, then initializer publication/approval. A future push to main automatically
builds/deploys the documentation site; no workflow is dispatched by this update.
