# led-ui-cad: UI, browser islands, host glue, package CSS, and CAD previews (footprint SVG and WRL model) in the LED component docs, and how to ship them from @takazudo/zudo-circuit-doc

## Summary
1) UI closure. There are 7 SSR components in doc/component-docs/ui. Four are pure presentation: EvidenceAnchor, EvidenceDetails, EvidenceFact and EvidenceTable. ComponentReferences decodes a hex descriptor (ui/component-references.tsx:16) and renders FootprintPreview and PackageModelViewer. Those two are zfb `<Island when="visible">` wrappers (ui/footprint-preview.tsx:15, ui/package-model-viewer.tsx:12). They reach into host src/ through `../../src/...` imports (footprint-preview.tsx:5, package-model-viewer.tsx:5), which is the main layout coupling. The client side is 2 island roots, FootprintPreviewIsland and PackageModelViewerIsland. Both have `"use client"` and a pinned displayName (footprint-preview-island.tsx:84, package-model-viewer-island.tsx:152). They share PreviewEnlargeDialog, which is also marked "use client" and uses zudo-doc's `use-modal-dialog`, `transitions` (AFTER_NAVIGATE_EVENT = "zfb:after-swap") and `island-types` (ENLARGE_DIALOG_STYLE). The model island lazily imports viewer-runtime.ts (package-model-viewer-island.tsx:66). That runtime imports three@0.185.1 core, `three/addons/controls/OrbitControls.js` and `three/addons/loaders/VRMLLoader.js` (viewer-runtime.ts:1-17).

2) The only non-zld class is the Tailwind utility `z-modal` (preview-enlarge-dialog.tsx:47), and zudo-doc 5.27.0 dist/safelist.css already covers it. The package therefore needs no Tailwind @source or safelist of its own.

3) Island discovery (seed claim partly stale). LED keeps the scaffold's host-owned route pages/docs/[[...slug]].tsx, which is identical to the create-zudo-doc 5.27.0 base template except for a DocHistory patch and two `void`-referenced static island imports (lines 38-45). The seed says the virtual chrome-bindings export alone never makes islands discoverable (research/led-doc-engine.md:136), and LED's comments say the same (chrome-bindings.tsx:13-16, route:41-43). That rationale is stale for zfb 2.18.0 and later: commits 200452e6 and d4a66b52 (first tag v2.18.0) resolve plugin virtual modules in the islands scanner (crates/zfb-islands/src/scanner.rs:1430-1435). The zudo-sg ADR (docs/adr/styleguide-engine.md:76-89) measured a packed host whose island was reachable only through a virtual module, and it hydrated. zudo-doc's guide (custom-components.mdx:72-75, 151-155) still warns conservatively. The plan should therefore keep an explicit static seed import and prove hydration in the packed consumer.

4) Islands inside node_modules are supported. zfb #999 (crates/zfb-islands/tests/npm_dist_islands.rs:1-26) lets the scanner enter a regular npm package through a bare-specifier import from project source and follow relative imports inside it, but never bare imports made from inside the package. Package-internal island edges must be relative, and the host must import the package subpath directly.

5) CSS. global.css lines 30-535 are all component-doc rules, and lines 1-28 are the zudo-doc scaffold. Every custom property they use is defined in @takazudo/zudo-doc/theme.css (verified for all 22 tokens). They should ship as an unlayered package `styles.css` that the host imports after the zudo-doc CSS, which is the zudo-sg precedent (create-zudo-sg templates/default/src/styles/global.css:20-22).

6) Footprint previews. The pipeline renders with a pinned KiCad docker image (config.ts:5-9): digest sha256:e638b79b..., version 9.0.9, platform linux/amd64, network none. Exact-count gates are generate.ts:129 (25), generate.ts:141 (35 records), check.ts:27 (25), references.ts:93 (25), model-assets.ts:37 (25), check-built-component-references.mjs:24/27/34/116/125/126, and tests. None of them allow zero. The manifest's aggregate hash includes repo-root-relative footprintPath strings (references.ts:193, check.ts:54-57). The LED fixture therefore has to preserve the `footprints/kicad/zudo-led-lamp.pretty/...` layout relative to its configured repo root, or the committed manifest goes stale.

7) Two node_modules blockers the seed missed:
- Verified locally on Node v24.13.1: Node refuses `--experimental-strip-types` for any .ts under node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). Every Node-run script (footprint previews, models, checks) must ship as compiled JS.
- LED uses 313 relative `.ts` import specifiers. tsup `bundle:false` does not rewrite them, so the package build must rewrite them to `.js` or use TS `rewriteRelativeImportExtensions`.

8) model-assets.ts:154-161 checks every path segment from the filesystem root for symlinks. On macOS (/tmp and /var are symlinks) or under symlinked Dropbox dirs, a consumer created there fails with PATH_CONTAINMENT.

9) The browser smoke is not Playwright. It is a hand-rolled CDP client over Node's global WebSocket, driving the system Chrome (`CHROME_BIN ?? "google-chrome"`, model-viewer-browser-smoke.mjs:57), and it hardcodes 4 LED record slugs (lines 10-17).

