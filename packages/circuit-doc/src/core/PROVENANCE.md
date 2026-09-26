# Provenance: `src/core/**`

Every file in this directory (and `render/`) is copied **byte-identical** from the
zudo-led-lamp component-docs engine, pinned at:

- Source repository: `Takazudo/zudo-led-lamp`
- Commit: `194d8a297e3545588197342130c3111a66c10973`
- Source root: `doc/component-docs/core/`

Copied with:

```
git -C <zudo-led-lamp clone> archive 194d8a297e3545588197342130c3111a66c10973 -- doc/component-docs/core
```

`node scripts/check-core-provenance.mjs` re-hashes the files below and fails if any
byte differs from the recorded sha256, except for files listed in an
`allowlist` under `src/core/provenance-allowed/<issue-slug>.txt` (see that
directory's README).

## Files

| File | Source path | sha256 |
| --- | --- | --- |
| `errors.ts` | `doc/component-docs/core/errors.ts` | `19e51bc6568fd3874dfec3d6a58edf44742652251dec95abc7315190769e2fda` |
| `text.ts` | `doc/component-docs/core/text.ts` | `72e9f54e20228ef766e6f3afef5d82871ba409dc0f4f57df76eb90b2ed1682e1` |
| `url.ts` | `doc/component-docs/core/url.ts` | `c0bd3cbde60a16f67123333498093c349fad4bc0586d362ea835cc73fa50f9e9` |
| `ids.ts` | `doc/component-docs/core/ids.ts` | `93902802a88ea2c9df291ebd3fb658531fc427ec955c3f982110f51ec0e8e6d1` |
| `mdx.ts` | `doc/component-docs/core/mdx.ts` | `8466fd3fa0c6b4411c59d8253b24362c0a935896a3fbd3480ff3f62f076177fe` |
| `page.ts` | `doc/component-docs/core/page.ts` | `3faa3a80f24c66956eb7f2d943c9c7da08d8b8816579a88352e2c5d216df253f` |
| `links.ts` | `doc/component-docs/core/links.ts` | `0a2d84604a4a4e0e273ff6ee6663a04f7ee0de987f2831617ebe6abf1e86822e` |
| `emit.ts` | `doc/component-docs/core/emit.ts` | `773270231cf396c12e44bf9a8a58c2287a8ce1e90362f86d6e044931f2427ae4` |
| `publication.ts` | `doc/component-docs/core/publication.ts` | `192ac4b53d2ea1176be61469ab51284a0a42ceeebc6b80ad80139af209d14812` |
| `view-model.ts` | `doc/component-docs/core/view-model.ts` | `239e2708008b4c238c2879e63cdef34da74c5cfddcd42f58ff620ac71a2532ec` |
| `adapter.ts` | `doc/component-docs/core/adapter.ts` | `a7476afd88a9c8b98d3a47af7ca5e93410bb47586985aec654b6f1baf43c06a3` |
| `pipeline.ts` | `doc/component-docs/core/pipeline.ts` | `98920a0de412a3e5af7709717859ece3a0a57316ba5ebbe33ad2af6911291449` |
| `scan.ts` | `doc/component-docs/core/scan.ts` | `b7aa2f9fb29090aff5728e99cfb0a5d3e241d65c689a277a38ebe5ac8aae108a` |
| `model-descriptor.ts` | `doc/component-docs/core/model-descriptor.ts` | `df7b95a62e6eeb73ff1b3ee8b4faa9e1d0f5c39ec36ceb40ec2eb7f2e02a9ea5` |
| `reference-descriptor.ts` | `doc/component-docs/core/reference-descriptor.ts` | `4a9d81c01264e8c887283b640a39c8259c01cea15b702733b047e7ae7b72c070` |
| `render/shared.ts` | `doc/component-docs/core/render/shared.ts` | `d04cd926fa6551b143a03c52da06beb6f82a01b99b81bcec6f6306c7d8cb9c9a` |
| `render/catalog.ts` | `doc/component-docs/core/render/catalog.ts` | `ae54b3f2b68e7a937c61fd3713cc22408d6ff5c1ade146adce27884e163b801e` |
| `render/integration.ts` | `doc/component-docs/core/render/integration.ts` | `3ee7fe25d60376ba86de765238061406ea5539b35fe8e8d837ef88146821a068` |
| `render/landing.ts` | `doc/component-docs/core/render/landing.ts` | `7eae9a6d2684d59ebc8f569012ad1fc2530abaa6f0fe48ba55a234fdb598c4d3` |
| `render/record.ts` | `doc/component-docs/core/render/record.ts` | `3eca8931041e2a6106037704928f3deb1617a58cc567f71c9089c1f4f8531472` |

`descriptors.ts` in this same directory is **not** covered by this provenance
record — it is the `"./descriptors"` export barrel (`export * from
"./model-descriptor.ts"` / `"./reference-descriptor.ts"`) that #13 (package UI
/ MDX components) filled in, not a copy of upstream core.

