# LED component-documentation engine: extraction audit

Audit date: 2026-09-25 UTC / 2026-09-26 Japan. Repository: `Takazudo/zudo-led-lamp`. All upstream observations below refer to commit `194d8a297e3545588197342130c3111a66c10973`.

## Recommendation

Build zudo-circuit-doc by packaging the working circuit-evidence workflow and documentation engine already in the LED project. Its architecture explicitly anticipated extraction. Do not start with another component registry, another evidence schema, or another set of renderers. The work is primarily to make project assumptions configurable, define a supported empty starting state, and provide the initializer and authoring resources. [Architecture and portability boundary][architecture] [Existing adoption guide][adoption]

The existing split is useful and sufficiently narrow: a component-documentation core, a circuit evidence adapter, and the site's zudo-doc bindings. The core is neutral about the evidence provider, but intentionally contains electronic-component concepts such as MPN, LCSC, placements, pin maps and DNP. That matches this product. Turning it into a general knowledge framework would add work without helping circuit development. [Architecture §12][architecture]

The original files archived with this report are reference material from upstream, not a completed package or a standalone runnable checkout. The source manifest records 67 files and verifies every local byte sequence against GitHub's Git blob SHA. No remote repository was changed.

## What already works upstream

### Existing API seam

`doc/component-docs/core/adapter.ts` already defines the adapter interface:

```ts
type ComponentDataAdapter = {
  readonly id: string;
  readonly contractVersion: number;
  readonly supportedViewModelVersions: readonly ViewModelVersion[];
  readonly validate: ValidationRunner;
  readonly selection: InstanceSelection;
  readonly matrix: PublicationMatrix;
  readonly project: (context: ProjectionContext) => Promise<PublicViewModel>;
};
type ValidationRunner = () => Promise<ValidationOutcome>;
```

`ProjectionContext` supplies a `PublicationPolicy`. `ValidationOutcome` reports `ok`, the executed argument array, exit code and stdout/stderr. This keeps Python, provider paths and subprocess execution out of the renderer. `createCircuitAdapter()` in `adapters/circuit/index.ts` constructs this shape, but currently accepts no options and closes over LED project constants. [Adapter types][adapter] [Circuit adapter implementation][circuit-index]

The actual main entrypoint is:

```ts
runPipeline(adapter, {
  generatedRoot: absoluteOutputDirectory,
  dryRun: false,
});
```

Its result contains pages, the publication report, emitted-path information or drift. Generate, check and watch share the same pipeline. The order is version negotiation, canonical validation, projection, anchor/link checks, safe rendering, emit/diff and report generation. An adapter that omits `policy.assertSelectionFresh(...)` is rejected. The report is returned by core and written separately by `cli/run.ts::writeReport()`. [Pipeline][pipeline] [CLI wrapper][run]

### Existing data and publication contracts

The adapter consumes the canonical v1 inventory and seven files per owner bundle: `manifest.json`, `sources.json`, `facts.json`, `coverage.json`, `routing.json`, `interactions.json`, and `pin-map.json`. `indexEvidence()` joins parsed data; `projectIndex()` produces the public view model without filesystem work. Preserve this separation so join and projection behavior can be checked with fixture data. [Paths][paths] [Provider shapes and joins][evidence]

The public view model includes records, sources, exact values and conditions, coverage domains, interactions, pin maps, package previews and integration rules. It preserves uncertainty instead of converting all states into a component-wide grade. Integration rules retain their refusal, recorded calculations and evidence chain; the generator does not recompute the calculations. [View model][view-model] [Integration projection][integration]

Publication has three existing controls: explicit instance selection; a complete `PublicationMatrix` with `PUBLISH` or `DENY` for every `FieldKey`; and value/URL checks. `InstanceSelection` already includes `recordIds`, `sourceIds`, narrower `linkableSourceIds`, `documentSelections`, and `expect` counts. Each document selection has a record, source and explicit `datasheet | specification | drawing` kind. At this commit the selected corpus asserts **35 records, 91 sources and 8 integration rules**. Some architecture paragraphs still contain older counts. Use the executable selection as the current instance authority. [Publication API][publication] [Current LED selection][selection]

### Existing safety and determinism to preserve