## facts
- LED HEAD is 194d8a297e3545588197342130c3111a66c10973, the same commit the seed pinned. zudo-sg HEAD is b9b36ce (create-zudo-sg v0.1.8). zfb repo HEAD is 741c26db, whose packages/zfb version is 2.20.4; the newest tag is v2.21.0. zudo-doc HEAD is a57c2f705 and packages/zudo-doc is 5.27.0.
- Installed LED doc versions: three 0.185.1, @types/three 0.185.3, preact 10.29.7 (spec ^10.29.1), @takazudo/zfb 2.20.2, @takazudo/zudo-doc 5.27.0, and Node engines >=22 (doc/package.json:241-243, 278-311). There is no Playwright dependency anywhere in doc/package.json.
- three exports `./addons` and `./addons/*`. VRMLLoader.js imports only three core plus the vendored `../libs/chevrotain.module.min.js`, so no extra npm dependency is needed for VRML parsing.
- UI import closure:
- component-references.tsx imports core/reference-descriptor.ts, ui/footprint-preview.tsx and ui/package-model-viewer.tsx.
- footprint-preview.tsx imports `Island` from @takazudo/zfb and src/component-preview/footprint-preview-island.tsx.
- package-model-viewer.tsx imports `Island` and src/component-model-viewer/package-model-viewer-island.tsx.
- footprint-preview-island.tsx imports preact/hooks and ./preview-enlarge-dialog.tsx.
- preview-enlarge-dialog.tsx imports @takazudo/zudo-doc/island-types (ENLARGE_DIALOG_STYLE), @takazudo/zudo-doc/transitions (AFTER_NAVIGATE_EVENT) and @takazudo/zudo-doc/use-modal-dialog.
- package-model-viewer-island.tsx imports preact/hooks, core/model-descriptor.ts, ../component-preview/preview-enlarge-dialog.tsx, ./viewer-state.ts, and dynamically ./viewer-runtime.ts.
- viewer-runtime.ts imports three, three/addons/controls/OrbitControls.js, three/addons/loaders/VRMLLoader.js, core/model-descriptor.ts (type only) and ./viewer-state.ts.
- reference-descriptor.ts imports model-descriptor.ts.
- None of these import node:* modules, which is required because they reach the client bundle.
- zudo-doc 5.27.0 exports ./island-types, ./transitions, ./use-modal-dialog, ./chrome-bindings, ./chrome, ./route-context, ./doc-history and ./routes/index, all as dist JS. AFTER_NAVIGATE_EVENT = "zfb:after-swap" (dist/transitions/page-events.d.ts:18). dist/use-modal-dialog/index.js itself starts with "use client".
- Generated MDX usage across 36 files under src/content/docs/components: <EvidenceAnchor 820, <EvidenceFact 391, <EvidenceTable 38, <EvidenceDetails 35, <ComponentReferences 35, <CategoryNav 1. <PackageModelViewer is never emitted standalone, yet it is still registered in chrome-bindings.tsx:39 and allowed by core/mdx.ts:47.
- Generator allowlist core/mdx.ts:40-48 (ALLOWED_COMPONENT_ATTRIBUTES): EvidenceAnchor[id], EvidenceDetails[label], EvidenceFact[], EvidenceTable[label], ComponentReferences[descriptor], PackageModelViewer[descriptor], CategoryNav[category]. The descriptor value must be hex of at most 8192 chars (mdx.ts:229-231). The mdxExtras registry in src/chrome-bindings.tsx:27-41 must match this allowlist, apart from CategoryNav, which zudo-doc ships globally.
- EvidenceTable labels actually emitted: parts-index (core/render/catalog.ts:112), rules-index (integration.ts:231), evidence-chain (integration.ts:490), calculation-results (conditional, integration.ts:430) and pin-assignments (record.ts:667-669). global.css:467-470 styles `.zld-evidence-table--facts`, which nothing emits any more; facts moved to EvidenceFact per PRESENTATION-CONTRACT.md.
- ComponentReferences is emitted only when a record has a footprint (core/render/record.ts:167-201). External (mounting: external) records render plain paragraphs and no islands (record.ts:167-176, references.ts:69-73).
- Island SSR contract: zfb Island (dist/island.js:1-125) writes `data-zfb-island="<displayName ?? name>"` plus `data-when`. With `ssrFallback` it switches to `data-zfb-island-skip-ssr`. LED does not use ssrFallback, so both islands fully SSR their no-JS markup: `data-footprint-preview-state="no-js"` (footprint-preview-island.tsx:37) and `data-viewer-state="no-js"` (package-model-viewer-island.tsx:99).
- Test hooks shipped in production runtime: `?model-viewer-webgl=fail` (viewer-runtime.ts:76), `?model-viewer-model=fail` (viewer-runtime.ts:92), the `root.dataset.renderCount` diagnostic (viewer-runtime.ts:136) and `root.dataset.viewerDisposed` (viewer-runtime.ts:185). The browser smoke depends on all four.
- Viewer runtime behaviour: render-on-demand via requestAnimationFrame invalidation (viewer-runtime.ts:39-57); fetch with credentials same-origin and cache force-cache (viewer-runtime.ts:141-145); VRMLLoader().parse (viewer-runtime.ts:149); ResizeObserver with a window resize fallback; a MutationObserver on data-theme and class (viewer-runtime.ts:162-163); a full dispose including forceContextLoss (viewer-runtime.ts:171-187).
- Descriptor contract (v1). model-descriptor.ts:15-17 (SAFE_TEXT, SAFE_MODEL_URL `^/assets/component-previews/models/<safe>.wrl$`, HEX); hex-encoded JSON of at most 4096 chars (model-descriptor.ts:27); key set exactly `modelUrl,offset,packageId,packageLabel,rotation,scale,version` (model-descriptor.ts:41); each vector component finite with |v|<=1e6 (model-descriptor.ts:64). reference-descriptor.ts:23-25 allows only the document labels {Datasheet PDF, Specification PDF, Mechanical drawing PDF} and SAFE_FOOTPRINT_ASSET `^/assets/component-previews/footprints/<safe>.svg$`; at most 8192 chars (reference-descriptor.ts:41); keys `document,footprint,modelDescriptor,version`; isSafeHttpUrl avoids the URL constructor because the SSR sandbox lacks it (reference-descriptor.ts:97-104 of the file, the comment near the end).
- The LED route pages/docs/[[...slug]].tsx (76 lines) equals zudo-doc packages/create-zudo-doc/templates/base/pages/docs/[[...slug]].tsx plus 2 blocks: DocHistory and defineChromeBindings imports with `createChrome(routeCtx,{...chromeBindings,...defineChromeBindings({DocHistory})})` (docHistory feature patch), and static island imports with `void` references (lines 38-45). Verified with diff. pages/index.tsx is the scaffold's one-line `export { default } from "@takazudo/zudo-doc/routes/index"`.
- zudo-doc routes plugin (packages/zudo-doc/src/plugins/routes.ts:627-647): `virtual:zudo-doc-chrome-bindings` = `export { chromeBindings } from "<abs path of settings.chromeBindingsModule>"`, otherwise `export const chromeBindings = {}`. The path is project-root-relative; a missing, blank or directory path fails loudly at setup (routes.ts:421-440).
- zfb scanner, node_modules policy (crates/zfb-islands/tests/npm_dist_islands.rs:17-26, issue #999):
- It enters a regular npm package only through a bare import whose importer is outside node_modules.
- It follows package.json `exports` (exact subpath, ".", conditional, ESM preferred).
- Inside the package it follows relative imports only.
- It never follows bare imports made from inside a package.
- Injected-route roots under node_modules count as honorary project source (scanner.rs:518-530).
- Plugin virtual modules resolve in the zfb scanner before node_modules probing (scanner.rs:1430-1435; commits 200452e6 and d4a66b52, both first tagged v2.18.0). zfb build seeds islands from the real project pages/ plus every materialized package-route entrypoint (crates/zfb/src/commands/build.rs:755-761).
- zudo-sg precedent:
- `@takazudo/zudo-sg/islands` is a side-effect module that statically imports every engine island (packages/styleguide/src/islands.ts:19-25), with a d.ts emitted by scripts/emit-islands-dts.mjs.
- The host shim pages/lib/_zudo-sg-islands.ts is `import "@takazudo/zudo-sg/islands";` and pages/index.tsx imports it.
- The ADR (docs/adr/styleguide-engine.md:76-89, 241-252) calls this a harmless no-op on zfb 2.18.0 and later. It says island manifests are site-wide and that the same island reached through two graphs is deduped by path.
- zudo-sg packaging: tsup with `bundle:false` compiles src 1:1 so that per-file "use client" survives (packages/styleguide/tsup.config.ts:3-12); relative imports use `.js`; route entrypoints ship as .tsx in routes-src/ because zfb extracts paths() from source; the package exports `./styles.css` (package-root hand-authored file) and `./safelist.css`; peerDependencies are @takazudo/zfb ^2.20.3, @takazudo/zudo-doc ^5.27.0 and preact ^10.29.8.
- zudo-sg consumer CSS order (create-zudo-sg templates/default/src/styles/global.css:3-22): @layer zd-preflight, zd-flow; tailwind preflight in a layer; tailwind utilities; zudo-doc theme.css; host tokens; zudo-doc safelist, content, features and page-loading; then the engine's `@import "@takazudo/zudo-sg/styles.css"` unlayered.
- All 22 custom properties in global.css:30-535 are defined in @takazudo/zudo-doc dist/theme.css: --spacing-hsp-sm, --spacing-vsp-2xs, --color-muted, --spacing-vsp-lg, --spacing-vsp-xs, --spacing-hsp-lg, --color-surface, --spacing-vsp-sm, --color-fg, --text-caption, --spacing-hsp-xs, --color-accent, --color-bg, --spacing-image-overlay-inset, --z-index-local-1, --z-index-local-2, --color-image-overlay-fg, --color-image-overlay-bg, --default-transition-duration, --spacing-icon-sm, --spacing-icon-lg, --color-overlay. The `.zd-content` class used at 516-535 comes from zudo-doc content.css. `z-modal` is in zudo-doc dist/safelist.css.
- global.css line map:
- 1-28: zudo-doc scaffold (layers, tailwind, zudo-doc CSS imports, @source, @theme); stays in the host.
- 30-37: .zld-evidence-anchor.
- 39-50: .zld-evidence-fact.
- 52-66: .zld-evidence-details.
- 68-96: .zld-evidence-table container and focus.
- 98-238: .zld-component-references layout, document row, previews grid, footprint frame and card. `container-type` is declared separately at 137-139 with the @container query at 141-146 (duplicate selector block to merge).
- 240-260: .zld-model-viewer.
- 262-305: .zld-preview-enlarge-button, focus and hover.
- 297-300: no-js and not-ready hide rules.
- 307-324: canvas, status and notice; state-based viewport hiding.
- 326-441: .zld-preview-dialog including html:has(.zld-preview-dialog:modal) scroll lock at 341-343 and the footprint and model variants.
- 443-454: prefers-reduced-motion.
- 456-488: evidence-table min-widths per label.
- 490-535: long-identifier wrapping scoped by `.zd-content:has(.zld-evidence-anchor)`.
- Footprint preview config (footprint-previews/config.ts): KICAD_IMAGE = `kicad/kicad@sha256:e638b79b0321f29395a5b783e94bb9f3c73303e8da15da27b8f5cb4b67a37729` (:5); KICAD_VERSION = "9.0.9" (:6); KICAD_PLATFORM = "linux/amd64" (:9); EXPORT_LAYERS = F.Cu, F.Silkscreen, F.Fabrication, F.Courtyard (:10); EXPORT_THEME = "KiCad Default" (:11); EXPORT_OPTIONS = ["--black-and-white"] (:12); PREVIEW_FORMAT_VERSION = 1 (:13); PREVIEW_ROOT = DOC_ROOT/public/assets/component-previews/footprints (:15).
- Footprint generation flow (generate.ts):
- Parity assert (:31); selections; assertSelection (:33).
- mkdtemp zld-footprint-previews-* holding preview.pretty and export (:34-36).
- Hash each canonical .kicad_mod, then suppressFootprintText into the temporary library (:41-46).
- `docker run --rm --platform linux/amd64 --network none --mount type=bind,src=<tmp>,dst=/work <image> kicad-cli --version` must equal 9.0.9 (:48-51, :113-126).
- `kicad-cli fp export svg --layers ... --theme ... --black-and-white --output /work/export /work/preview.pretty` (:52-59).
- Output inventory must exactly equal the selection (:61-65).
- normalizeSvg (:71); re-hash the canonical inputs to prove they are unchanged (:94-99).
- `rm -rf PREVIEW_ROOT` and rewrite (:103-106).
- Footprint manifest schema (manifest.ts:1-30): {formatVersion: 1, renderer: {image, version}, export: {layers, theme, options, textPolicy: "suppress-all-fp-text-in-temporary-library", postprocessor: "repository-svg-normalizer-v1"}, canonicalInputSha256, generatedOutputSha256, packages: [{packageId, footprintName, footprintPath (repo-root-relative), recordIds, assetPath "/assets/component-previews/footprints/<name>.svg", canonicalInputSha256, generatedOutputSha256}]}. aggregateHash = sha256 of concat(`${path}\0${sha256}\n`) (hash.ts:7-9). The package order is selection order, and check.ts:39-44 compares it index by index.
- Footprint check (check.ts), Docker-free:
- Parity (:20); PREVIEW_ROOT must be a real non-symlink directory (:23-24).
- Metadata equals config (:61-68); exactly 25 packages (:27).
- Exact file set of manifest.json plus <name>.svg, with no extras or missing files (:28-31); regular files only (:32-35).
- Per-package selection equality (:42-44); assetPath (:45-46); input hash (:47-48); validateSvg (:50).
- Rejects visible text via `REF**|%R|<text|class="stroked-text"` (:51); output hash (:52-53); aggregate hashes (:57-58).
- SVG safety (svg.ts):
- At most 2 MiB (:41).
- No DOCTYPE, <?xml, comments, CDATA or & (:42).
- Element allowlist svg, g, path, rect, circle, ellipse, line, polyline, polygon (:1); attribute allowlist (:2-7).
- No on*, href or xlink:href (:56, :8); no javascript:, data:, http(s):, file: or url( values (:9, :67).
- transform must be identity `translate(0 0) scale(1 1)` (:84).
- Path commands M, L, A and Z only (:101).
- Geometry contained in the viewBox with 0.1 epsilon (:153); viewBox width and height in (0, 1000] (:165).
- At least one visible geometry (:76); no text nodes (:77).
- normalizeSvg rewrites the root to viewBox with toFixed(4), width and height 100%, preserveAspectRatio xMidYMid meet (:31), and strips title and desc (:27-28).
- Parity (parity.ts:11-32): the sorted `.kicad_mod` name lists of the master root (REPO/footprints/kicad) and the resolution root (REPO/footprints/kicad/zudo-led-lamp.pretty) must be identical, every file byte-identical, and both roots must be real directories that are not symlinks (:35-38). It covers all 31 footprints, not just the 25 selected. Inventory: 31 .kicad_mod in each location, 27 .step and 27 .wrl in zudo-led-lamp.3dshapes, 25 SVGs plus manifest.json in public footprints, 25 WRL in public models (about 4.0 MB; largest 1,154,580 B TSSOP-20...wrl).
- Model reference validation (adapters/circuit/references.ts):
- REFERENCE_LIMITS: footprint 512 KiB, model 2 MiB, aggregate 8 MiB (:16-20).
- SAFE_BASENAME (:47).
- MODEL_PREFIX = "${KIPRJMOD}/../../footprints/kicad/zudo-led-lamp.3dshapes/" (:48).
- Exactly one `(model "...")` per footprint (:157); the locator must start with MODEL_PREFIX (:165) and end in .wrl (:173).
- WRL size check (:182); same-basename .step must exist (:185-187); validateVrml (:188).
- offset, rotate and scale xyz parsed from the footprint (:195-197, :256-266).
- containedFile uses realpath containment plus lstat regular non-symlink (:268-291).
- Exactly 25 packages (:93).
- VRML safety (references.ts:202-229):
- Must match `#VRML V2.0 utf8`.
- No `../` or `..\` after comment stripping.
- Rejects https?:, file:, javascript:, data:, `url `, and Inline, Script, EXTERNPROTO, PROTO, ImageTexture, MovieTexture, AudioClip, Anchor, WWWInline, LoadSensor, ROUTE, IMPORT, EXPORT, USE and IS.
- Every `Name {` node must be one of Appearance, Coordinate, IndexedFaceSet, Material, Shape.
- Model publication (adapters/circuit/model-assets.ts):
- MODEL_PUBLIC_ROOT = DOC_ROOT/public/assets/component-previews/models (:13-19).
- buildModelAssetPlan requires exactly 25 packages (:37) and unique WRL basenames (:48).
- syncModelAssets only writes .wrl files (:81) and compares bytes: unchanged or written; in dry-run it records drift "missing:" or "changed:" (:95-104).
- An unknown extra file gives drift "extra:" in dry-run and a GENERATED_DRIFT failure otherwise, deliberately refusing to delete (:107-124). The `removed` array is always empty.
- assertSafeOutputRoot lstat-checks every segment from the filesystem root (:154-161).
- CLI: cli/models.ts runs `--check` as a dry-run and fails on any drift (:6-15).
- STEP is never published; check-built-component-references.mjs:127 enforces that.
- check-built-component-references.mjs (Node only, cwd-relative DIST = resolve("dist") :7):
- Exactly 35 record route dirs (:24); manifest 25 packages (:27) with 25 unique names (:34).
- Per record: exactly 1 .zld-component-references section (:41), placed before zld-evidence-table (:44-47).
- One allowed PDF label (:49-52); one http(s) document link (:53-56); one footprint img whose src is a regular dist file (:58-63).
- `data-footprint-preview-state=no-js` (:64); `data-zfb-island=FootprintPreviewIsland` (:65); an `>Open SVG</a>` link (:66-69).
- One data-model-url .wrl that is a regular file (:71-77); `data-viewer-state=no-js` (:79); instance inline (:80); `data-zfb-island=PackageModelViewerIsland` (:81).
- Exactly 2 enlarge buttons, footprint and model (:83-92); exactly 2 closed dialogs with media-specific aria-label and no aria-labelledby (:94-106); the static viewer explanation text (:107-111); #sources (:112).
- Referenced SVG set equals the manifest (:115); 25 WRLs (:116); dist/assets/component-previews file set exact (:118-124); 25 .svg (:125); 25 .wrl (:126); no .step or .stp (:127).
- The catalog at dist/docs/components/catalog/index.html has no viewer or dialog markers or <canvas (:129-134).
- model-viewer-browser-smoke.mjs uses no Playwright. It combines a node:http static server over dist (:35-54), spawned Chrome from `process.env.CHROME_BIN ?? "google-chrome"` with --headless=new --no-sandbox --enable-unsafe-swiftshader --remote-debugging-port=0 (:57-66), and a hand-written CDP client over the global WebSocket (:927-955, Node 22 or later). CI runs it on ubuntu-latest with no browser install step (pr-checks.yml:170-172, main-deploy.yml:134).
- Browser smoke coverage:
- Search index and llms-full.txt contain identities and IDs for the representatives, with search body at most 300 chars (:234-259).
- A matrix of 4 viewports [1600, 1280, 1024, 390] x light/dark x 4 representatives; light and dark computed colours must differ (:81-98).
- Native zudo-doc shell and TOC breakpoints, 1024 sidebar and 1280 TOC (:459-504).
- Dialog geometry at 390x844 DPR 2 (:100-104); footprint and model dialogs and viewer interactions (:106-112).
- Render-on-demand idle (:114-120); reduced-motion durations at most 0.001 s (:122-130).
- SPA navigation to /docs/components/catalog disposes both inline and dialog viewers and detaches their canvases, and history.back yields exactly one fresh viewer and canvas (:132-151).
- Forced model failure leads to the error state (:153-158); forced WebGL failure leads to the unavailable state (:160-165).
- Script execution disabled keeps the no-JS state and static content (:167-189).
- The catalog loads no viewer or model resource (:191-207).
- Browser smoke LED-only constants: RECORD "/docs/components/records/al8860mp-13/" (:10); AWAY "/docs/components/catalog" (:11); REPRESENTATIVES c22807, al8860mp-13, type-c-31-m-17 and c529334 with identities and an availability of "SOURCE UNAVAILABLE" (:12-17); a stat on the al8860mp-13 index.html (:34). It reads src/content/docs/components/records/<slug>/index.mdx from cwd (:246).
- check-mermaid.mjs throws when zero mermaid diagrams exist under src/content/docs (:73-74), and it resolves dompurify through mermaid's require.
- check-zfb-link-warnings.sh hardcodes GENERATED_TREE='/src/content/docs/components/' (:62). It accepts only same-page #fragment warnings in that tree plus 3 exact doc-history-server stdout shapes (:94-102), and fails on any other `zfb warn:` line.
- scan-doc-skill.sh runs `$DOC_ROOT/scripts/setup-doc-skill.sh` with HOME set to a sandbox, verifies the real ~/.claude/skills and ~/.codex/skills listings are unchanged (:24-67), then runs cli/scan-artifacts.ts --agent-skill on the copied content (:77-78).
- CI order in pr-checks.yml:117-202: check, check:models, test:components, check:footprint-previews, build (log to file), check:images, check:anchors, check:built-component-references, test:model-viewer:browser, then check-zfb-link-warnings.sh on the build log. `generate:footprint-previews` (Docker) is never run in CI; only the Docker-free check is. `pnpm build` runs generate:enclosure-viewer, generate:models, generate:components and zfb build (doc/package.json:247).
- readEvidenceIndex (adapters/circuit/index.ts:92-101) does not shell out to Python, so check:footprint-previews and check:models are Node-only (the Python validator lives in adapters/circuit/validate.ts).
- Verified locally on Node v24.13.1: `node --experimental-strip-types` on a .ts file under node_modules, or importing one from the project, fails with ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING. The scratch repro is explore/strip/. LED has 313 relative imports ending in `.ts` and 6 ending in `.tsx` across component-docs, src/component-preview, src/component-model-viewer and chrome-bindings; tsconfig allowImportingTsExtensions comes from zudo-doc tsconfig.base.json.
- Committed LED preview manifest: canonicalInputSha256 5d2061d4b27077dfca5ecd02a7a2579a3607fe3d9c581a5ca46fb207811e0824 and generatedOutputSha256 8039b0ea3ee4c356e152b998bef95f9824fcc1a641d4bc6718694bec50ef1177. The first package is SW-TH_SS-12D01-G020, with footprintPath `footprints/kicad/zudo-led-lamp.pretty/SW-TH_SS-12D01-G020.kicad_mod`.
- doc/enclosure-viewer/ (build.mjs, viewer.js and others) is an independent LED-only viewer that `pnpm build` runs. It has no zld- or component-previews references and is not part of the extraction.

## risks
- The seed's claim that the virtual chrome-bindings export cannot make islands discoverable (research/led-doc-engine.md:136, design/02:97) conflicts with zfb 2.18.0 or later: scanner.rs:1430-1435 resolves virtual modules, and the zudo-sg ADR measured it on a packed host (styleguide-engine.md:76-89). zudo-doc's own guide (custom-components.mdx:72-75) still says it cannot. Neither assumption is proven for this package. Keep an explicit static seed (`import "@takazudo/zudo-circuit-doc/islands"` from a host pages/ file) and assert hydration in the packed consumer: `data-zfb-island` markers in HTML, islands.js manifest entries, and viewer state reaching `ready` in a browser.
- Node refuses type stripping under node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). Every LED script run as `node --experimental-strip-types component-docs/...ts` (generate:components, check:components, models, footprint-previews, scan-artifacts, tests) breaks if shipped as .ts inside the package. The package must ship compiled JS for Node entrypoints and for island and UI modules.
- The 313 relative `.ts` import specifiers will not resolve after a tsup `bundle:false` compile, because tsup does not rewrite extensions. This includes the dynamic `import("./viewer-runtime.ts")` at package-model-viewer-island.tsx:66. The fix is either a source-wide rewrite to `.js` (zudo-sg convention) or tsc with rewriteRelativeImportExtensions.
- The per-file "use client" directive must survive the package build. Bundling (bundle:true) would strip it from inner modules and the islands would never register (zudo-sg tsup.config.ts:4-6).
- Package-internal island edges must be relative. A self-referencing bare import (for example `@takazudo/zudo-circuit-doc/islands/x` imported from inside the package) is never followed by the scanner (npm_dist_islands.rs:25-26).
- preact, @takazudo/zfb and @takazudo/zudo-doc must be peerDependencies. A duplicate preact breaks hooks, and a duplicate zfb breaks Island markers. three should be a direct dependency, pinned to 0.185.1 to match the LED fixture bytes and behaviour, so the island bundle resolves it from the package's own node_modules under pnpm strict layout.
- model-assets.ts:154-161 (assertSafeOutputRoot) lstat-checks every path segment from `/`. On macOS, /tmp to /private/tmp and /var to /private/var are symlinks, and some users keep projects under symlinked Dropbox paths. A packed consumer created in os.tmpdir() on macOS, or any project behind a symlinked ancestor, fails generate:models with PATH_CONTAINMENT. Scope the walk to projectRoot to target, as emit.ts assertPathNotSymlinked already does.
- Asset URLs are hardcoded as root-absolute `/assets/component-previews/...` in descriptor regexes (model-descriptor.ts:16, reference-descriptor.ts:3, 25), check.ts:45, generate.ts:75 and check-built-component-references.mjs:30, 61, 75. A generated project that sets a zudo-doc `base` other than "/" gets broken preview links, and changing the regexes changes the v1 descriptor contract. Either require base "/" in v1, or add a base-aware URL at render time outside the descriptor.
- Hash reproducibility for fixtures/led: manifest footprintPath and the aggregate canonical hash embed repo-root-relative paths (references.ts:193, check.ts:54-57). Unless the fixture's configured footprint path base reproduces `footprints/kicad/zudo-led-lamp.pretty/...`, check:footprint-previews reports a stale aggregate hash and the committed LED manifest cannot serve as a byte-identical regression fixture.
- generate.ts:103 runs `rm -rf PREVIEW_ROOT`. Once PREVIEW_ROOT becomes config-derived, a misconfigured path (for example `public/`) would wipe user files. Guard it with an ownership check: the directory must contain only manifest.json and SVGs, or must not exist.
- Zero-state failures in the current code:
- check.ts:27 and generate.ts:129/141 require 25 and 35; check.ts:23 needs PREVIEW_ROOT to exist; parity.ts:35-38 needs both footprint roots to exist.
- references.ts:93 and model-assets.ts:37 require 25.
- check-built-component-references.mjs:20 readdir of the records dir throws ENOENT, and the counts at :24/:27/:116/:125/:126 are fixed.
- check-mermaid.mjs:73 throws on zero diagrams.
- The browser smoke needs specific LED slugs.
All of these must separate 'no CAD capability configured or zero selected' (pass, no Docker) from 'declared file missing or malformed' (fail).
- Island hydration after client navigation depends on zudo-doc and zfb SPA swap semantics (dynamicPageTransition: true in zfb.config.ts:99) and on dispose-on-unmount. The LED smoke proves it only for its own route (smoke :132-151). Re-prove it in the packed consumer; the island modules live in node_modules there, and the islands.js chunk and three chunk URLs differ.
- The browser smoke's native-shell assertions are coupled to zudo-doc 5.27 DOM and breakpoints: header[data-header], nav[data-zd-toc], [data-zd-mobile-toc], #desktop-sidebar, [data-zd-mobile-sidebar], the 'Open sidebar' aria-label, 1024 and 1280 breakpoints (smoke :459-504). They also require llmsTxt: true and a search index in dist (:234-236). These break on zudo-doc upgrades or config differences in generated projects.
- The browser smoke needs a system Chrome (CHROME_BIN or google-chrome), with --no-sandbox and swiftshader WebGL. That is present on GitHub ubuntu-latest but not on a typical Mac or WSL dev box. There is no Playwright fallback, so it must be optional or skippable locally with a clear message and deferred to CI.
- The KiCad image digest publishes only linux/amd64 (config.ts:7-9). ARM hosts rely on emulation, which the code comment claims was verified byte-identical. Preview generation needs Docker with bind mounts from os.tmpdir(), which fails where Docker cannot mount the tmpdir (rootless Docker, restricted Docker Desktop file sharing). A normal build must not need it; today it does not.
- footprint-previews/check.ts compares manifest packages by index against selection order (:39-44). Any change in selection iteration order (for example the reference contract iterating recordIds differently after extraction) flags every package as stale even though the bytes are the same.
- PreviewEnlargeDialog carries its own "use client" (preview-enlarge-dialog.tsx:1) although it is never an Island root. It may register an extra island manifest entry; this is harmless, but marker dedupe is described upstream as fragile (zudo-doc issue #2718, custom-components.mdx:153-155).
- Stale code and comments to fix during extraction:
- chrome-bindings.tsx:13-16 and route:41-43 give a scanner rationale that predates zfb 2.18.
- `.zld-evidence-table--facts` (global.css:467-470) is no longer emitted.
- The duplicate `.zld-component-references` block (global.css:100-102 and 137-139) should be merged.
- PackageModelViewer is registered in mdxExtras (chrome-bindings.tsx:39) but never emitted standalone. Keep it only if the MDX allowlist keeps it.

## openQuestions
- Should v1 formally require zudo-doc `base: "/"`? The descriptor regexes hard-code root-absolute /assets/component-previews/, so any other base breaks previews unless the v1 descriptor contract changes.
- What is the fixture layout for fixtures/led: repo root = fixtures/led with the docs project nested (for example fixtures/led/doc), or a flattened layout? Committed manifest hashes stay valid only if footprintPath resolves to `footprints/kicad/zudo-led-lamp.pretty/<name>.kicad_mod` relative to the configured footprintPathBase.
- Browser smoke tooling: keep the dependency-free CDP harness with system Chrome (the LED precedent), or adopt Playwright (zudo-sg's ADR used Playwright for manual verification)? Where does it run for the packed consumer: CI only, or locally behind heavy-guard?
- Does the circuit package inject its own routes (the zudo-sg style routes-src plus withZudoCircuitDoc), or keep generated MDX under the host's zudo-doc docs route as LED does? The findings assume the latter; no custom routes are needed.
- Should the unused `PackageModelViewer` MDX binding and allowlist entry stay (API surface), given the generator never emits it standalone?
- Do the test-only runtime hooks (`?model-viewer-webgl=fail`, `?model-viewer-model=fail`, dataset.renderCount) stay in the shipped runtime, or move behind a build flag? U8 depends on them.
- Should the islands seed be imported from the docs route (LED precedent), from pages/index.tsx (zudo-sg precedent), or from both? The manifest is site-wide per the zudo-sg ADR, but the docs route is where the islands render.

## dependencies
- preact ^10.29 (peer; LED 10.29.7)
- @takazudo/zfb >=2.18.0 (peer, for virtual-module island scanning and node_modules island support; LED 2.20.2, zudo-sg template 2.20.3, latest tag v2.21.0). Provides `Island`.
- @takazudo/zudo-doc ^5.27.0 (peer): ./chrome-bindings, ./use-modal-dialog, ./transitions, ./island-types, theme.css tokens, safelist z-modal, .zd-content
- three 0.185.1 (direct dependency of the runtime package): core, addons/controls/OrbitControls.js, addons/loaders/VRMLLoader.js (vendored chevrotain)
- @types/three 0.185.3 (dev)
- tsup ^8.5 and typescript ^5.9 (build; zudo-sg precedent)
- Docker plus image kicad/kicad@sha256:e638b79b0321f29395a5b783e94bb9f3c73303e8da15da27b8f5cb4b67a37729 (KiCad 9.0.9, linux/amd64). Needed only for footprint preview generation.
- System Google Chrome/Chromium (CHROME_BIN), for the browser smoke only; no Playwright
- Node >=22 (global WebSocket for CDP; engines field)
- mermaid 11.15.0 plus dompurify (only if check-mermaid is carried)

## couplings
- [component-docs/ui/footprint-preview.tsx:5, ui/package-model-viewer.tsx:5, src/component-model-viewer/package-model-viewer-island.tsx:8, viewer-runtime.ts:19] Cross-tree relative imports between doc/component-docs and doc/src => Co-locate them in packages/circuit-doc/src (ui/, islands/, core/) with package-relative .js imports
- [doc/pages/docs/[[...slug]].tsx:38-45] Host route statically imports the island modules from host src/ so the scanner can reach them => Replace with a host `pages/lib/_circuit-doc-islands.ts` containing `import "@takazudo/zudo-circuit-doc/islands"`, imported by the docs route and any locale route
- [doc/src/chrome-bindings.tsx:27-41 and core/mdx.ts:40-48] mdxExtras names must equal the generator's ALLOWED_COMPONENT_ATTRIBUTES minus CategoryNav => The package exports circuitDocMdxExtras next to the allowlist and tests that they match; the host spreads the exported object
- [doc/zfb.config.ts:99,106,113,127-134,188-203] dynamicPageTransition, docHistoryExclude components/**, chromeBindingsModule, defaultLocaleOnlyPrefixes /docs/components/, headerNav Components => Emit these from the initializer template (or a helper such as withCircuitDoc(zudoDoc(...)) that appends them)
- [core/model-descriptor.ts:1,16; core/reference-descriptor.ts:3,25; footprint-previews/check.ts:45; generate.ts:75; check-built-component-references.mjs:30,61,75] Root-absolute asset URL base /assets/component-previews/{footprints,models}/ => Keep as the v1 contract and require zudo-doc base '/', or introduce a base-aware render layer outside the descriptor; the publicAssetRoot must map to public/assets/component-previews
- [adapters/circuit/paths.ts:14-20,63-65; footprint-previews/config.ts:15-16; model-assets.ts:13-19] DOC_ROOT and REPO_ROOT derived from import.meta.url; footprint, model and public roots derived from them => Resolve from circuit.config.ts: projectRoot, repoRoot or footprintPathBase, cad.masterRoot, cad.resolutionRoot, cad.modelRoot, publicAssetRoot
- [adapters/circuit/references.ts:48] MODEL_PREFIX "${KIPRJMOD}/../../footprints/kicad/zudo-led-lamp.3dshapes/" (library name and board depth) => Config cad.modelLocatorPrefix (derived from the library name and board depth)
- [references.ts:93; model-assets.ts:37; footprint-previews/generate.ts:129,141,146; check.ts:27,76; check-built-component-references.mjs:24,27,34,116,125,126,136; tests footprint-previews.test.ts:64-67, references.test.ts:26-89, model-viewer.test.ts:49-55] Exact counts 25 packages and 35 records => Replace with the project selection lock (expected packages and records), allowing 0; LED values move to fixtures/led
- [footprint-previews/check.ts:23-24; parity.ts:35-38; check-built-component-references.mjs:20,118] Required directories that are missing in an empty project => Treat 'not configured or zero selected' as pass; still fail when a configured root is missing, symlinked or malformed
- [model-assets.ts:154-161] Symlink walk from the filesystem root => Walk only from projectRoot to outputRoot (reuse emit.ts assertPathNotSymlinked)
- [footprint-previews/generate.ts:103] Unconditional rm -rf of PREVIEW_ROOT => Ownership guard before deleting a config-derived path
- [model-viewer-browser-smoke.mjs:10-17,34,246] LED record slugs, identities and MDX paths => Take the representatives from config or fixture; skip or adapt in the zero state
- [model-viewer-browser-smoke.mjs:57; CI pr-checks.yml:170-172] System Chrome dependency (CHROME_BIN or google-chrome) => Document it; skip locally with a message when absent; CI keeps ubuntu-latest's Chrome
- [model-viewer-browser-smoke.mjs:234-259,459-504] Requires llms-full.txt and search-index.json, and zudo-doc 5.27 DOM selectors and breakpoints => Make them flags and gate on the zudo-doc version; the generated config must enable llmsTxt if they are kept
- [check-mermaid.mjs:73-74] Fails when there are zero mermaid diagrams => Zero diagrams must pass in generated projects (or keep this LED-only)
- [check-zfb-link-warnings.sh:62,94-102] Generated tree path and doc-history message shapes => Parameterize the generated route prefix; keep the fail-on-unknown-shape policy
- [scan-doc-skill.sh:22,48] Depends on the host doc/scripts/setup-doc-skill.sh => Ship it only if the initializer ships setup-doc-skill; otherwise leave it LED-only
- [All Node-run .ts entrypoints (doc/package.json:255-267)] `node --experimental-strip-types <file>.ts` => Package CLIs must run compiled dist JS; Node rejects stripping under node_modules
- [313 relative `.ts` import specifiers across component-docs and src islands] allowImportingTsExtensions-style imports => Rewrite to .js or use rewriteRelativeImportExtensions during the package build
- [doc/src/styles/global.css:30-535] Component-doc CSS lives in the host entry => Move it to the package styles.css; the host keeps lines 1-28 plus one @import after the zudo-doc features.css

## extractionUnits
- **U1 descriptors (isomorphic core)** (size: S (~200 LOC); dependsOn: ): packages/circuit-doc/src/core/model-descriptor.ts and reference-descriptor.ts, copied unchanged in behaviour (v1 contract: key sets, regexes, hex limits 4096 and 8192, the /assets/component-previews/ bases). Relative imports use .js. No node:* imports, because they are bundled into the island client chunk. Exports: `./descriptors` (encode, decode, create, footprintAssetUrl, MODEL_ASSET_BASE, FOOTPRINT_ASSET_BASE). -- Carry reference-descriptor.test.ts and the descriptor half of model-viewer.test.ts as generic tests.
- **U2 SSR MDX components plus mdxExtras export** (size: S (~250 LOC); dependsOn: U1, U3): src/ui/{evidence-anchor,evidence-details,evidence-fact,evidence-table,component-references,footprint-preview,package-model-viewer}.tsx. footprint-preview and package-model-viewer import the islands through package-relative paths (../islands/*.js). New `src/mdx-extras.ts` exports `circuitDocMdxExtras = { EvidenceAnchor, EvidenceDetails, EvidenceFact, EvidenceTable, ComponentReferences, PackageModelViewer }`, plus a unit test that its keys equal ALLOWED_COMPONENT_ATTRIBUTES minus CategoryNav. package.json exports `./ui` and `./mdx-extras`. -- 
- **U3 client islands plus island seed subpath** (size: M (~580 LOC); dependsOn: U1): src/islands/{footprint-preview-island.tsx, preview-enlarge-dialog.tsx, package-model-viewer-island.tsx, viewer-runtime.ts, viewer-state.ts}. Keep the top-of-file "use client" and the displayName pins FootprintPreviewIsland and PackageModelViewerIsland. The dynamic import becomes `import("./viewer-runtime.js")`. Add `src/islands.ts`, a side-effect module that statically imports both island roots with relative paths (zudo-sg islands.ts pattern), plus an emitted `dist/islands.d.ts` with `export {}`. Export `./islands`. dependencies: three 0.185.1. devDependencies: @types/three 0.185.3. peerDependencies: preact ^10.29, @takazudo/zfb >=2.18 (virtual-module scanning; LED pins 2.20.2), @takazudo/zudo-doc ^5.27.0 (use-modal-dialog, transitions, island-types). -- Keep the ?model-viewer-*=fail hooks and dataset.renderCount/viewerDisposed, because U8 needs them.
- **U4 package stylesheet** (size: S (~505 lines); dependsOn: ): packages/circuit-doc/styles.css at the package root (the zudo-sg precedent), made from LED global.css:30-535 verbatim. Merge the duplicated `.zld-component-references` blocks (100-102 and 137-139). Optionally drop the unused `.zld-evidence-table--facts` selector (467-470). Uses only zudo-doc theme.css tokens and `.zd-content`. The file stays unlayered. Export `./styles.css`. No safelist is needed: the only utility class (`z-modal`) is in zudo-doc's safelist. The host imports it after the zudo-doc CSS: `@import "@takazudo/zudo-circuit-doc/styles.css";`. -- Keep the zld- prefix (it is part of the rendered contract checked by U7 and U8), or rename it everywhere at once.
- **U5 footprint preview pipeline (Node CLI, compiled JS)** (size: L (~570 LOC plus config plumbing); dependsOn: U6): src/footprint-previews/{config,footprint,generate,check,hash,manifest,parity,selection,svg}.ts compiled to dist and exposed as CLI subcommands (for example `zudo-circuit-doc footprints generate|check --config circuit.config.ts`).

Config to thread through: projectRoot; footprintPathBase (repo root for manifest-relative paths); masterRoot; resolutionRoot (.pretty); previewRoot (default public/assets/component-previews/footprints); renderer {image digest, version, platform, layers, theme, options}; expected lock {packages, records} coming from the project selection instead of the literals 25 and 35.

Zero-selection semantics:
- No cad block, or zero selected packages: check passes without Docker. Either previewRoot is absent, or it holds a manifest with `packages: []` and the aggregate hashes of the empty list.
- generate with zero selected writes the empty manifest (or removes the owned dir) and never runs Docker.
- A configured root that is missing, symlinked or malformed still fails.

Guard the rm -rf so it only removes a dir containing manifest.json and SVGs. -- The LED fixture must reproduce footprintPath strings `footprints/kicad/zudo-led-lamp.pretty/<name>.kicad_mod` so the committed manifest hashes (aggregate 5d2061d4.../8039b0ea...) still verify.
- **U6 model reference validation plus WRL publication** (size: M (~480 LOC); dependsOn: ): Parameterize references.ts readPackage, validateVrml, containedFile and REFERENCE_LIMITS, and model-assets.ts:
- modelRoot and modelLocatorPrefix (replacing MODEL_PREFIX literal :48) come from config.
- The 25 literals (:93, model-assets :37) become the project lock.
- assertSafeOutputRoot walks from projectRoot only, not `/`.

Keep unchanged: STEP+WRL same-basename pair; VRML allowlist and denylist; 512K/2M/8M limits; refuse-to-delete unknown files; dry-run drift categories missing/changed/extra; only .wrl published.

Zero selected: the plan is empty and the check passes whether or not the public models dir exists. An extra file in an existing dir still fails. -- 
- **U7 built-output reference checker** (size: S (~200 LOC); dependsOn: U2, U3, U5, U6): Port check-built-component-references.mjs as a package CLI (`check built`) that takes distRoot, recordsRoute (docs/components/records), catalogRoute and expected counts from the project lock. Keep every per-record structural assertion (:41-112) and the exact asset-set, no-STEP and viewer-free-catalog checks (:115-134). Zero records: an absent records dir means 0, an absent preview root is allowed only when 0 packages are expected, and the catalog check still runs if the catalog exists. -- 
- **U8 browser smoke (CDP plus system Chrome)** (size: L (~1000 LOC); dependsOn: U3, U4, U7): Port model-viewer-browser-smoke.mjs as an opt-in package CLI (`check browser`). Representatives come from a fixture or config list of {kind, path, slug, identity, availability?}, with RECORD taken as the first entry that has a model and AWAY taken as the catalog route. If CHROME_BIN or google-chrome is missing, skip with a distinct exit or message rather than fail. Keep the CDP-over-global-WebSocket approach (no Playwright dependency) or add Playwright as an explicit devDependency; that is a planner decision. Keep the search and llms checks behind a flag, since they need llmsTxt: true. The native-shell assertions are zudo-doc-version-coupled; gate them on the zudo-doc version or make them optional. The LED representatives move to fixtures/led. -- 
- **U9 host glue templates (create-zudo-circuit-doc)** (size: S; dependsOn: U2, U3, U4): Minimal generated files:

(a) `zfb.config.ts`: zudoDoc({ ..., dynamicPageTransition: true, llmsTxt: true (if U8 search checks are kept), chromeBindingsModule: "./src/chrome-bindings.tsx", docHistoryExclude: ["components","components/**"] when docHistory is on, defaultLocaleOnlyPrefixes: ["/docs/components/"], headerNav entry for /docs/components }). base must stay "/".

(b) `src/chrome-bindings.tsx`:
```
import { defineChromeBindings } from "@takazudo/zudo-doc/chrome-bindings";
import { circuitDocMdxExtras } from "@takazudo/zudo-circuit-doc/mdx-extras";
export const chromeBindings = defineChromeBindings({ mdxExtras: { ...circuitDocMdxExtras } });
```

(c) `pages/docs/[[...slug]].tsx`: the create-zudo-doc 5.27.0 base stub, byte for byte, plus the DocHistory merge if docHistory is on, plus one line `import "../lib/_circuit-doc-islands";`.

(d) `pages/lib/_circuit-doc-islands.ts`: `import "@takazudo/zudo-circuit-doc/islands";`. This is the zudo-sg precedent: a harmless no-op on zfb>=2.18, and the guaranteed path on anything older or on a scanner regression. Mirror it in the locale route if i18n is used.

(e) `pages/index.tsx`: `export { default } from "@takazudo/zudo-doc/routes/index";`

(f) `src/styles/global.css`: the LED lines 1-28 scaffold, then `@import "@takazudo/zudo-circuit-doc/styles.css";` after `@takazudo/zudo-doc/features.css`.

(g) `tsconfig.json`: extends `@takazudo/zudo-doc/tsconfig.base.json`, includes src, pages, zfb.config.ts and circuit.config.ts.

(h) `package.json` deps: @takazudo/zudo-circuit-doc, @takazudo/zfb, zfb-md-wasm, zfb-runtime, zudo-doc, preact, preact-render-to-string, tailwindcss and the other zudo-doc peers. three comes transitively from the circuit package. -- The islands never have to live in host src/, and the LED `void X` trick is unnecessary once the seed module exists.
- **U10 packed-consumer verification** (size: M; dependsOn: U5, U6, U7, U8, U9, U11): Pack both tarballs (pnpm pack) and scaffold a project outside the monorepo. On macOS, use a realpath'd dir because of the U6 symlink walk until it is fixed. Install from the tarballs. Run `zfb build` for both the empty state and the LED fixture copy, then U7. Assert that dist HTML contains `data-zfb-island="FootprintPreviewIsland"` and `data-zfb-island="PackageModelViewerIsland"` and that the islands bundle manifest contains both. Run U8 against the fixture build to prove hydration, SPA dispose and remount, and no-JS fallback. Also verify that no .ts file is executed from node_modules by any script. -- 
- **U11 package build tooling** (size: S; dependsOn: ): tsup with bundle:false over src/**/*.{ts,tsx} (zudo-sg config) plus tsc declarations. Either rewrite all relative `.ts`/`.tsx` specifiers in the extracted sources to `.js`, or compile with tsc `rewriteRelativeImportExtensions`. Add a package-shape check that every island dist file still starts with "use client", that no dist import ends in .ts/.tsx, and that styles.css and the islands d.ts are present in the `files` list. The bin entry points at dist JS, never at .ts. -- 

## files
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/ui/component-references.tsx [generic] loc=42: SSR 'Documents and package' section: decodes the hex descriptor and composes the footprint and model previews 
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/ui/evidence-anchor.tsx [generic] loc=27: SSR stable id anchor span (.zld-evidence-anchor) 
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/ui/evidence-details.tsx [generic] loc=53: SSR native <details> for pin tables; the component owns the summary label map 
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/ui/evidence-fact.tsx [generic] loc=13: SSR fact grouping div 
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/ui/evidence-table.tsx [generic] loc=57: SSR focusable scroll container; the label selects a width modifier class 
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/ui/footprint-preview.tsx [coupled] loc=19: Island(when=visible) wrapper for FootprintPreviewIsland -- imports ../../src/component-preview/... (host layout); must become a package-relative import
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/ui/package-model-viewer.tsx [coupled] loc=16: Island(when=visible) wrapper for PackageModelViewerIsland -- imports ../../src/component-model-viewer/...; must become a package-relative import
- $HOME/repos/circuits/zudo-led-lamp/doc/src/chrome-bindings.tsx [host-glue] loc=41: Host chromeBindingsModule; registers 6 mdxExtras -- should shrink to a host file that spreads a package-exported mdxExtras object; its scanner comment is stale for zfb>=2.18
- $HOME/repos/circuits/zudo-led-lamp/doc/pages/docs/[[...slug]].tsx [host-glue] loc=76: Host-owned doc route: zudo-doc 5.27 scaffold plus DocHistory patch plus static island imports -- lines 38-45 are the only circuit-specific addition
- $HOME/repos/circuits/zudo-led-lamp/doc/pages/index.tsx [host-glue] loc=6: One-line re-export of the zudo-doc static index route 
- $HOME/repos/circuits/zudo-led-lamp/doc/src/component-preview/footprint-preview-island.tsx [generic] loc=84: "use client" footprint image, link and enlarge island 
- $HOME/repos/circuits/zudo-led-lamp/doc/src/component-preview/preview-enlarge-dialog.tsx [generic] loc=95: "use client" native <dialog> chrome shared by both islands (zudo-doc useModalDialog, AFTER_NAVIGATE_EVENT) 
- $HOME/repos/circuits/zudo-led-lamp/doc/src/component-model-viewer/package-model-viewer-island.tsx [generic] loc=152: "use client" model viewer island with inline and dialog instances; lazily imports the runtime 
- $HOME/repos/circuits/zudo-led-lamp/doc/src/component-model-viewer/viewer-runtime.ts [generic] loc=232: three.js VRML viewer: OrbitControls, render-on-demand, dispose -- contains ?model-viewer-webgl/model=fail test hooks and the renderCount diagnostic
- $HOME/repos/circuits/zudo-led-lamp/doc/src/component-model-viewer/viewer-state.ts [generic] loc=16: data-viewer-state and status-message helpers 
- $HOME/repos/circuits/zudo-led-lamp/doc/src/styles/global.css [coupled] loc=535: Host CSS entry; lines 30-535 are component-doc rules -- 1-28 stay in the host (scaffold); 30-535 move to the package styles.css
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/footprint-previews/config.ts [coupled] loc=17: Renderer pin (image digest, version, platform, layers, theme, options) and output roots -- roots come from DOC_ROOT and must move to circuit.config
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/footprint-previews/generate.ts [coupled] loc=147: Docker kicad-cli SVG export, normalize, manifest, rm-and-rewrite of the output dir -- exact 25 (:129) and 35 (:141); rm -rf at :103
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/footprint-previews/check.ts [coupled] loc=77: Docker-free freshness and safety check of committed previews -- exact 25 (:27); success message hardcodes 25 (:76)
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/footprint-previews/footprint.ts [generic] loc=60: Removes fp_text and property s-exprs from the temporary library copy 
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/footprint-previews/hash.ts [generic] loc=15: sha256 and aggregateHash 
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/footprint-previews/manifest.ts [generic] loc=30: Manifest types 
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/footprint-previews/parity.ts [generic] loc=49: Master vs .pretty byte parity -- already parameterized (masterRoot, libraryRoot); defaults come from config
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/footprint-previews/selection.ts [coupled] loc=15: Derives the selection from the evidence index and CIRCUIT_SELECTION 
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/footprint-previews/svg.ts [generic] loc=175: SVG normalizer and strict validator 
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/adapters/circuit/references.ts [coupled] loc=307: Document and package reference contract, VRML safety, size limits, containment -- MODEL_PREFIX (:48) and the 25 count (:93) are LED-specific
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/adapters/circuit/model-assets.ts [coupled] loc=176: Sync selected WRLs to public/; refuses to delete unknown files -- 25 (:37); symlink walk from filesystem root (:154-161)
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/adapters/circuit/paths.ts [coupled] loc=78: Resolves DOC_ROOT and REPO_ROOT from import.meta.url; footprint and model roots -- points inside node_modules once packaged; replace with explicit config
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/core/reference-descriptor.ts [generic] loc=127: v1 ComponentReferences descriptor encode, decode and validate (isomorphic) 
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/core/model-descriptor.ts [generic] loc=68: v1 model viewer descriptor encode, decode and validate (isomorphic, in the client bundle) 
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/cli/models.ts [coupled] loc=22: generate:models and check:models CLI 
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/scripts/check-built-component-references.mjs [coupled] loc=184: Post-build HTML and asset assertions for references and islands -- 35 and 25 hardcoded; route layout hardcoded; needs zero-state support
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/scripts/model-viewer-browser-smoke.mjs [led-only] loc=987: CDP and system-Chrome browser smoke over dist -- harness is generic; the representatives, AWAY and RECORD constants are LED data
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/scripts/check-mermaid.mjs [coupled] loc=85: Parses all mermaid blocks in collapsed form -- fails on zero diagrams (:73)
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/scripts/check-zfb-link-warnings.sh [coupled] loc=137: Gates the zfb build log on warnings outside known-false classes -- generated tree path (:62) and doc-history message shapes (:94-102)
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/scripts/scan-doc-skill.sh [coupled] loc=78: Sandboxed setup-doc-skill run, then artifact scan -- depends on doc/scripts/setup-doc-skill.sh
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/PRESENTATION-CONTRACT.md [doc] loc=337: Presentation decisions (EvidenceFact, keep the descriptor API and islands) 
- $HOME/repos/circuits/zudo-led-lamp/doc/zfb.config.ts [host-glue] loc=140: zudoDoc config: chromeBindingsModule, dynamicPageTransition, docHistoryExclude, defaultLocaleOnlyPrefixes, headerNav Components 
- $HOME/repos/circuits/zudo-led-lamp/doc/tsconfig.json [host-glue] loc=13: Extends zudo-doc base; includes component-docs; react-to-preact paths 
- $HOME/repos/circuits/zudo-led-lamp/footprints/CLAUDE.md [doc] loc=104: KiCad dual-location rule, STEP+WRL pair rule, preview regeneration steps, external components -- the procedure is reusable; the inventory and part notes are LED-only
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/tests/footprint-previews.test.ts [test-corpus] loc=137: Footprint transform and drift tests -- asserts 25 and 35 at :64-67
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/tests/model-viewer.test.ts [test-corpus] loc=137: Descriptor, asset sync and fit-distance tests -- 35 and 25 at :49-55; the lifecycle helpers at :85+ are generic
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/tests/reference-descriptor.test.ts [test-generic] loc=58: Descriptor boundary tests 
- $HOME/repos/circuits/zudo-led-lamp/doc/component-docs/tests/references.test.ts [test-corpus] loc=136: Reference contract tests on the LED corpus 
- $HOME/repos/myoss/zudo-sg/packages/styleguide/src/islands.ts [doc] loc=25: Precedent: side-effect island seed subpath 
- $HOME/repos/myoss/zudo-sg/packages/styleguide/tsup.config.ts [tooling] loc=45: Precedent: bundle:false build preserving "use client" 
- $HOME/repos/myoss/zudo-sg/packages/create-zudo-sg/templates/default/pages/lib/_zudo-sg-islands.ts [host-glue] loc=3: Precedent: host island seed shim 
- $HOME/repos/myoss/zudo-sg/packages/create-zudo-sg/templates/default/src/styles/global.css [host-glue] loc=38: Precedent: consumer CSS import order for package CSS 
- $HOME/repos/myoss/zudo-sg/docs/adr/styleguide-engine.md [doc] loc=: Evidence on island discovery (findings 3-4, 2026-09-16 amendment) 
- $HOME/repos/myoss/zfb/crates/zfb-islands/tests/npm_dist_islands.rs [doc] loc=: Evidence: scanner node_modules traversal policy (#999) 
- $HOME/repos/myoss/zudo-doc/src/content/docs/guides/custom-components.mdx [doc] loc=171: zudo-doc guide: mdxExtras is SSR-only; experimental island recipe 
- $HOME/repos/myoss/zudo-doc/packages/zudo-doc/src/plugins/routes.ts [doc] loc=: virtual:zudo-doc-chrome-bindings loader (re-export of the host path) 