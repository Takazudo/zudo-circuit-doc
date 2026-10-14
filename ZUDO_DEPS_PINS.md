# First-party dependency and scaffold provenance

Recorded 2026-10-14 for issue #155. Historical release notes and the frozen LED
corpus retain their original pins. Product versions remain runtime 0.3.0 and
initializer 0.2.0, prepared but not published.

## Published family

| Package | Previous lockfile version | Selected version |
| --- | --- | --- |
| `@takazudo/zfb` | 4.3.1 | 4.5.0 |
| `@takazudo/zfb-runtime` | 4.3.1 | 4.5.0 |
| `@takazudo/zfb-md-wasm` | 4.3.1 | 4.5.0 |
| `@takazudo/zudo-doc` | 6.0.0 | 6.2.0 |
| `@takazudo/zudo-doc-history-server` | 6.0.0 | 6.2.0 |
| `create-zudo-doc` (unscoped, root tool only) | 6.0.0 | 6.2.0 |

Registry metadata, exports, peers, engines and `npm diff` were inspected for all
six packages. Development and host versions are exact; runtime peers are
`@takazudo/zudo-doc: ^6.2.0` and `@takazudo/zfb: ^4.5.0`. TypeScript remains 5.9,
pnpm 11.5.2, Node >=22.18.0 and Python >=3.10.

The read-only first-party resolver scanned 12 manifests. The direct-write
allowlist is root `package.json`, `packages/circuit-doc/package.json`,
`doc/package.json`, `examples/empty/doc/package.json` and
`examples/minimal/doc/package.json`. These contain all live external first-party
declarations. The single live lockfile is `pnpm-lock.yaml` for eight workspace
projects. Generated templates are derived; test fixtures and the project's own
runtime ranges are excluded from external-package resolution.

The 4.5.0 ZFB manifest requires `@takazudo/zfb-slugify@4.5.0`. pnpm identified
that exact fresh transitive dependency as needing a release-age exception during
installation; it replaces the old 4.3.1 exception without changing the global policy.

## create-zudo-doc scaffold

- repo: `zudolab/zudo-doc`
- source: `packages/create-zudo-doc/templates/base/` and
  `packages/create-zudo-doc/src/scaffold.ts` (feature composition)
- pinned: `6542b8300f4a554247563a3bac53e415a63ded51`, verified tags
  `v6.2.0`, `zudo-doc-v6.2.0`, `zudo-doc-history-server-6.2.0`
- package: `create-zudo-doc@6.2.0`; npm `gitHead` matches that commit
- integrity: `sha512-s1BjmRWAq3xNZeGIi23SPORbVFCAT6WQIYDJbrCEhItsd3Bi2VorIUa3ctGat/F2XXmliHfPu7w9K8fIxsvT5w==`
- updated: 2026-10-14
- files: canonical `examples/empty/doc/{pages,tsconfig.json,src/styles/global.css,scripts/check-links.js}`;
  generated `packages/create-zudo-circuit-doc/templates/default`; corresponding
  minimal/documentation host glue; `scripts/lib/fixture-site.mjs`
- sync: generate a separate reference with `generateUpstreamScaffold()` from
  `scripts/check-upstream-scaffold.mjs`, refresh `examples/empty`, then run
  `pnpm sync:template`, `pnpm check:upstream-scaffold` and `pnpm check:template`
- notes: retain the existing eleven-feature selection, exact host pins,
  `DocHistoryBoundary`, circuit stylesheet after feature CSS, direct six-component
  MDX registry, and `../lib/_circuit-doc-islands` route import. Preserve local
  content, routes, header/sidebar configuration, asset viewer, history exclusions,
  strict built-HTML link checks, and generated-project install policy. The 6.2.0
  tsconfig removes `baseUrl` and uses `"@/*": ["./src/*"]`. Fixture-site overlays
  this canonical tsconfig and retains its existing compatible configuration.

The earlier scaffold's provenance is retained in git history and the example
pins files. No historical commit is inferred from today's upstream HEAD.

## Impact assessment

- zudo-doc 6.0.1 fixes required-prop MDX registration (`Component<never>`) and
  removes descriptions from both native sidebar client payloads. Version 6.2.0
  also changes sidebar persistence and Appearance interaction and removes the
  shared `baseUrl`. Preserve the existing product configuration and verify those
  behaviors. No optional sidebar scope, MCP, agent export or design-token panel
  is adopted.
- The delayed-load browser audit attributes OrbitControls' capturing document
  listener through its canvas-root lookup. zudo-doc 6.2.0's document-lifetime
  sidebar-scroll listener is not a viewer allocation. Zero active viewer listeners,
  wrong-target/capture removal failures, late canvases and post-disposal rendering
  remain asserted; a regression proves unrelated shell registrations stay separate.
- create-zudo-doc updates the family and relative aliases; the existing feature
  selection and exact-file/circuit-addition parity checks remain unchanged.
- history-server's published diff contains only package version and changelog
  changes; retain the history and asset-viewer integrations.
- ZFB/runtime changes include Wind/frontmatter and browser-history fixes and
  optional CSS compiler/ErrorBoundary APIs. The latter are not adopted. Runtime's
  peer is exactly ZFB 4.5.0. md-wasm stays aligned, including its changed release
  marker and artifact hashes.
- Most family packages omit npm `gitHead`; verified release tags supply source
  provenance instead. ZFB tags resolve to `c14ea1fcebee4fed892aeaef6559c9446496ea58`
  (4.3.1) and `dcf1e9235882e365a63cee9d551c58c9f0c19107` (4.5.0).
  The zudo-doc 6.0.0 release tag resolves to
  `b4f974598b27064a092eeadb5b2e5559078a8bb9`. Published tarball diffs, rather than
  an assumed repository build, are the consumer-change evidence.

Final verification and merge disposition are recorded on
[PR #156](https://github.com/Takazudo/zudo-circuit-doc/pull/156) and
[issue #155](https://github.com/Takazudo/zudo-circuit-doc/issues/155).