`site.ts` is likewise **not** covered — it is new code introduced by #14,
consolidating the route and asset-URL constants that used to be duplicated
across `render/shared.ts`, `links.ts` and the two descriptor modules.

## Test fixtures

`test/fixtures/view-model-fixtures.ts` is copied from LED
`doc/component-docs/tests/fixtures.ts` at the same commit, with only its
relative import specifiers rewritten to point at `src/core/**` from the new
location. It is not part of the hashed set above (it lives under `test/`, not
`src/core/`), and its content is otherwise unchanged.

## Later changes

Sub-issues #10, #14, #15, #18 and #25 change specific files in this directory
deliberately. Each records its allowed paths in
`src/core/provenance-allowed/<issue-slug>.txt` (one relative path per line, see
that directory's README) so the check tolerates only those files, and parallel
branches never touch the same file.

#10 (`provenance-allowed/emit-ownership.txt`: `emit.ts`, `page.ts`,
`pipeline.ts`) made `emit()` a plan → validate-all → write → remove pipeline
that changes zero bytes on any conflict (a marker-less target, a stray `.mdx`,
or any non-`.mdx` file under the generated root) and reports `PATH_CONTAINMENT`
instead; and made `page.ts`'s generated-file marker configurable
(`GENERATED_MARKER` neutral by default, `LEGACY_MARKERS` keeping the old LED
marker for backward compatibility, `PipelineOptions.generatedMarker`).

#14 (`provenance-allowed/render-options.txt`) moved the route/asset-URL
constants into the new, unhashed `site.ts`, added `RenderOptions`
(`agentResources`, `integrationDomainGloss`, `generatedNotice`) threaded
through every renderer and `pipeline.ts`, and rewrote the catalog/landing/
integration zero-state copy.

#15 (`provenance-allowed/cad-lock.txt`: `publication.ts`) added the
`expect.packages` reviewed CAD-package lock (ADR-012) to
`InstanceSelection.expect`, gated only when the project has CAD-mounted
records to publish and never serialized into the preflight report.

#18 (`provenance-allowed/view-model-v2.txt`: `view-model.ts`) bumped
`VIEW_MODEL_VERSION` to 2 (ADR-011), so the unified CLI's adapter-contract
check can refuse a provider that still emits the v1 shape.

#25 (`provenance-allowed/25-examples-minimal.txt`: `view-model.ts`,
`render/record.ts`, `render/catalog.ts`) rendered a PCB-mounted record with no
published package as neutral "CAD is not enabled" text instead of an error
(ADR-012's declared-zero exception), and stopped the catalog from showing an
empty Orderable ID cell.

The v0.1 pre-merge review (`provenance-allowed/review-hardening.txt`:
`url.ts`) denies `https:host/x` and `https:/host/x` as `NOT_ABSOLUTE`, since a
browser resolves those against the current page. The same review made the
`emit.ts`/`page.ts` generated-marker and drift comparison tolerate CRLF
checkouts; those files were already allowed by #10.