| Concern | Existing implementation | Extraction decision |
| --- | --- | --- |
| Canonical validation | `createPythonValidator()` invokes the Python validator using `execFile`, checks Python >=3.12, and never passes `--online` | Keep a validator callback; parameterize runtime/script/cwd; do not replace the Python rules with approximate TypeScript validation |
| Provider reads | `readContainedJson(root,path)` checks path segments and rejects symlinks from the root through the leaf | Reuse the explicit-root function and retain the same checks for configurable roots |
| Text/URL safety | Branded `SafeText`/`SafeUrl`, rejection of unsafe text and disallowed URL forms | Keep the brands and validation as the only way into publication |
| MDX | Closed AST builders, MDX-aware serializer and a final-output guard | Keep `mdast-util-to-markdown`, `mdast-util-mdx`, and `mdast-util-gfm-table`; do not concatenate evidence into MDX source |
| Identity | Stable ID-based slugs and anchors; explicit collision checks | Preserve IDs in migration; avoid display-name-derived routes |
| Generated output | Contained writes, symlink refusal, idempotence, marked-file pruning | Reuse after adding the target-ownership preflight described below |
| Publication audit | Deterministic preflight with field emitted/withheld counts and URL decisions | Keep committed, sorted and without timestamps; do not echo denied URL values |
| Selection closure | Facts, sources, parents and integration links must resolve within published selection | Preserve failure behavior; never silently remove a dangling reference |

Sources: [Validator wrapper][validate], [contained reads][read], [MDX][mdx], [emitter][emit], [publication policy][publication], [adapter joins][circuit-index].

## The empty-project problem is real and localized

An unchanged copy of the LED repository cannot initialize a new blank circuit. Empty arrays alone do not fix that. Several different types of assumption need different treatment.

| Exact location | Existing requirement | Effect on a new project | Proposed extraction change |
| --- | --- | --- | --- |
| `adapters/circuit/paths.ts` | Resolves repository/site roots from its own source depth; fixes `.claude/skills` and `zudo-led-lamp.pretty` / `.3dshapes` | Moving code into `node_modules` points it at the package location; another library name fails | Resolve absolute project paths once from the consuming config; pass a path object to the adapter |
| `createCircuitAdapter()` | No arguments; closes over LED selection, matrix and validator | A consumer cannot supply its own corpus | Add an options object mapping directly to existing interface inputs |
| `readEvidenceIndex()` | Always reads inventory, integration rules and reviewed references | No-evidence/no-KiCad state has no representation at this entrypoint | Make a valid empty inventory and rules file an explicit supported project state after validator extraction |
| `selection.ts` | Concrete LED record/source IDs and expected 35/91/8 corpus | An empty or different corpus fails freshness | Scaffold a project-owned empty selection with zero expectations; replace values only during actual reviewed onboarding |
| `PublicationPolicy` | Exactly one selected, linkable document per selected record | A candidate without an inspected document cannot enter the published catalog | Keep this strict initially; keep candidates in author-authored research pages until ready; do not synthesize a PDF source |
| `references.ts::readCircuitReferenceContract()` | Requires exactly **25** package entries | Even zero records fail with `ADAPTER_CONTRACT` | Replace this instance assertion with project configuration or a reviewed project manifest; zero must be explicitly supported |
| `references.ts::MODEL_PREFIX` | Literal `${KIPRJMOD}/../../footprints/kicad/zudo-led-lamp.3dshapes/` | New library/board layout rejected | Derive an allowed locator prefix from the same project path configuration; retain containment checks |
| `projectRecordReference()` | Requires a document and, for PCB-mounted records, a footprint/model reference | Research-only PCB record is not publishable | Preserve the reviewed-record contract; separately decide later whether unavailable preview states belong in a new view-model version |
| `model-assets.ts::buildModelAssetPlan()` | A second exact-25 assertion | `generate:models` fails on empty/small projects | Consume the validated selected package set and matching project assertion |
| `footprint-previews/check.ts` | Exact 25 manifests/selections, existing roots/manifest, library parity first | No-KiCad checkout fails before ordinary authoring | Add a validated zero-package manifest path, and run CAD checks only when the declared project capability is enabled |
| `cli/scan-artifacts.ts` | Minimum 100 owned canaries, 60 owned files, 100 site canaries, 150 site files; named AL8860 positive controls | Tiny projects fail unrelated LED baselines | Make corpus assertions and positive controls project-specific; keep non-vacuity checks for enabled surfaces |
| `doc/package.json` | Build starts with `generate:enclosure-viewer` | Lamp-only generation prevents generic initialization | Omit this feature from the base initializer |
| Canonical Python validator | LED board generator paths, pin locks and specific cross-component rules | Zero inventory still triggers LED checks | Extract generic v1 validation from declared project checks; see the companion evidence audit |

