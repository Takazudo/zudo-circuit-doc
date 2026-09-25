# zudo-doc-host: zudo-doc as documentation host (create-zudo-doc initializer + @takazudo/zudo-doc runtime config), verified with a real generated probe project

## Summary
## Probe result: the published initializer produces a small host that builds cleanly in about 3 seconds

I ran published create-zudo-doc@5.27.0 non-interactively: `pnpm dlx create-zudo-doc@5.27.0 app --yes --lang en --no-install --no-git --pm pnpm`. Generation took 0.46s and wrote 18 files. `pnpm install` took about 5s with pnpm 10.30.3 (the generated package.json has no `packageManager` field) and added 114 packages, 299 MB of node_modules. `pnpm build` (`zfb build`) exited 0: "6 pages built in 2.87s", 3s wall time under heavy-guard. `pnpm check` (`zfb check`, which runs tsc) reported no errors.

- **Without git:** the build logs a non-fatal `zfb error: [plugin:doc-history] ... not inside a git repository` and an asset-viewer `git rev-parse` stack trace. After `git init` plus a commit, the build log is clean.
- **Dist size:** dist has 274 files and 8.0 MB, because all 30 bundled theme packs are copied. Setting `themePacks: ["default"]` cuts this to 22 files and 2.4 MB.
- **zfb 2.21.0:** swapping in zfb 2.21.0 (the newest on the registry, published 2026-09-25) also builds cleanly.

## The seed needs corrections in six places

1. **Baseline is stale.** The seed audited zudo-doc at 6a10f764. Local HEAD a57c2f705 is 2 commits ahead, with an unreleased change in `packages/create-zudo-doc/src/scaffold.ts:976-978,1092` that bumps the generated pins to zfb 2.21.0 and zdtp 0.8.3. The published 5.27.0 still emits `@takazudo/zfb*` **2.20.2**, which the probe package.json confirms. So the family is not uniform:
   - create-zudo-doc 5.27.0 → zfb 2.20.2
   - zudo-sg starter → 2.20.3
   - LED doc → 2.20.2
   - zudo-doc HEAD → 2.21.0
2. **`zfb/config` is current, not stale.** The seed suggested importing `defineConfig` from `zfb/config` was an old-docs artifact. In fact the current generator emits it (`zfb-config-gen.ts:492`). Types come from `@takazudo/zudo-doc/zfb-config-shim.d.ts`, which `tsconfig.base.json` includes. Both `zfb/config` and `@takazudo/zfb/config` work.
3. **The API has more limits than "no destination".**
   - `createZudoDoc` resolves its target as `path.resolve(process.cwd(), projectName)` (`utils.ts:140-142`, `api.ts:128-130`). Any other destination needs a process-wide `chdir`.
   - `features` is required and gets no defaults (`api.ts:40`), and `FEATURES` is not exported from the package entry, so a caller must hard-code the default feature list.
   - There is no site-title option: `siteName` is derived as `capitalize(projectName)` (`scaffold.ts:418`).
