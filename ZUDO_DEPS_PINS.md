# First-party dependency and scaffold provenance

Recorded 2026-10-23 for the bounded update from merged main
`2ec86c0` (#157). Historical release notes and the frozen LED corpus retain their
original pins. Runtime 0.3.0 and initializer 0.2.0 remain prepared, not published.

## Published family

| Package | Previous lockfile version | Selected version |
| --- | --- | --- |
| `@takazudo/zfb` | 4.5.2 | 4.7.0 |
| `@takazudo/zfb-runtime` | 4.5.2 | 4.7.0 |
| `@takazudo/zfb-md-wasm` | 4.5.2 | 4.7.0 |
| `@takazudo/zudo-doc` | 7.0.0 | 7.1.0 |
| `@takazudo/zudo-doc-history-server` | 7.0.0 | 7.1.0 |
| `create-zudo-doc` (unscoped, root tool only) | 7.0.0 | 7.1.0 |

All six targets are published stable releases, resolved from npm metadata. ZFB 5.0.0 is
also published but is held back: zudo-doc 7.1.0 declares ZFB-family peers of `^4.7.0`,
which 5.x does not satisfy, so 4.7.0 is the newest mutually compatible family.
Development and host pins stay exact; runtime peers retain caret operators at
`@takazudo/zudo-doc: ^7.1.0` and `@takazudo/zfb: ^4.7.0`. Node stays on 24 LTS
(`>=24 <25`), TypeScript 5.9, pnpm 11.5.2 and Python >=3.10.

The resolver scanned 12 manifests. Direct external dependency edits are limited
to root `package.json`, `packages/circuit-doc/package.json`, `doc/package.json`,
`examples/empty/doc/package.json` and `examples/minimal/doc/package.json`; the
template is derived with `pnpm sync:template`. The resolver also proposed moving
`@takazudo/zudo-circuit-doc` ranges to the latest published `^0.2.0`; that was
rejected because the template's `^0.3.0` targets the prepared, unpublished runtime
and the test fixtures pin their own contracts. `workspace:*` contracts are preserved.

The exact release-age exception becomes `@takazudo/zfb-slugify@4.7.0`, matching
ZFB's required dependency.

## create-zudo-doc scaffold

- repo: `zudolab/zudo-doc`
- source: `packages/create-zudo-doc/templates/base/` and
  `packages/create-zudo-doc/src/scaffold.ts` (feature composition)
- pinned: `7761cf2fa7dfb32cc24df4a8f54f3006b1db2fef`, verified tags
  `v7.1.0`, `zudo-doc-v7.1.0`, `zudo-doc-history-server-7.1.0`
- package: `create-zudo-doc@7.1.0`; npm `gitHead` matches that commit
- integrity: `sha512-aMDmtyU4H8qxaB4h+ZKRGOTRcOLTgIUM/JnhnSNi8jP6vIlSHglrM8AR8pLwyauVb7dh91HhkixulE0QTskDOQ==`
- updated: 2026-10-23
- files: canonical `examples/empty/doc/{pages,tsconfig.json,src/styles/global.css,scripts/check-links.js}`;
  generated `packages/create-zudo-circuit-doc/templates/default`; corresponding
  minimal/documentation host glue; `scripts/lib/fixture-site.mjs`
- sync: generate a separate reference with `generateUpstreamScaffold()` from
  `scripts/check-upstream-scaffold.mjs`, then run `pnpm sync:template`,
  `pnpm check:upstream-scaffold` and `pnpm check:template`
- notes: exact parity against the published 7.1.0 generator passes without host-file
  edits. Retain the eleven-feature selection, `DocHistoryBoundary`, circuit
  stylesheet after feature CSS, direct six-component MDX registry, islands route
  import and seed, local content/routes/header/sidebar, asset viewer, history
  exclusions, strict links and generated-project install policy. Scaffold engines
  move to Node 24. The relative aliases and absence of `baseUrl` remain unchanged.

## Impact assessment

- zudo-doc 7.0.0 -> 7.1.0: ZFB peers move to ^4.7.0; exports gain
  `./plugins/optional-peers`, which the preset now always registers to shadow the
  optional `katex`/`diff` peers when missing or their feature is off (workaround for
  ZFB#4429 under Rolldown). Inline code in table cells returns to
  `overflow-wrap: break-word`. No configuration change is needed.
- history-server 7.0.0 -> 7.1.0 changes only its version and changelog.
- create-zudo-doc 7.0.0 -> 7.1.0 changes only the generated zfb (4.7.0), history
  (^7.1.0) and MCP wrangler pins. Scaffold file output is unchanged; the upstream
  parity check passes against the new release with no host-file edits.
- ZFB 4.5.2 -> 4.7.0: the `zfb` and `zfb-runtime` tarballs change only manifests
  (platform binaries carry the engine). Upstream notes: 4.5.3 MDX compile fixes
  (multiline expressions, decimal comparisons in template strings), 4.5.4 islands
  graph stability, 4.6.0 RUSTSEC-2026-0381/0382 and Windows path fixes, 4.7.0
  Rolldown as the page/SSR/island bundler (island asset hashes change once;
  `ZFB_BUNDLER=esbuild` reverts) and package-TSX JSX options. md-wasm ships rebuilt
  WASM artifacts with unchanged exports. Align all three packages.
- Endpoints: zudo-doc `82049856` -> `7761cf2f` (tag v7.1.0); ZFB tag v4.7.0
  `da5a8f1a`. Published tarball diffs are the primary consumer evidence; no upstream
  checkout was installed or built.

Local implementation and verification do not authorize publication. After separate
release approval: runtime publication/approval, the existing `--published-runtime`
gate, then initializer publication/approval. A future push to main automatically
builds/deploys the documentation site; no workflow is dispatched by this update.