Primary locations: [paths][paths], [selection][selection], [publication][publication], [reference validation][references], [model publication][models], [footprint check][footprint-check], [artifact scanner][scanner], [package scripts][package].

Two isolated checks were actually executed against the retrieved TypeScript originals under Node 24.19.0:

1. An empty `InstanceSelection` with all expectations zero passes `new PublicationPolicy(...)` and `assertSelectionFresh([], [], 0)`.
2. `readCircuitReferenceContract(emptyIndex, emptySelection)` fails with `[ADAPTER_CONTRACT] preview manifest must contain exactly 25 packages`, detail `{expected:25,actual:0}`.

A third isolated fixture check ran `indexEvidence()` and `projectIndex()` using an empty v1 inventory and an explicitly supplied empty reference contract. It produced zero records, zero package previews, zero integration rules and all-zero corpus counts. This proves the pure shape/projection can represent emptiness. The fixture deliberately bypassed filesystem reference validation; it does **not** mean the current full adapter, Python validator, MDX build or site passes for an empty project.

### Recommended starting behavior

The initialized repository should immediately support writing the project brief, constraints, requirements, research requests and decisions, even before the first component is chosen. The Components area should explicitly say that no reviewed component is published yet. Zero records means no component has been reviewed; it must not be presented as a successful circuit audit.

For the first implementation, preserve the strict published-record contract and use ordinary MDX research pages for candidates. This permits useful work such as “find the exact datasheet,” “check whether this is the correct package,” and “find a suitable 3D model” without forcing fabricated evidence records. When real evidence and reviewed package references exist, select the record and generate its catalog page. Supporting partially documented public records can be a later deliberate view-model change, with clearly labeled unavailable document/preview states.

Do not weaken the generic evidence rules merely to make the empty fixture green. Separate missing required evidence from a capability that the project has not enabled yet. For example, no KiCad project on day one is legitimate; a selected PCB footprint referring to a missing model is still an error.

## Smallest useful configuration seam

The following is a proposed packaging design, not an API that already exists. Keep it close to the actual interfaces:

| Proposed consumer input | Maps to current implementation |
| --- | --- |
| Absolute repository root and doc root | `REPO_ROOT`, `DOC_ROOT` |
| Evidence root, inventory file and integration rules file | `SKILLS_ROOT`, `INVENTORY_FILE`, `INTEGRATION_RULES_FILE` |
| Generated components directory, preflight file and built-site directory | `GENERATED_ROOT`, `PREFLIGHT_FILE`, `DIST_ROOT` |
| Project-owned instance selection | Existing `InstanceSelection` |
| Field-publication decisions | Existing `PublicationMatrix` |
| Validator callback or configured Python runner | Existing `ValidationRunner` / `createPythonValidator({pythonBin,scriptPath,cwd})` |
| Optional CAD capability with canonical footprint root, model root, locator prefix and selected-package assertion | Current footprint/model constants and three exact-25 gates |
| Artifact-scan expectations and positive controls | Current scanner thresholds, named sample record and required routes |

Keep site branding, header navigation, domain and ordinary zudo-doc features in `zfb.config.ts`; those already belong to zudo-doc. A new `circuit.config.ts` should not duplicate `siteName`, `siteUrl` or all of zudo-doc's options. The package can accept the standard `/docs/components/` routes in its first release, documenting that convention. If routes become configurable, all route constructors, internal-link validation, artifact paths and agent-resource links must consume the same route policy. [Current route helpers][shared] [zudo-doc integration config][zfb]

A useful minimum implementation is a configured adapter factory plus path-injected CLIs. The initialization command should write only project configuration, genuine empty v1 input files, authoring pages and agent instructions. Avoid copying the entire generator into every future project's `doc/component-docs/`; that would recreate maintenance divergence. Keep the LED source snapshot as the reference fixture while moving shared behavior into a package.

