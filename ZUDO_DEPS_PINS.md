# First-party dependency and scaffold provenance

Recorded 2026-10-24 for the bounded update from merged main
`2ec86c0` (#157). Historical release notes and the frozen LED corpus retain their
original pins. Runtime 0.3.0 and initializer 0.2.0 remain prepared, not published.

## Published family

| Package | Previous lockfile version | Selected version |
| --- | --- | --- |
| `@takazudo/zfb` | 4.5.2 | 5.0.1 |
| `@takazudo/zfb-runtime` | 4.5.2 | 5.0.1 |
| `@takazudo/zfb-md-wasm` | 4.5.2 | 5.0.1 |
| `@takazudo/zudo-doc` | 7.0.0 | 8.0.0 |
| `@takazudo/zudo-doc-history-server` | 7.0.0 | 8.0.0 |
| `create-zudo-doc` (unscoped, root tool only) | 7.0.0 | 8.0.0 |

All six targets are published stable releases, resolved from npm metadata; zudo-doc
8.0.0's ZFB-family peers (`^5.0.1`) and history peer (`^8.0.0`) are satisfied with no
peer warnings. Development and host pins stay exact; runtime peers retain caret
operators at `@takazudo/zudo-doc: ^8.0.0` and `@takazudo/zfb: ^5.0.1`. Node stays on
24 LTS (`>=24 <25`), TypeScript 5.9, pnpm 11.5.2 and Python >=3.10.

The resolver scanned 12 manifests. Direct external dependency edits are limited
to root `package.json`, `packages/circuit-doc/package.json`, `doc/package.json`,
`examples/empty/doc/package.json` and `examples/minimal/doc/package.json`; the
template copy is kept in step and checked with `pnpm check:template`. The resolver
also proposed moving `@takazudo/zudo-circuit-doc` ranges to the latest published
`^0.2.0`; that was rejected because the template's `^0.3.0` targets the prepared,
unpublished runtime and the test fixtures pin their own contracts. `workspace:*`
contracts are preserved.

The exact release-age exception becomes `@takazudo/zfb-slugify@5.0.1`, matching
ZFB's required dependency.

## create-zudo-doc scaffold

- repo: `zudolab/zudo-doc`
- source: `packages/create-zudo-doc/templates/base/` and
  `packages/create-zudo-doc/src/scaffold.ts` (feature composition)
- pinned: `1e6fb670d2eed2b7d84ea66e87bf947001142c0e`, verified tags
  `v8.0.0`, `zudo-doc-v8.0.0`, `zudo-doc-history-server-8.0.0`
- package: `create-zudo-doc@8.0.0`; npm `gitHead` matches that commit
- integrity: `sha512-R4Y4ebPAjGZNJN67rM3ZSSE+fo8RmEBlXvrwXruSRxoFd3EKUvWXaxsozc/qlJQVJCqbowOoYdBS0NTJ7LUSqg==`
- updated: 2026-10-24
- files: canonical `examples/empty/doc/{pages,tsconfig.json,src/styles/global.css,scripts/check-links.js}`;
  generated `packages/create-zudo-circuit-doc/templates/default`; corresponding
  minimal/documentation host glue; `scripts/lib/fixture-site.mjs`
- sync: generate a separate reference with `generateUpstreamScaffold()` from
  `scripts/check-upstream-scaffold.mjs`, then run `pnpm sync:template`,
  `pnpm check:upstream-scaffold` and `pnpm check:template`
- notes: exact parity against the published 8.0.0 generator passes without host-file
  edits. Retain the eleven-feature selection, `DocHistoryBoundary`, circuit
  stylesheet after feature CSS, direct six-component MDX registry, islands route
  import and seed, local content/routes/header/sidebar, asset viewer, history
  exclusions, strict links and generated-project install policy. Scaffold engines
  move to Node 24. The relative aliases and absence of `baseUrl` remain unchanged.

## Impact assessment

- zudo-doc 7.0.0 -> 8.0.0 (via 7.1.0): ZFB peers move to ^5.0.1 and the history
  peer to ^8.0.0. 7.1.0's `plugins/optional-peers` export is removed again in 8.0.0
  (ZFB now handles rejection-handled optional imports); these hosts never
  registered it. New opt-in `siteTreeNavInitiallyCollapsed`; inline code in table
  cells returns to `overflow-wrap: break-word`; tab-panel prose and heading spacing
  fixes; engines drop the upper Node cap. No configuration change is needed.
- history-server 7.0.0 -> 8.0.0 changes only its version and changelog.
- create-zudo-doc 7.0.0 -> 8.0.0 changes only generated pins (ZFB 5.0.1, history
  ^8.0.0, wrangler, MCP SDK) and the Node range. Scaffold file output is unchanged;
  the upstream parity check passes with no host-file edits.
- ZFB 4.5.2 -> 5.0.1: the `zfb` and `zfb-runtime` tarballs change only manifests
  (platform binaries carry the engine). Along the way: 4.5.3 MDX compile fixes,
  4.5.4 islands-graph stability, 4.6.0 RUSTSEC-2026-0381/0382 and Windows fixes,
  4.7.0 Rolldown as the page/SSR/island bundler (island asset hashes change;
  `ZFB_BUNDLER=esbuild` reverts), 5.0.0 Node 24 floor (breaking; already required
  here), 5.0.1 keeps code shared with a lazy import out of the islands entry
  (zfb#4444/#4449). Without that last fix the component model viewer failed its
  browser gate under 4.7.0. md-wasm ships rebuilt WASM with unchanged exports.
- Endpoints: zudo-doc `82049856` -> `1e6fb670` (tag v8.0.0); ZFB tag v5.0.1
  `c9ba39a5`. Published tarball diffs are the primary consumer evidence; no upstream
  checkout was installed or built.

Local implementation and verification do not authorize publication. After separate
release approval: runtime publication/approval, the existing `--published-runtime`
gate, then initializer publication/approval. A future push to main automatically
builds/deploys the documentation site; no workflow is dispatched by this update.