4. **No staging.** The seed assumes staging exists; create-zudo-doc has none. It refuses a non-empty directory with exit 1 (`scaffold.ts:297-304`), then writes straight into the target (`scaffold.ts:346-355`).
5. **The CLI hides install failures.** It swallows them and still prints Done (`index.ts:185-187`). It also prints `cd app` / `pnpm dev` without an install step even with `--no-install` (`index.ts:220-223`, seen in the probe output).
6. **The island warning is conservative for zfb 2.20.2.** The seed repeats the guide's warning that the virtual chrome-bindings path does not make islands hydrate (`custom-components.mdx:72-76,151`). My probe put a `"use client"` island inside a node_modules package, reached only through a host `src/chrome-bindings.tsx` that re-exports the package's `mdxExtras`, with no static import in the route. It was registered in the islands bundle and hydrated in headless Chromium: 2 clicks gave "Count: 2" with no console errors. The guide still calls this experimental (issue #2718), and LED keeps static `void Island` imports (LED `doc/pages/docs/[[...slug]].tsx:38-45`). So keep a static-import seam and a hydration smoke test anyway.

## The seed is right on these points

- Runtime `DEFAULT_SETTINGS` has `llmsTxt: false` and `assetViewer: false` (`config.ts:207,231`), while the initializer defaults both on (`constants.ts` FEATURES) and `llms-txt.mdx:28` says "enabled by default".
- `assetViewerExclude` only suppresses viewer generation. The raw file stays public (`asset-viewer.mdx:99`).
- Adding or removing an asset needs a dev-server restart (`asset-viewer.mdx:225`).
- Asset pages stay out of search, llms.txt and the sitemap unless `assetViewerIndexing` opts them in (`asset-viewer.mdx:117-119`).
- `claudeResources` and `codexResources` accept `scanRoot` (`config.ts:143-151`).

## Three constraints the plan must respect

- **`chromeBindingsModule` must be a project-root-relative file.** The routes plugin joins it with `projectRoot` and fails loudly if the file is missing or is a directory (`plugins/routes.ts:436-470,628-647`). A bare package specifier will not work. The host needs its own small `src/chrome-bindings.tsx` that imports from `@takazudo/zudo-circuit-doc`.
- **Tailwind does not scan package code.** Classes in a runtime package's `dist` are not scanned by default. The probe proved `@source "node_modules/<pkg>/dist/**/*.js"` works; the path is resolved from the project root, and a `../../` path failed. The zudo-sg alternative is for the package to ship prebuilt `styles.css` and `safelist.css`.
  - zudo-doc's `theme.css` resets `--color-*` and limits the token scales: `tracking-widest` was not generated. Circuit UI must use zudo-doc tokens.
- **Header nav matching is a prefix test.** `categoryMatch` uses `topCategory.startsWith(cm)`, longest prefix wins, and `"!"` is the catch-all (`nav-scope/index.ts:48-98`). The 3–6 item limit is only guidance (`structuring-navigations.mdx:80`), not enforced.

## Recommendation: ship our own template, and use the upstream API only as a dev-time drift check

Use strategy 3, a fixture-derived template like zudo-sg's, with exact pins. Add a dev-time check that runs the pinned create-zudo-doc `createZudoDoc` API into a temp dir and diffs the upstream-owned files:
- `pages/docs/[[...slug]].tsx`
- `pages/index.tsx`
- `tsconfig.json`
- `src/styles/global.css`
- `.npmrc`
- the `package.json` dependency pins

Do not call create-zudo-doc at user runtime. The API reproduced the CLI output exactly apart from strings derived from the name, in 25ms. That makes it a reliable, deterministic oracle for the drift check.

Evidence for this choice:
- The circuit overlay would rewrite `zfb.config.ts`, `package.json`, `CLAUDE.md` and all content, so upstream adds little.
- create-zudo-doc skips writing `pnpm-workspace.yaml` when an ancestor directory has one (`utils.ts:246-254`, `scaffold.ts:661-676`, reproduced in the probe with its warning). That conflicts with a circuit root workspace that contains `doc/`.
- Upstream pins change between releases.

## facts
- Probe commands and results. `pnpm dlx create-zudo-doc@5.27.0 --help` saved to explore/zudo-doc-probe/help.txt. `pnpm dlx create-zudo-doc@5.27.0 app --yes --lang en --no-install --no-git --pm pnpm` took 0.46s and wrote 18 files. `pnpm install`: 114 packages, about 5s, pnpm v10.30.3. `pnpm build`: exit 0, '✓ 6 pages built in 2.87s', 3s wall time (heavy-guard verdict=PASS). `pnpm check`: '✓ checked 1 collection and tsc — no errors'. Logs are in explore/zudo-doc-probe/{gen.log,install.log,build.log,build-git.log,build-island-A.log}.
- Generated file list (published 5.27.0, `--yes` defaults, en): .gitignore, .npmrc, CLAUDE.md (75 lines, generic zudo-doc guidance), package.json, pages/docs/[[...slug]].tsx, pages/index.tsx, pnpm-workspace.yaml, public/favicon-16x16.png, public/favicon-32x32.png, public/favicon.ico, public/favicon.svg, scripts/check-links.js (969 lines), src/content/docs/getting-started/{index,installation,introduction}.mdx, src/styles/global.css, tsconfig.json, zfb.config.ts.
- Generated package.json. name 'app' (the final segment of the destination), version 0.0.1, private, type module, engines node >=22, NO packageManager field. Scripts: dev='run-parallel dev:zfb dev:history', build='zfb build', preview='zfb preview', check='zfb check', check:links='node scripts/check-links.js', check:images='zudo-doc check images', dev:zfb='zfb dev', dev:zfb:network='zfb dev --host 0.0.0.0', dev:network='run-parallel dev:zfb:network dev:history', dev:history='doc-history-server --port 4322 --content-dir src/content/docs'. Deps: @takazudo/zfb 2.20.2, @takazudo/zfb-runtime 2.20.2, @takazudo/zfb-md-wasm 2.20.2 (exact); @takazudo/zudo-doc ^5.27.0; zod ^4.3.6; preact ^10.29.1; preact-render-to-string ^6.6.6; diff ^8.0.3 (only with docHistory); @takazudo/zudo-doc-history-server ^5.27.0 (with docHistory or assetViewer). devDeps: typescript ^5.9.0, @types/node ^22.0.0. No tailwindcss dep, although global.css imports 'tailwindcss/preflight', and no katex or mermaid dep. Resolved versions: preact 10.29.8, zod 4.6.5, preact-render-to-string 6.7.0, typescript 5.9.3.
- Generated zfb.config.ts: `import { defineConfig } from "zfb/config"; import { zudoDoc } from "@takazudo/zudo-doc/config"; export default defineConfig(zudoDoc({ siteName: "App", llmsTxt: true, sidebarResizer: true, sidebarToggle: true, tocToggle: true, imageEnlarge: true, dynamicPageTransition: true, docHistory: true, assetViewer: true, footer: { links: [], copyright: "Copyright © 2026 Your Name. Built with zudo-doc." }, headerNav: [{ label: "Getting Started", path: "/docs/getting-started", categoryMatch: "getting-started" }], headerRightItems: [{ type: "component", component: "theme-toggle" }, { type: "component", component: "search" }] }));`. It is diff-from-defaults: only non-default fields are emitted (zfb-config-gen.ts:16-24,485-504).
- Generated pages/docs/[[...slug]].tsx (67 lines) is the base template (templates/base/pages/docs/[[...slug]].tsx:1-62) after the docHistory postProcess patch (features/doc-history.ts:31-61). Its imports are routeContext from 'virtual:zudo-doc-route-context', createRouteContext from '@takazudo/zudo-doc/route-context', createChrome from '@takazudo/zudo-doc/chrome', DocHistory from '@takazudo/zudo-doc/doc-history', defineChromeBindings from '@takazudo/zudo-doc/chrome-bindings', and chromeBindings from 'virtual:zudo-doc-chrome-bindings'. It calls `createChrome(routeCtx, {...chromeBindings, ...defineChromeBindings({ DocHistory })})`, exports `frontmatter = { title: 'Docs' }`, and exports `paths()`, which uses routeCtx.resolveNavSource and buildDocRouteEntries with `routeSig docs;${locale}`. The default export calls renderDocPage(props, { locale, docHistoryContentDir: routeCtx.settings.docsDir }). The build logs that this stub SHADOWS the package route: 'package route /docs/[[...slug]] ... is shadowed by a user pages/ route (user wins)'.
- Generated pages/index.tsx is a single-line re-export, `export { default } from "@takazudo/zudo-doc/routes/index";`. Dynamic routes cannot use this form because paths() is extracted from source, not from dist (comment at lines 1-5).
- Generated tsconfig.json: extends '@takazudo/zudo-doc/tsconfig.base.json'; include ['src','pages','zfb.config.ts']; baseUrl '.'; paths '@/*'→'src/*', react/react-dom→'./node_modules/preact/compat/', react/jsx-runtime→'./node_modules/preact/jsx-runtime'. The base config sets moduleResolution Bundler, jsx react-jsx, jsxImportSource preact, strict, and files [zfb-config-shim.d.ts, virtual-modules.d.ts].
- Generated src/styles/global.css: `@layer zd-preflight, zd-flow; @import "tailwindcss/preflight" layer(zd-preflight); @import "tailwindcss/utilities"; @import "@takazudo/zudo-doc/theme.css"; @import "@takazudo/zudo-doc/safelist.css"; @import "@takazudo/zudo-doc/content.css"; @import "@takazudo/zudo-doc/page-loading.css"; @import "@takazudo/zudo-doc/features.css"; @source "src/content/**/*.{mdx,md}"; @source "src/components/**/*.{tsx,ts,jsx,js}"; @source "pages/**/*.{tsx,ts,jsx,js}"; @theme {}`. Order is load-bearing: theme.css must come before features.css.
- Generated .npmrc: `trust-policy-exclude[]=undici-types@6.21.0` (scaffold.ts:642-645). Generated pnpm-workspace.yaml: comment line plus `minimumReleaseAge: 0` (scaffold.ts:661-665). It is skipped, with a console.warn, when any ancestor directory has pnpm-workspace.yaml (utils.ts:246-254, scaffold.ts:666-676); I reproduced this in the probe under apiprobe/. .gitignore covers node_modules, dist, .zfb, .zfb-build/, .zudo-doc/ (the build writes .zudo-doc/routes-src there), .env*, logs and .wrangler/ (scaffold.ts:570-631).
- Features ON by default under --yes (constants.ts:216-420, index.ts:130-135): search, sidebarFilter, sidebarResizer, sidebarToggle, tocToggle, docHistory, llmsTxt, imageEnlarge, assetViewer, dynamicPageTransition, footerCopyright. OFF by default: i18n, claudeResources, codexResources, claudeSkills, claudeSkillsWriting, designTokenPanel, themePackSwitcher, versioning, bodyFootUtil, skillSymlinker, tauri, tauriDev, footerNavGroup, changelog, tagGovernance, docTags, footerTaglist, noindex. Other --yes defaults (index.ts:112-129): projectName 'my-docs', lang 'en', colorSchemeMode 'light-dark' (Default Light/Default Dark, defaultMode dark, respectPrefersColorScheme true), themePack 'default', pm 'pnpm', githubUrl ''.
- CLI flags (cli.ts:79-164, printHelp 166-221, help captured in probe). The positional `destination` may be a path; its final segment becomes the project name unless `--name` is given (cli.ts:115-120, index.ts:58-69). Name grammar is /^[a-z0-9][a-z0-9._-]*$/, max 214 characters (utils.ts:14-38). With --name, only the destination's final segment must be non-empty (normalizeDestination, utils.ts:63-84). Value flags: --lang (en, ja, zh-cn, zh-tw, ko, es, fr, de, pt), --additional-langs a,b, --color-scheme-mode, --scheme, --light-scheme, --dark-scheme, --default-mode, --[no-]respect-system-preference, --theme-pack, --changelog-packages, --github-url, --preset <json|->, --pm pnpm|npm|yarn|bun. Each feature has a --[no-]<flag>. --[no-]install defaults to TRUE under --yes or --preset (index.ts:158-164). --[no-]git defaults to true (index.ts:195). -y/--yes, -h/--help. There is no --version flag and no title flag. Probe confirmed: a destination 'nested dir/doc' with --name my-circuit-doc produced siteName 'My Circuit Doc' and printed `cd "nested dir/doc"`; an existing non-empty destination exits 1 with 'Directory ... already exists and is not empty'.
- createZudoDoc API (api.ts:26-138). CreateOptions: projectName, defaultLang, additionalLangs, colorSchemeMode, singleScheme, lightScheme, darkScheme, respectPrefersColorScheme, defaultMode, themePack, features: string[] (required, no defaults), changelogPackages, githubUrl, cjkFriendly, minifyHtml, packageManager (required), headerRightItems, metaTags, install (default false), git (default false). It validates the name, schemes, themePack, headerRightItems, metaTags and changelogPackages; resolves the locale plan; runs scaffold(); then targetDir = resolveTargetDir, i.e. path.resolve(process.cwd(), projectName) (utils.ts:140-142, api.ts:128-130). It returns the absolute targetDir. installDependencies uses execSync with stdio 'pipe' (utils.ts:144-154). initGitRepo skips when already inside a repo or when git is missing, and falls back to a neutral committer identity (utils.ts:178-233). The package entry exports only createZudoDoc, resolveLocalePlan and types (package.json exports '.': './dist/api.js').
- API probe: I installed create-zudo-doc@5.27.0 in explore/zudo-doc-probe/apiprobe, chdir'd to a staging dir, and called createZudoDoc with the 11 default features listed explicitly. It ran in 25ms, and `diff -r` against the CLI output differed only in strings derived from the name (package name, siteName, CLAUDE.md title, starter prose).
- zudoDoc() (packages/zudo-doc/src/config.ts:804-906) shallow-merges user settings over DEFAULT_SETTINGS (config.ts:164-251): a nested object replaces the default wholesale. It peels off port, adapter, bundle, strictContentBridge, buildDocsSchema, colorSchemes, translations, directives and tagVocabularyEntries. It returns a complete ZfbConfig: framework 'preact', port 4321, tailwind.enabled true, base, plus the preset fragment. The config eval graph must stay free of node:* builtins because zfb evaluates it with esbuild platform=neutral (config.ts:39-54).
- zudoDoc options relevant to circuit docs (ZudoDocConfig interface line : DEFAULT_SETTINGS line = default):
- siteName string (277 : 172 = 'Docs')
- siteDescription (282 : 173 = '')
- base string (314 : 176 = '/')
- siteUrl string (417 : 192 = '')
- docsDir (354 : 182 = 'src/content/docs')
- defaultLocale (380 : 185 = 'en')
- locales Record<string, LocaleConfig> (386 : 186 = {})
- cjkFriendly boolean (485 : 210 = false)
- onBrokenMarkdownLinks 'warn'|'error'|'ignore' (490 : 211 = 'warn')
- llmsTxt boolean (470 : 207 = false)
- docHistory boolean (590 : 228 = false)
- docHistoryUi (596 : 229 = true)
- docHistoryExclude string[] slug globs (604 : 230 = [])
- assetViewer (606 : 231 = false)
- assetViewerDir (608 : 232 = 'assets')
- assetViewerRoutePrefix (default 'files')
- assetViewerExclude string[] (612 : 234 = [])
- assetViewerIndex (614 : 235 = false)
- assetViewerIndexing AssetViewerIndexingConfig {search?, llmsTxt?, sitemap?} | false (616 : 236 = false; type at settings.ts:207-211)
- claudeResources {claudeDir, projectRoot?, scanRoot?} | false (636 : 240 = false; type at config.ts:143-146)
- codexResources {codexDir, projectRoot?, scanRoot?} | false (648 : 241 = false; type at config.ts:148-151)
- defaultLocaleOnlyPrefixes string[] (653 : 242 = [])
- headerNav HeaderNavItem[] (664 : 244 = []); HeaderNavItem is {label, labelKey?, path, categoryMatch?, versioned?, children?: HeaderNavChildItem[]} (settings.ts:29-45)
- headerRightItems (669 : 245 = [theme-toggle])
- packageOwnedRoutes (676 : 246 = true)
- chromeBindingsModule string (684; no default)
- themePack / themePacks
- mermaid (391 = true)
- noindex
- sitemap (433 = false)
- strictContentBridge (785; zfb default false)
- bundle (777)
- translations (743)
- Header nav rules. categoryMatch is a PREFIX test on the first slug segment; the longest match wins and '!' is the catch-all (nav-scope/index.ts:48-69). getNavSubtree filters with startsWith (nav-scope/index.ts:84-98). Children's categoryMatch values count toward the category order (nav-scope/index.ts:28-39). Multi-segment categoryMatch never matches, and duplicate child matches warn (header-navigation.mdx Warning around lines 100-110). The max-items rule is guidance only: '3–6 items' (structuring-navigations.mdx:80; zudo-doc-navigation-design skill 'max'). No code enforces it. The LED config comment says a page whose top category matches no categoryMatch gets an EMPTY sidebar (zudo-led-lamp doc/zfb.config.ts:89-105).
- chromeBindingsModule resolution: plugins/routes.ts:436-470 (resolveHostModuleOverride) joins projectRoot with the path. It throws on an empty string, a missing file, or a directory. At routes.ts:628-647 the virtual module 'virtual:zudo-doc-chrome-bindings' re-exports `chromeBindings` from the absolute path, or `export const chromeBindings = {}` when unset. The mdxExtras override order (package defaults first, host last) is documented at custom-components.mdx:86-96.
- Island discovery experiment (explore/zudo-doc-probe/app-island, zfb 2.20.2, zudo-doc 5.27.0). A fake package @probe/circuit-ui installed via file: ships dist/counter.js ('use client', displayName 'ProbeCounter') and dist/bindings.js, which wraps it in `Island({when:'load'})` from @takazudo/zfb and exports mdxExtras. The host's src/chrome-bindings.tsx re-exports them, and zfb.config sets chromeBindingsModule './src/chrome-bindings.tsx'. There is NO static import in pages/docs. Result: the HTML has `data-zfb-island=ProbeCounter`, the islands bundle registers ProbeCounter, and in headless Chromium two clicks gave 'Count: 2' with no page errors. A presentational ProbeBadge also rendered through mdxExtras without an import.
- Tailwind in package code. A utility class (decoration-wavy) used only in node_modules/@probe/circuit-ui/dist was NOT in the CSS by default. Adding `@source "../../node_modules/..."` did not help either. `@source "node_modules/@probe/circuit-ui/dist/**/*.js"` (resolved from the project root) DID emit it. zudo-doc theme.css resets `--color-*: initial` (line 81) and defines only 4 tracking steps (lines 190-194), so `tracking-widest` was not generated.
- zudo-sg starter pattern for package islands and CSS (Takazudo/zudo-sg b9b36ce3, packages/create-zudo-sg/templates/default). pages/index.tsx statically imports './lib/_zudo-sg-islands' (which does `import '@takazudo/zudo-sg/islands'`) and './lib/_body-end-islands'. chromeBindingsModule is './pages/lib/_chrome-bindings.tsx', which exports ChromeHostBindings { BodyEndIslands }. There is no pages/docs stub, so package-owned routes are used. global.css imports '@takazudo/zudo-sg/styles.css' and '@takazudo/zudo-sg/safelist.css'. package.json pins packageManager pnpm@11.5.2, exact zfb 2.20.3 and zudo-doc 5.27.0, plus tailwindcss ^4.2.0 and katex. pnpm-workspace.yaml has `packages: []`, `allowBuilds: esbuild: true`, and a minimumReleaseAgeExclude list.
- Registry state on 2026-09-26: create-zudo-doc latest is 5.27.0; @takazudo/zudo-doc dist-tag latest is 5.27.0; @takazudo/zfb versions run up to 2.21.0, published 2026-09-25T16:12:59Z. The probe rebuilt successfully with the zfb/zfb-runtime/zfb-md-wasm trio at 2.21.0 ('6 pages built in 4.22s', explore/zudo-doc-probe/app-zfb221).
- @takazudo/zudo-doc 5.27.0 peerDependencies: @takazudo/zfb ^2.20.2, @takazudo/zfb-md-wasm ^2.20.2, @takazudo/zfb-runtime ^2.20.2, @takazudo/zudo-doc-history-server ^5.17.2, @takazudo/zdtp ^0.5.2||…||^0.8.0, diff ^8, katex ^0.16, preact ^10.29.1, zod ^4.3.6. Bins: zudo-doc, run-parallel, gen-component-tokens, gen-z-index, tags-audit, tags-suggest. Dist includes 21 'use client' modules (e.g. dist/doc-history/index.js) and routes-src/*.tsx route sources (docs-slug, files-path, locale-*, etc.).
- Routes the package injects in the probe build: /404, /robots.txt, /files/[[...path]] (the asset viewer). /docs/[[...slug]] is shadowed by the host stub. Build outputs: dist/llms.txt, dist/llms-full.txt, dist/search-index.json, and dist/__zfb/routes.json. Setting `themePacks: ["default"]` shrank dist from 274 files / 8.0 MB to 22 files / 2.4 MB (app-zfb221 probe).
- With git: after `git init && git commit`, `pnpm build` produced no warn/error lines and doc-history wrote 3 entries. `GEN_DOC_HISTORY=1 pnpm build` generated history JSON; the default local build skips it ('Skipping doc history generation (local default — set GEN_DOC_HISTORY=1 to generate)').
- LED host (zudo-led-lamp 194d8a29, doc/zfb.config.ts:1-110):
- claudeResources { claudeDir: '../.claude', scanRoot: '..' }
- defaultLocaleOnlyPrefixes covering /docs/claude*/ and /docs/components/
- docHistoryExclude ['components','components/**']
- chromeBindingsModule './src/chrome-bindings.tsx'
- cjkFriendly true, llmsTxt true, assetViewer true
- a 6-item headerNav with a Components dropdown whose children carry categoryMatch values
- doc/package.json pins zfb 2.20.2 and packageManager pnpm@10.34.1; its build runs generate:enclosure-viewer, generate:models and generate:components before `zfb build`

## risks
- Upstream pin drift. zudo-doc HEAD has already bumped the scaffold pins to zfb 2.21.0 and zdtp 0.8.3 without a release (scaffold.ts:976-978,1092; CHANGELOG [Unreleased]). A template pinned to whatever create-zudo-doc 5.27.0 emits (2.20.2) will be behind as soon as 5.27.1 ships. Pick one tested family (I verified zudo-doc 5.27.0 with zfb 2.20.2 and with 2.21.0) and add a drift check.
- Calling createZudoDoc at user runtime requires process.chdir, because the target is resolved from process.cwd() (utils.ts:140-142). That is process-global and unsafe for concurrent or programmatic callers. The caller must also hard-code the feature-default list, since FEATURES is not exported and CreateOptions.features gets no defaults.
- Invoking the create-zudo-doc CLI inside a circuit project whose root already has pnpm-workspace.yaml silently omits doc/pnpm-workspace.yaml, with only a console.warn (scaffold.ts:661-676). The root workspace must then set minimumReleaseAge: 0 (or an exclude list), or pnpm 11's 1440-minute default will block fresh @takazudo releases.
- The create-zudo-doc CLI hides failures and misleads. An install failure is swallowed and 'Done!' still prints (index.ts:185-187). With --no-install, the next steps omit the install step (index.ts:220-223). Scaffolding writes directly into the destination with no staging or rollback (scaffold.ts:346-355). A circuit initializer that wraps it would inherit all three.
- Island hydration through the virtual bindings path worked in my zfb 2.20.2 probe, but upstream docs still call it experimental (custom-components.mdx:72-76,151-157; zudo-doc issue #2718), and LED keeps static `void` imports. A future zfb change could break it silently. Keep a static-import seam in a host page or route, plus a built-site hydration smoke test in the tarball-install verification.
- The runtime package's Tailwind classes are not compiled unless the host's global.css adds a project-root-relative `@source "node_modules/@takazudo/zudo-circuit-doc/dist/**/*.js"`, or the package ships prebuilt CSS/safelist files (the zudo-sg approach). Also, zudo-doc's theme resets the color tokens and trims the scales, so stock Tailwind classes such as tracking-widest or bg-red-500 may produce nothing.
- Builds without git print a `zfb error:` line from the doc-history plugin and a stack trace from the asset-viewer git check, even though the build succeeds. An acceptance test that requires 'no errors in the log' must run `git init` plus a commit in the out-of-monorepo test project first, or turn docHistory off there.
- categoryMatch prefix semantics (startsWith): a category named 'components' also claims 'components-archive'. Any top-level content directory not covered by a headerNav categoryMatch (or a '!' catch-all) gets an empty sidebar. Generated circuit trees and the claude-* mirror trees must be planned into headerNav.
- The dist size of a default scaffold is dominated by the 30 copied theme packs (8.0 MB). Pin `themePacks: ["default"]` in the circuit template, or size and file-count assertions will be noisy.
- The generated package.json has no packageManager field, and the probe ran under pnpm 10.30.3. zudo-sg pins pnpm@11.5.2 and LED pins pnpm@10.34.1. The circuit template must choose one and exercise the out-of-monorepo install with it. pnpm 11 moves settings into pnpm-workspace.yaml and adds allowBuilds for esbuild.
- `chromeBindingsModule` accepts only a host file path, not a package specifier (routes.ts:449-470). The runtime package therefore cannot own that entry point directly: every generated project must carry a small src/chrome-bindings.tsx shim, which the planner should treat as template-owned and stable.

## openQuestions
- Should the circuit template keep the host pages/docs/[[...slug]].tsx stub (upstream parity, and an explicit place for static island imports) or drop it and rely on package-owned routes as the zudo-sg starter does? I did not test whether DocHistory hydrates on the package-owned route with no stub.
- Which pnpm major should the generated project pin in packageManager? The probe used 10.30.3; zudo-sg uses 11.5.2, which also needs allowBuilds for esbuild and a minimumReleaseAge exclude list.
- Which exact zfb version (2.20.2, 2.20.3, 2.20.4 or 2.21.0) and which zudo-doc version (5.27.0 or the next release) should the circuit template pin? The planner should fix one family and test with it.
- Should the runtime package ship prebuilt CSS (the zudo-sg styles.css/safelist.css approach) or should the host carry a node_modules @source? Prebuilt CSS avoids the host having to know the package's dist layout.
- Should onBrokenMarkdownLinks be set to 'error' and strictContentBridge to true in the circuit template, so that malformed generated MDX fails the build? That matches the requirement to fail on malformed or missing declared files.
- Keep or drop scripts/check-links.js (969 lines) from the upstream scaffold? LED uses it for `check:anchors --strict-anchors`, which is valuable for evidence anchors.

## dependencies
- @takazudo/zudo-doc 5.27.0 (runtime; peers: @takazudo/zfb ^2.20.2, zfb-runtime, zfb-md-wasm, zod ^4.3.6, preact ^10.29.1, optional zudo-doc-history-server, diff, katex, zdtp)
- @takazudo/zfb / zfb-runtime / zfb-md-wasm: 2.20.2 is what create-zudo-doc 5.27.0 emits; 2.21.0 is the registry latest and also builds
- @takazudo/zudo-doc-history-server ^5.27.0 (needed when docHistory or assetViewer is on)
- preact ^10.29.1, preact-render-to-string ^6.6.6, zod ^4.3.6, diff ^8.0.3
- create-zudo-doc 5.27.0 (dev-time only, for the parity check; deps @clack/prompts, fs-extra, minimist, picocolors)
- git (needed at build time for doc-history and asset-viewer metadata without error logs)
- Node >=22; pnpm (10.30.3 in the probe; zudo-sg pins 11.5.2)

## couplings
- [zfb.config.ts chromeBindingsModule ↔ packages/zudo-doc/src/plugins/routes.ts:449-470] The path must be a project-root-relative existing FILE. A package specifier is rejected. => The template must ship a host src/chrome-bindings.tsx shim that re-exports or merges the circuit package's mdxExtras. It cannot point directly at @takazudo/zudo-circuit-doc.
- [pages/docs/[[...slug]].tsx ↔ features/doc-history.ts:31-61] DocHistory hydrates only when the stub statically imports it and merges it over chromeBindings. The stub also shadows the package route. => Keep the docHistory-patched stub verbatim from 5.27.0. Add circuit island static imports there, or in pages/index.tsx the way zudo-sg does; never replace chromeBindings wholesale.
- [src/styles/global.css ↔ runtime package dist] Tailwind does not scan node_modules unless told to. @source globs are resolved from the project root. => Either the runtime package ships compiled styles.css/safelist.css imported after zudo-doc theme.css, or the template adds `@source "node_modules/@takazudo/zudo-circuit-doc/dist/**/*.js"`. Circuit components must use only zudo-doc token utilities.
- [headerNav categoryMatch ↔ nav-scope/index.ts:48-98 and the generated content tree layout] Prefix matching; an unmatched top-level category gets an empty sidebar. => The circuit template headerNav (3–6 items) must cover every top-level docs directory: the authored sections, the generated components tree, and claude-* when claudeResources is on (for example a dropdown whose children carry the categoryMatch values, as LED does).
- [circuit.config.ts ↔ zfb.config.ts (docsDir, claudeResources.scanRoot, docHistoryExclude, defaultLocaleOnlyPrefixes)] Generated trees and the repo-root .claude live outside or inside the doc app in fixed places. => Derive or duplicate these values consistently. zfb.config.ts must stay free of node:* imports (config.ts:39-54), so circuit.config.ts cannot be imported into zfb.config.ts if it uses node builtins; keep it data-only, or pass the values through a plugin.
- [Generated project root pnpm-workspace.yaml ↔ create-zudo-doc scaffold.ts:661-676] Nested workspace files are skipped, and pnpm 11 minimumReleaseAge would block fresh @takazudo releases. => Put a single pnpm-workspace.yaml at the circuit project root (packages: ['doc'] or similar) with minimumReleaseAge: 0 or an exclude list, plus allowBuilds for esbuild when on pnpm 11. Do not emit one in doc/.
- [package.json version family] Pins differ: create-zudo-doc 5.27.0 → zfb 2.20.2; zudo-sg → 2.20.3; zudo-doc HEAD (unreleased) → 2.21.0; @takazudo/zudo-doc peers need zfb ^2.20.2. => Choose one exact tested family (the probe verified zudo-doc 5.27.0 with zfb 2.20.2 and with 2.21.0) and record it in one constant that the parity check reads.

## extractionUnits
- **doc-host-template** (size: ~12 files; dependsOn: ): The doc/ subtree of the circuit template, derived from create-zudo-doc 5.27.0 output:
- pages/docs/[[...slug]].tsx (docHistory-patched stub, plus a static-import seam for circuit islands)
- pages/index.tsx (re-export)
- tsconfig.json
- src/styles/global.css (plus `@import "@takazudo/zudo-circuit-doc/styles.css"` or `@source "node_modules/@takazudo/zudo-circuit-doc/dist/**/*.js"`)
- .npmrc
- public favicons (or favicon 'auto')
- src/chrome-bindings.tsx shim spreading the circuit package's mdxExtras
- zfb.config.ts with circuit defaults: themePacks ['default']; claudeResources {claudeDir:'../.claude', scanRoot:'..'}; docHistoryExclude for the generated components tree; defaultLocaleOnlyPrefixes for the generated trees; headerNav covering every top-level content directory; llmsTxt true; assetViewer true; strictContentBridge true
- package.json with one pinned version family and a packageManager field -- Fixture-derived, with exact pins. Drop scripts/check-links.js (969 lines) or keep it deliberately. Replace the generic zudo-doc CLAUDE.md with the circuit workflow entry.
- **upstream-scaffold-parity-check** (size: ~150 LOC; dependsOn: doc-host-template): A dev-time script and test that installs the pinned create-zudo-doc, calls createZudoDoc({projectName, features: [11 defaults], packageManager:'pnpm'}) inside a temp cwd, and diffs the upstream-owned files (docs route stub, index route, tsconfig, global.css base lines, .npmrc, dependency pins) against the circuit template. It reports drift without writing, like zudo-sg's sync --check. -- The API reproduces the CLI output exactly apart from name-derived strings, and runs in 25ms
- **runtime-chrome-bindings-and-islands-contract** (size: package API surface; dependsOn: doc-host-template): The @takazudo/zudo-circuit-doc exports a host can consume:
- a `mdxExtras` map (EvidenceAnchor and the other evidence MDX components)
- an `islands` side-effect entry, or named island wrappers ("use client" dist modules with displayName pinned, wrapped with Island from @takazudo/zfb)
- styles.css and/or safelist.css compiled against zudo-doc tokens
The host shim (src/chrome-bindings.tsx) and the route stub's static import point at these exports. -- Probe-proven: a package island reached only through the host chromeBindingsModule file hydrates in zfb 2.20.2. Keep the static seam as defense in depth.
- **out-of-monorepo-host-smoke** (size: ; dependsOn: doc-host-template, runtime-chrome-bindings-and-islands-contract): Verification recipe:
1. Pack the tarballs and scaffold into a temp dir outside the monorepo.
2. Run `git init` and an initial commit, so the logs carry no doc-history or asset-viewer git errors.
3. Run `pnpm install`, `pnpm check` and `pnpm build`.
4. Assert the expected dist routes: docs pages, llms.txt, search-index.json, /files routes when assets exist.
5. Serve dist and check with headless Chromium that a circuit island hydrates and that evidence components render. -- The baseline host builds in about 3s, so the smoke run is cheap. Put the build through heavy-guard.

## files
- $HOME/repos/myoss/zudo-doc/packages/create-zudo-doc/src/api.ts [generic] loc=138: Public createZudoDoc() API; CreateOptions; install/git default false; target = cwd + projectName -- Lines 26-65 are CreateOptions; 67-138 are createZudoDoc; 128-130 hold the 'No destination' comment and resolveTargetDir
- $HOME/repos/myoss/zudo-doc/packages/create-zudo-doc/src/cli.ts [generic] loc=308: minimist arg parsing, help text, validation (destination vs --name) -- Lines 79-164 parseArgs; 166-221 printHelp; 223-308 validateArgs
- $HOME/repos/myoss/zudo-doc/packages/create-zudo-doc/src/index.ts [generic] loc=230: CLI main: preset→flags→--yes defaults→prompts→scaffold→install→git→next steps -- Lines 112-136 hold the --yes defaults; 158-188 swallow install failures; 195 defaults git on; 220-223 print next steps without an install step
- $HOME/repos/myoss/zudo-doc/packages/create-zudo-doc/src/scaffold.ts [generic] loc=1241: Writes the project: base copy, starter content, zfb.config.ts, package.json, .gitignore, .npmrc, pnpm-workspace.yaml, CLAUDE.md, features -- Line 63 ZUDO_DOC_PIN ^5.27.0; 272-693 scaffold(); 297-304 non-empty refusal; 661-676 ancestor-workspace skip; 695-1241 generatePackageJson, including zfb pins at 976-978 (HEAD 2.21.0 vs published 2.20.2)
- $HOME/repos/myoss/zudo-doc/packages/create-zudo-doc/src/utils.ts [generic] loc=305: Name grammar, destination split, resolveTargetDir, install, git init, ancestor workspace detection -- Lines 14-38 name regex; 140-142 resolveTargetDir; 178-233 initGitRepo; 246-254 hasAncestorPnpmWorkspace
- $HOME/repos/myoss/zudo-doc/packages/create-zudo-doc/src/compose.ts [generic] loc=310: Feature composition engine: @slot anchor injections plus postProcess hooks -- Few features still inject anything; most are pure config fields
- $HOME/repos/myoss/zudo-doc/packages/create-zudo-doc/src/constants.ts [generic] loc=434: FEATURES list with defaults and cliFlags; SUPPORTED_LANGS; THEME_PACKS -- Lines 216-420 FEATURES; not exported from the package entry
- $HOME/repos/myoss/zudo-doc/packages/create-zudo-doc/src/zfb-config-gen.ts [generic] loc=507: Generates the diff-from-defaults zfb.config.ts (DEFAULT_MIRROR copy of the runtime defaults) -- Line 33 DEFAULT_MIRROR; 282-290 claude/codex resources; 323-368 headerNav; 492 `zfb/config` import
- $HOME/repos/myoss/zudo-doc/packages/create-zudo-doc/src/features/doc-history.ts [generic] loc=63: postProcess patch that statically imports DocHistory into the doc route stub(s) -- The precedent for a route-stub patch that preserves chromeBindings
- $HOME/repos/myoss/zudo-doc/packages/create-zudo-doc/templates/base/pages/docs/[[...slug]].tsx [generic] loc=62: Host-owned doc route stub (before the docHistory patch) -- Shadows the package route; the seam for any static island imports
- $HOME/repos/myoss/zudo-doc/packages/create-zudo-doc/templates/base/src/styles/global.css [generic] loc=28: CSS entry with Tailwind layers and zudo-doc CSS imports plus @source globs -- The circuit template must add the runtime package's CSS import or a node_modules @source
- $HOME/repos/myoss/zudo-doc/packages/create-zudo-doc/README.md [doc] loc=: CLI and programmatic API documentation -- Line 210 onwards covers the Programmatic API; line 68 has a --name example
- $HOME/repos/myoss/zudo-doc/packages/create-zudo-doc/package.json [tooling] loc=: create-zudo-doc 5.27.0 manifest; bin create-zudo-doc; exports ./dist/api.js; node >=22 -- Deps are @clack/prompts, fs-extra, minimist, picocolors
- $HOME/repos/myoss/zudo-doc/packages/zudo-doc/src/config.ts [generic] loc=906: zudoDoc() single-entry config plus DEFAULT_SETTINGS and the ZudoDocConfig option reference -- Lines 164-251 defaults; 259-786 options; 804-906 zudoDoc
- $HOME/repos/myoss/zudo-doc/packages/zudo-doc/src/plugins/routes.ts [generic] loc=: Routes plugin: virtual modules, chromeBindingsModule resolution, package route injection -- Lines 436-470 resolveHostModuleOverride; 628-647 chrome-bindings virtual module
- $HOME/repos/myoss/zudo-doc/packages/zudo-doc/src/nav-scope/index.ts [generic] loc=99: categoryMatch prefix matching and '!' catch-all 
- $HOME/repos/myoss/zudo-doc/packages/zudo-doc/src/settings.ts [generic] loc=: HeaderNavItem, AssetViewerIndexingConfig and other settings types -- Lines 29-45 HeaderNavItem; 207-211 AssetViewerIndexingConfig
- $HOME/repos/myoss/zudo-doc/src/content/docs/guides/custom-components.mdx [doc] loc=171: mdxExtras / chromeBindingsModule / experimental islands guide -- Lines 72-76 and 151-157 contain the island warning that my probe contradicts for zfb 2.20.2
- $HOME/repos/myoss/zudo-doc/src/content/docs/guides/asset-viewer.mdx [doc] loc=269: Asset viewer config, indexing, the Asset/AssetCode MDX components, restart-on-add behavior 
- $HOME/repos/myoss/zudo-doc/src/content/docs/guides/claude-resources.mdx [doc] loc=91: claudeResources {claudeDir, projectRoot, scanRoot}; generated claude-* trees; defaultLocaleOnlyPrefixes caveat 
- $HOME/repos/myoss/zudo-doc/src/content/docs/guides/codex-resources.mdx [doc] loc=93: codexResources {codexDir, projectRoot, scanRoot}; AGENTS.md walk; .agents/skills precedence 
- $HOME/repos/myoss/zudo-doc/src/content/docs/guides/llms-txt.mdx [doc] loc=127: llms.txt / llms-full.txt behavior; says 'enabled by default', which is a scaffold default, not the runtime default 
- $HOME/repos/myoss/zudo-doc/src/content/docs/guides/header-navigation.mdx [doc] loc=: headerNav schema and categoryMatch rules 
- $HOME/repos/myoss/zudo-sg/packages/create-zudo-sg/templates/default/pages/lib/_chrome-bindings.tsx [generic] loc=23: Reference: a host shim binding package islands through chromeBindingsModule 
- planning/zudo-doc-probe/app [test-generic] loc=: Probe project generated by published create-zudo-doc 5.27.0 (installed and built; git-initialized afterwards) 
- planning/zudo-doc-probe/app-island [test-generic] loc=: Probe: package island plus mdxExtras through chromeBindingsModule; Tailwind @source test 
- planning/zudo-doc-probe/apiprobe/run.mjs [test-generic] loc=: Probe: createZudoDoc API call reproducing the CLI --yes output 