## UI extraction requires more than core

### Preserve the accepted native-document presentation

The project has a detailed current `PRESENTATION-CONTRACT.md`. It deliberately uses normal headings, paragraphs, small metadata tables and the narrow `EvidenceFact` wrapper. Facts keep value/unit, conditions, verdict/provenance and the exact linked locator together. Coverage remains visible before Facts. Dense pin assignments may use native disclosure; claims and qualifications remain visible. Integration verdicts are immediately followed by their refusal. Reuse this language and layout rather than inventing a dashboard with overall confidence scores. [Presentation contract][presentation]

The source extraction should carry `core/render/**`, `ui/**`, descriptor types and the scoped evidence/reference styles together. The styles use zudo-doc tokens such as `--spacing-hsp-sm`, `--spacing-vsp-2xs`, and `--color-muted`. A package stylesheet is a natural destination; consumers should not need to paste the entire LED `global.css`. [Scoped style implementation][styles]

### Static bindings and interactive islands are different seams

`zfb.config.ts` sets `chromeBindingsModule: './src/chrome-bindings.tsx'`. That file registers `EvidenceAnchor`, `EvidenceDetails`, `EvidenceFact`, `EvidenceTable`, `ComponentReferences` and `PackageModelViewer` through `defineChromeBindings({mdxExtras:{...}})`. The generator's allowed MDX component names and this registry must stay synchronized. [Bindings][bindings] [MDX allowed components][mdx]

At the pinned commit, interactive previews additionally rely on the **host-owned** `doc/pages/docs/[[...slug]].tsx` statically importing `FootprintPreviewIsland` and `PackageModelViewerIsland`. Its `void` references deliberately keep them in zfb's static import graph. The virtual chrome-bindings export alone does not make the islands discoverable. The older architecture statement that `doc/pages/**` is never modified describes an earlier static stage; use the actual current route when planning extraction. [Current owned route][route]

The complete preview closure includes:

- `component-docs/ui/component-references.tsx`, `footprint-preview.tsx`, `package-model-viewer.tsx`;
- `core/reference-descriptor.ts` and `core/model-descriptor.ts`;
- `src/component-preview/footprint-preview-island.tsx` and `preview-enlarge-dialog.tsx`;
- `src/component-model-viewer/package-model-viewer-island.tsx`, `viewer-runtime.ts` and `viewer-state.ts`;
- the scoped styles and owned-route imports.

The Three.js runtime is dynamically imported by the model island. Preserve the SSR fallback, loading/error states, model-file link and the notice that a shared footprint package may not exactly match the manufacturer part. The full component reference should remain readable when JavaScript or WebGL is unavailable. [Model island][model-island]

### Asset contracts already exist

The reference reader validates selected document sources and the canonical footprint/model pair offline. A PCB footprint must name one local WRL model with exact offset/rotation/scale and a same-basename STEP audit pair. The published model is WRL; STEP is retained for audit. VRML nodes and size limits are explicitly bounded. Footprint SVGs have deterministic manifests and hash checks. Reuse those contracts and make their project instance inputs configurable; do not replace them with “download a file ending in .step” automation. [Reference validation][references] [Model publication][models] [Footprint check][footprint-check]

The current model publisher refuses to silently remove unexpected binary files, because those files have no generated-content marker. Keep that behavior, or adopt a manifest-owned deletion rule with explicit provenance. This is distinct from the MDX pruning contract.

## Two code-review cautions before extraction

### Generated target ownership is incompletely enforced

The architecture says hand-authored content under the generated tree is reported rather than destroyed. `emit.ts` enforces the generated marker while pruning leftover paths, but it does not check the marker before overwriting an **existing target path that this run generates**. Such a target is added to the owned set, written, and then skipped by pruning. This is a static code finding; no destructive reproduction was performed. [Emitter implementation][emit]

Before releasing a reusable initializer/generator, preflight every existing target and every deletion candidate before writing any file. An existing target must carry the recognized generated marker or match an explicit migration allowlist. Report a conflict without changing bytes. Preserve the current idempotence, containment and symlink protections. The checked-in upstream `emit.test.ts` tests refusing deletion of an extra handwritten file, but does not cover a handwritten file occupying a generated destination.

### Version and historical notes need an extraction boundary

