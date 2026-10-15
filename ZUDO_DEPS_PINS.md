# First-party dependency and scaffold provenance

Recorded 2026-10-15 for the bounded update from merged main
`a6f941334064a1476347daca22bda3ff5c9d416e` (#156). The earlier #155 migration
is complete. Historical release notes and the frozen LED corpus retain their
original pins. Runtime 0.3.0 and initializer 0.2.0 remain prepared, not published.

## Published family

| Package | Previous lockfile version | Selected version |
| --- | --- | --- |
| `@takazudo/zfb` | 4.5.0 | 4.5.2 |
| `@takazudo/zfb-runtime` | 4.5.0 | 4.5.2 |
| `@takazudo/zfb-md-wasm` | 4.5.0 | 4.5.2 |
| `@takazudo/zudo-doc` | 6.2.0 | 7.0.0 |
| `@takazudo/zudo-doc-history-server` | 6.2.0 | 7.0.0 |
| `create-zudo-doc` (unscoped, root tool only) | 6.2.0 | 7.0.0 |

All six targets are published stable releases, resolved from npm metadata.
Development and host pins stay exact; runtime peers retain caret operators at
`@takazudo/zudo-doc: ^7.0.0` and `@takazudo/zfb: ^4.5.2`. Node moves to the
upstream-supported 24 LTS line (`>=24 <25`), including live/generated manifests,
the config-loader/doctor gate and CI. TypeScript remains 5.9, pnpm 11.5.2 and
Python >=3.10. No optional math/MCP/design-token features are enabled.

The resolver scanned 12 manifests. Direct external dependency edits are limited
to root `package.json`, `packages/circuit-doc/package.json`, `doc/package.json`,
`examples/empty/doc/package.json` and `examples/minimal/doc/package.json`.
`create-zudo-doc` is handled explicitly because it is unscoped. The one live
lockfile is `pnpm-lock.yaml` for eight workspace projects. Templates are derived
with `pnpm sync:template`; test-fixture runtime ranges, `workspace:*` contracts,
private root version and template runtime `^0.3.0` are preserved.

The exact release-age exception becomes `@takazudo/zfb-slugify@4.5.2`, matching
ZFB's required dependency. The global install policy is unchanged. Strict fresh
and frozen-lockfile installs pass without new exceptions or dependency patches.

## create-zudo-doc scaffold

- repo: `zudolab/zudo-doc`
- source: `packages/create-zudo-doc/templates/base/` and
  `packages/create-zudo-doc/src/scaffold.ts` (feature composition)
- pinned: `82049856397927077c5288465db34e44d0939260`, verified tags
  `v7.0.0`, `zudo-doc-v7.0.0`, `zudo-doc-history-server-7.0.0`
- package: `create-zudo-doc@7.0.0`; npm `gitHead` matches that commit
- integrity: `sha512-uvbDTd9DZY8yapzcE54gSJFQ1jMBXSTS8qakrVPcWdtmBolTmC+8Fj6lNSuoZfiE6jaNqySO5yYSowY3jryb8w==`
- updated: 2026-10-15
- files: canonical `examples/empty/doc/{pages,tsconfig.json,src/styles/global.css,scripts/check-links.js}`;
  generated `packages/create-zudo-circuit-doc/templates/default`; corresponding
  minimal/documentation host glue; `scripts/lib/fixture-site.mjs`
- sync: generate a separate reference with `generateUpstreamScaffold()` from
  `scripts/check-upstream-scaffold.mjs`, then run `pnpm sync:template`,
  `pnpm check:upstream-scaffold` and `pnpm check:template`
- notes: exact parity against the published 7.0.0 generator passes without host-file
  edits. Retain the eleven-feature selection, `DocHistoryBoundary`, circuit
  stylesheet after feature CSS, direct six-component MDX registry, islands route
  import and seed, local content/routes/header/sidebar, asset viewer, history
  exclusions, strict links and generated-project install policy. Scaffold engines
  move to Node 24. The relative aliases and absence of `baseUrl` remain unchanged.

## Impact assessment

- zudo-doc 6.2.0 -> 7.0.0: Node 24 only, ZFB peers ^4.5.2, history peer ^7.0.0;
  optional KaTeX floor ^0.18.2 || ^0.19.0 is irrelevant to these math-disabled
  hosts. Published public exports/bin are unchanged. Changes include stationary
  header/same-context sidebar transitions, content-only loading feedback and narrow
  prose wrapping. Existing configuration is retained.
- #4530 and #4536 fixes remain present: required-prop MDX registration uses the
  same published declarations, and both sidebar client payload projections are
  unchanged. Strict packed registration and the original raw LED scans pass:
  OWNED 269 canaries x 81 artifacts, SITE 266 x 213, zero hits; the pre-existing
  three authored-public SITE subtractions remain. No scanner or fixture edits.
- history-server 6.2.0 -> 7.0.0 changes only its version and changelog. The real
  repository history remains available to documentation/example builds.
- create-zudo-doc 6.2.0 -> 7.0.0 changes the family, Node engines and generated
  requirements. The shipped templates are byte-identical. Preserve the feature
  list and documented circuit additions; no unrelated options are adopted.
- ZFB 4.5.0 -> 4.5.2 updates required slugify and optional platform-native packages.
  Upstream notes describe live `public/assets/` serving, route-ready dev startup
  and explicit/compact MDX table fixes. Runtime's shipped code is unchanged and
  its exact ZFB peer becomes 4.5.2. md-wasm's WASM/build artifacts and release
  marker change; exports are unchanged. Align all three packages.
- All twelve old/new tarball SHA-512 integrities were checked. Manifest/export/
  peer/engine and relevant declarations, generator and changelog diffs were read.
  Source compares verify the linear endpoints: Doc
  `6542b8300f4a554247563a3bac53e415a63ded51` ->
  `82049856397927077c5288465db34e44d0939260`; ZFB
  `dcf1e9235882e365a63cee9d551c58c9f0c19107` ->
  `57f625a2e3fc4bf69eb526c7bb8ef2103d4669d6`. Most npm packages omit `gitHead`,
  so verified release tags supply provenance. Published tarballs are the primary
  consumer evidence; no upstream source checkout was installed or built.

Local implementation and verification do not authorize publication. After separate
release approval: runtime publication/approval, the existing `--published-runtime`
gate, then initializer publication/approval. A future push to main automatically
builds/deploys the documentation site; no workflow is dispatched by this update.