`VIEW_MODEL_VERSION` is still 1. The adoption guide explicitly requires bumping it at extraction: upstream intentionally held 1 through incompatible changes while core and its sole adapter compiled together. Preserve the evidence schema's v1 separately; a public rendering-model version bump is not an excuse to rewrite the evidence corpus. [Version contract][view-model] [Extraction guidance][adoption]

Also update stale explanatory comments during packaging: the current 8-rule selection differs from older 7/6-rule prose; generated pages now include curated asset paths/descriptors despite early comments saying no paths; and interactive previews now use the owned-route island seam. Treat source behavior and current tests as stronger evidence than old milestone descriptions.

## Build and validation acceptance plan for local implementation

Keep process sequencing: component generation must finish before `zfb build` snapshots content. The current `build` also publishes models first. Generation remains offline; retrieval/audit commands are separate authoring operations. Watch only the evidence inputs, debounce saves, serialize generation and never watch the generated output tree. [Package scripts][package] [Pipeline][pipeline]

The decisive extraction cases are:

1. A freshly initialized project builds its authoring pages with no selected components and no KiCad installation. The resulting Components page states zero reviewed records honestly.
2. A small genuine evidence fixture (one PCB record) passes without any LED-specific ID, package count, domain or model-prefix assumption.
3. A source-to-fact-to-integration dependency remains linked after extraction, preserving exact values, conditions, provenance and unresolved states.
4. An existing hand-authored generated-target collision stops before any write. Symlink and traversal cases remain rejected.
5. A missing or mismatched selected source/model fails with a concrete path/ID diagnostic. The first unresolved candidate does not require fake evidence or manual edits to generated MDX.
6. Generate twice, then check: no byte drift and no unnecessary writes. Commit generated MDX, preflight and selected preview manifests/assets according to the chosen ownership policy.
7. Built HTML and LLM exports retain exact fact text and citations; publication canaries remain absent. Small-project scan controls are based on its actual declared corpus, not disabled wholesale.
8. The two preview islands hydrate through the chosen supported route seam and have readable static fallbacks. Scope browser verification to these actual integration risks.

The existing CI distinction matters: `build` refreshes generated files; `check:components` after build proves determinism, not committed freshness. A separate clean-checkout diff, including intent-to-add for new generated files and `preflight.json`, catches stale or omitted committed output. Preserve that separation. The current artifact scanner checks generated MDX, built pages, discovery surfaces, client output and an isolated agent-facing export; extract its policy logic while replacing project-specific baselines. [Architecture CI explanation][architecture] [Scanner implementation][scanner]

## Audit limits

This report is based on pinned upstream source reads and three narrow local Node checks. The complete LED test suite, canonical Python validator, full zfb build, browser rendering, preview exporter, KiCad and network retrieval were not run in this audit. Historical pass counts in upstream architecture documents are upstream observations, not tests repeated here. The implementation agent should fetch the full pinned repository and lockfile, preserve applicable repository instructions, then run the relevant real gates while extracting.

[architecture]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/ARCHITECTURE.md
[adoption]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/src/content/docs/how-to/component-docs-adoption.mdx
[adapter]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/core/adapter.ts
[circuit-index]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/adapters/circuit/index.ts
[pipeline]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/core/pipeline.ts
[run]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/cli/run.ts
[paths]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/adapters/circuit/paths.ts
[evidence]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/adapters/circuit/evidence.ts
[view-model]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/core/view-model.ts
[integration]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/adapters/circuit/integration.ts
[publication]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/core/publication.ts
[selection]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/adapters/circuit/selection.ts
[validate]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/adapters/circuit/validate.ts
[read]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/adapters/circuit/read.ts
[mdx]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/core/mdx.ts
[emit]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/core/emit.ts
[references]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/adapters/circuit/references.ts
[models]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/adapters/circuit/model-assets.ts
[footprint-check]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/footprint-previews/check.ts
[scanner]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/cli/scan-artifacts.ts
[package]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/package.json
[shared]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/core/render/shared.ts
[zfb]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/zfb.config.ts
[presentation]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/PRESENTATION-CONTRACT.md
[styles]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/src/styles/global.css
[bindings]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/src/chrome-bindings.tsx
[route]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/pages/docs/[[...slug]].tsx
[model-island]: https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/src/component-model-viewer/package-model-viewer-island.tsx
