# zudo-sg / zudo-doc architecture research for zudo-circuit-doc

Research snapshot: 2026-09-26, Asia/Tokyo. This report distinguishes observed implementation from proposed circuit adaptation. All repository URLs below are pinned to the inspected commit. The companion `sg-sources.json` records the full source set and blob SHAs.

## 1. Architectural conclusion

The closest reusable pattern is a **small initializer that creates a project-owned circuit workspace on top of the published zudo-doc package**, with shared circuit validation and rendering extracted into a domain package when those features justify it. The initial product need is the repeatable working environment: project context, component records, evidence, datasheets, CAD assets, decisions, verification records, and short instructions that route an AI agent to the right files. A separate browser application or a fork of the documentation framework is unnecessary to establish that environment.

This is consistent with what zudo-sg actually does. Its initializer ships a small host, while its installable engine supplies the domain capabilities. The generated host owns configuration, component sources, stories and documentation; zudo-doc supplies the general documentation framework. The zudo-sg demo component library is explicitly a showcase belonging to its own repository and is not installed by the initializer. [zudo-sg README](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/README.md), [monorepo architecture](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/doc/src/content/docs/architecture/monorepo-layout.mdx).

For zudo-circuit-doc, the corresponding boundary should be:

| Layer | Owns | Should remain project-owned |
|---|---|---|
| `@takazudo/zudo-doc` | Documentation layout, navigation, content rendering, search, resource mirrors, asset viewer, optional history | Site identity and selected options |
| Proposed `create-zudo-circuit-doc` | Initial project layout, bootstrap choices, seed documents and workflow entry points | Files copied at project creation become the project's editable source |
| Proposed `@takazudo/zudo-circuit-doc` | Versioned record schemas, validation commands, optional generated indexes and shared presentational components | Component records, local evidence and all design decisions |
| Each circuit project | Requirements, parts, references, CAD, BOM, calculations, experiments and release records | Everything specific to that circuit |

These circuit package names and commands are proposals, not existing published APIs. For the first local implementation, a single initializer plus local scripts is viable. The second package should contain genuinely shared behavior, not empty abstractions added solely to reproduce zudo-sg's number of packages.

## 2. Source and version baseline

| Repository | Commit inspected | Observed package metadata |
|---|---|---|
| `Takazudo/zudo-sg` | `b9b36ce35d98d6abc641d84e8535552eac0dbded` | `create-zudo-sg` 0.1.8; `@takazudo/zudo-sg` 0.3.6 |
| `zudolab/zudo-doc` | `6a10f764181cd9f73059d4bf523e3673983859d8` | `create-zudo-doc` 5.27.0 |

The inspected zudo-sg starter pins `@takazudo/zudo-doc` 5.27.0, `@takazudo/zfb`, `@takazudo/zfb-runtime` and `@takazudo/zfb-md-wasm` 2.20.3, and `pnpm@11.5.2`. It depends on `@takazudo/zudo-sg` using `^0.3.6`. Both initializer packages declare Node.js 22 or newer. These are repository observations, not independent verification of the npm registry's current publication state. [SG initializer package](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/packages/create-zudo-sg/package.json), [SG engine package](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/packages/styleguide/package.json), [starter dependencies](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/packages/create-zudo-sg/templates/default/package.json), [zudo-doc initializer package](https://github.com/zudolab/zudo-doc/blob/6a10f764181cd9f73059d4bf523e3673983859d8/packages/create-zudo-doc/package.json).

The public zudo-doc site still has some examples importing `defineConfig` from `zfb/config`, while the current SG starter imports it from `@takazudo/zfb/config`. Follow the actual dependencies and exports in the selected baseline and exercise a foreign generated project before shipping. Do not mix snippets from several generations of the framework.

## 3. What create-zudo-sg actually initializes

The current documented sequence is:

```sh
pnpm create zudo-sg@latest my-styleguide
cd my-styleguide
pnpm install
pnpm gen-registry
pnpm gen-token-manifest
pnpm dev
```

The initializer defaults to **no install**. `--install` opts into running `pnpm install`; npm, yarn and a `--pm` mode are not implemented in this initializer. A directory argument can be prompted for in a TTY. `--yes` suppresses the prompt and requires an explicit directory. `--name` changes the generated package name. The implementation validates the name, requires an absent or empty destination, copies its embedded template, renames `_gitignore` to `.gitignore`, and substitutes `__PROJECT_NAME__` in the generated package manifest. It does not fetch the repository at runtime. [Initializer README](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/packages/create-zudo-sg/README.md), [CLI implementation](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/packages/create-zudo-sg/src/cli.ts), [scaffolder](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/packages/create-zudo-sg/src/scaffold.ts).

The generated project is private. Its scripts are `dev`, `build`, `check`, `gen-registry` and `gen-token-manifest`; generator invocations call the installed `zudo-sg` binary. The initial corpus is local `ui/` source, not `@zudo-sg/demo-ui`. The manifest and registry are reproducible views of that corpus. The starter config contains local source roots, output paths and stylesheet entry points, so a user can extend the project without changing the engine. [Starter package](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/packages/create-zudo-sg/templates/default/package.json), [starter domain config](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/packages/create-zudo-sg/templates/default/zudo-sg.config.mjs).

### Template maintenance is an executable contract

`fixtures/engine-host` is the working source fixture. `scripts/sync-create-zudo-sg-template.mjs` transforms it into `packages/create-zudo-sg/templates/default`; `--check` reports missing, extra and changed files without writing. Transformations include substituting the package name, changing the fixture base URL to `/`, replacing the workspace engine dependency with the released version, translating the ignore file and deriving release-age exemptions from package metadata. It excludes build output, installed dependencies, temporary zfb files and the fixture lockfile. [Template sync implementation](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/scripts/sync-create-zudo-sg-template.mjs).

The circuit equivalent should therefore have one exercised minimal circuit fixture, with the initializer's seed tree generated from it or compared with it mechanically. Maintaining separate hand-edited copies of a demo, a template and an example invites drift. A substantive initial fixture might contain one placeholder part and one synthetic observation with clear sample status; the real LED lamp records belong in an optional worked example.

### Concrete drift to avoid copying

At the inspected commit, `packages/create-zudo-sg/package.json` declares 0.1.8 but `src/cli.ts` exports `VERSION = "0.1.0"`, and `--version` prints that constant. This is a source-level mismatch; I did not execute the package to measure the published binary. A circuit initializer should derive its reported version from one package metadata source or assert equality during release verification. [CLI constant and version handling](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/packages/create-zudo-sg/src/cli.ts), [package version](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/packages/create-zudo-sg/package.json).

## 4. How zudo-sg extends zudo-doc

The current starter composition is structurally:

```ts
import { defineConfig } from "@takazudo/zfb/config";
import { zudoDoc } from "@takazudo/zudo-doc/config";
import { withZudoSg } from "@takazudo/zudo-sg/config";
import zudoSgConfig from "./zudo-sg.config.mjs";

export default defineConfig(
  withZudoSg(zudoDoc({ /* host documentation choices */ }), zudoSgConfig),
);
```

`withZudoSg` appends the engine's plugins and collections after zudo-doc's. It also supplies default domain navigation when the host has no navigation and installs the preview token panel trigger unless disabled. The configuration module is intentionally data-only: no Node imports, because zfb evaluates its config in a node-free environment. File-system checks occur in the relevant plugin setup. [Starter config](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/packages/create-zudo-sg/templates/default/zfb.config.ts), [composition implementation](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/packages/styleguide/src/config/index.ts).

The engine owns its catalog, detail, preview and token routes. It ships compiled library code in `dist/`, TSX route entrypoints under `routes-src/`, virtual-module declarations, CSS and a CLI. The TSX route form matters because the zfb route process extracts `paths()` from source. The ADR records several older staging and island workarounds and explicitly marks some as retired; those older workarounds are not a recommendation to reproduce them. [Engine package exports](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/packages/styleguide/package.json), [architecture](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/doc/src/content/docs/architecture/monorepo-layout.mdx), [engine ADR](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/docs/adr/styleguide-engine.md).

**Circuit adaptation:** begin with ordinary MDX pages and generated Markdown tables. A data registry, schema validator and asset manifest do not require custom routes. Introduce `withZudoCircuitDoc(...)` only if there is real shared build behavior, such as validating circuit records and generating an index. If introduced, preserve zudo-doc's config result and append only the circuit-owned collection/plugin entries. Read files in plugin hooks or the Node CLI, not in the node-free composition module. A v1 circuit page should not inherit SG-specific preview CSS, CodeMirror editors, token dashboards, catalog chrome, story schemas or the demo UI dependency.

## 5. zudo-doc already covers much of the requested base

### 5.1 Small host and package-owned framework

The current zudo-doc installation model keeps a small host: `zfb.config.ts`, content under `src/content/docs`, global CSS imports, package/TypeScript configuration and thin route entry points. Header, sidebar, TOC, navigation builders, schema defaults and general UI live in the installed package. This is the correct foundation for generated circuit projects. The full upstream monorepo is a framework development environment, not the template every circuit project needs. [Installation guide](https://zudo-doc.takazudomodular.com/docs/getting-started/installation/), [actual current config implementation](https://github.com/zudolab/zudo-doc/blob/6a10f764181cd9f73059d4bf523e3673983859d8/packages/zudo-doc/src/config.ts).

### 5.2 Upstream initializer reuse options

`create-zudo-doc` exports a public `createZudoDoc(options)` function. It accepts language, color choices, feature names, package manager and optional `install`/`git`. The programmatic defaults for install and Git initialization are false. It validates selections before invoking the scaffolder. However, this API has no independent destination property: `projectName` also supplies the output directory. The CLI accepts a destination path separately from `--name`. [Programmatic API](https://github.com/zudolab/zudo-doc/blob/6a10f764181cd9f73059d4bf523e3673983859d8/packages/create-zudo-doc/src/api.ts), [CLI options](https://github.com/zudolab/zudo-doc/blob/6a10f764181cd9f73059d4bf523e3673983859d8/packages/create-zudo-doc/README.md).

For an initial local implementation, choose one explicit integration contract:

1. **Pinned upstream CLI plus circuit overlay.** Invoke a fixed tested `create-zudo-doc` version noninteractively, then apply the circuit-owned files and config. This supports arbitrary destinations through the upstream CLI. Plan the complete output before writing and keep install/Git behavior explicit.
2. **Fixture-derived small scaffold, like create-zudo-sg.** Ship a known working template against exact upstream dependency versions and maintain it with drift checks. This avoids runtime dependence on the upstream initializer and is the closest mechanical match to SG.
3. **Published programmatic API.** Useful if the output location constraint is acceptable or an upstream destination option is added. Avoid calling unpublished internal modules or changing process-wide working directories in concurrent scaffold operations.

The first two both suit the user's goal. A documented choice and a generated-project check matter more than the initial packaging preference.

### 5.3 Files, PDFs and diagrams

zudo-doc's Asset Viewer is already an asset browsing and presentation layer. Files under `public/assets` receive raw URLs and contextual viewer URLs under `/files`. It provides a file tree, downloads, metadata and document back-links. Supported presentations include code/text, images, video and browser PDF embeds; other formats get a download panel. Optional `<file>.meta.json` sidecars provide `title` and `description`. Those sidecars are not a circuit provenance schema. [Asset Viewer source](https://github.com/zudolab/zudo-doc/blob/6a10f764181cd9f73059d4bf523e3673983859d8/src/content/docs/guides/asset-viewer.mdx).

Use a richer circuit-owned evidence manifest for manufacturer, exact part number, document revision, retrieval date, original URL, checksum, local path, file role and verification status. Generate the small zudo-doc sidecars from the title/description subset when publishing an asset. This keeps one canonical record while using the existing presentation machinery.

Native STEP/STL/IGES/KiCad rendering is not claimed by the inspected Asset Viewer guide. A suitable first implementation downloads and records the real CAD asset, links it for use in KiCad and optionally publishes an explicitly derived PNG/SVG preview. Downloaded, hash-recorded, package-matched, pinout-checked and mechanically checked are different states; an available 3D model must not automatically imply a verified footprint.

Two operational details affect the circuit workflow:

- `assetViewerExclude` suppresses viewer generation and listing; it does **not** remove the raw public file. Keep research archives outside `public/` and copy only deliberately selected publication assets into the public tree.
- The asset plugin's watch set is enumerated at startup. Editing an existing asset refreshes it, but adding/removing/renaming assets or adding the first document reference requires restarting the dev server. The workflow instructions should mention this concrete behavior when an agent acquires a new datasheet or diagram.

Asset pages are excluded from search, `llms.txt` and sitemap by default unless explicitly enabled through `assetViewerIndexing`. Even when enabled, binary assets appear as metadata stubs, not extracted datasheet text. Therefore PDF extraction, quoted page evidence and part/spec verification are still circuit features to add. [Asset configuration, indexing and development behavior](https://github.com/zudolab/zudo-doc/blob/6a10f764181cd9f73059d4bf523e3673983859d8/src/content/docs/guides/asset-viewer.mdx).

### 5.4 Claude Code and Codex resource mirrors

zudo-doc already mirrors `CLAUDE.md`, Claude commands, skills and agents into generated documentation. Its Codex integration mirrors `AGENTS.md`/`AGENTS.override.md`, profiles, agents, hooks, rules and skills. Both support a repository-wide `scanRoot`, which fits a circuit repository whose documentation app lives in `doc/`. Generated resource pages are recreated during builds and must not be treated as editable source. [Claude resources](https://github.com/zudolab/zudo-doc/blob/6a10f764181cd9f73059d4bf523e3673983859d8/src/content/docs/guides/claude-resources.mdx), [Codex resources](https://github.com/zudolab/zudo-doc/blob/6a10f764181cd9f73059d4bf523e3673983859d8/src/content/docs/guides/codex-resources.mdx), [SG docs workspace example](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/doc/zfb.config.ts).

For the seed, keep the substantive circuit procedures in canonical plain Markdown. Small `AGENTS.md` and `CLAUDE.md` entry points can direct each agent to the same procedures, current project summary and records. If the local implementation later installs skills, maintain the source once and wire it into each agent's supported location. Avoid copying long, almost-identical policy text into two agent-specific files. The important new knowledge is the circuit task procedure and evidence contract, not resource mirroring itself.

### 5.5 LLM-facing output is navigation, not automatic verification

`llmsTxt` provides documentation index/full-text outputs. This is useful for another agent to find the circuit docs, but it does not check component claims, parse a PDF electrically, inspect KiCad or verify a mechanical assembly. Keep a short current-state document for active work and durable supporting records for details. [llms source guide](https://github.com/zudolab/zudo-doc/blob/6a10f764181cd9f73059d4bf523e3673983859d8/src/content/docs/guides/llms-txt.mdx).

Defaults differ across documentation and entrypoints: the inspected runtime config has `llmsTxt: false` and `assetViewer: false`, while the initializer README advertises these features on by default and the llms guide says enabled by default. This is partly a runtime-vs-scaffold distinction and partly confusing guide wording. Set the circuit preset's selected features explicitly instead of relying on undocumented assumptions. [Runtime defaults](https://github.com/zudolab/zudo-doc/blob/6a10f764181cd9f73059d4bf523e3673983859d8/packages/zudo-doc/src/config.ts), [initializer defaults](https://github.com/zudolab/zudo-doc/blob/6a10f764181cd9f73059d4bf523e3673983859d8/packages/create-zudo-doc/README.md).

### 5.6 Shared components can be added gradually

For a first custom part/spec/evidence component, per-file MDX import is sufficient. Shared presentational components can be registered via `defineChromeBindings({ mdxExtras: ... })` and `chromeBindingsModule`. The current guide explicitly separates presentational SSR components from experimental client islands; an MDX import alone does not guarantee hydration. The scaffold expects `className` in project TSX. [Custom component guide](https://github.com/zudolab/zudo-doc/blob/6a10f764181cd9f73059d4bf523e3673983859d8/src/content/docs/guides/custom-components.mdx).

Circuit tables and evidence cards should initially render without client state. Filters, 3D previews or editable BOM screens can be introduced later with a built-site hydration check. This keeps the first deliverable useful even before a richer UI exists.

## 6. Circuit-specific work that remains

These are proposed responsibilities extracted from the user's intended workflow, not claims that upstream implements them:

| User request | New circuit procedure/data | Existing framework support |
|---|---|---|
| “Download the datasheet” | Resolve exact manufacturer/MPN; identify primary source and revision; download and hash; record retrieval result; optionally extract selected text with page references | Asset download link, PDF presentation, source documentation |
| “Download 3D data” | Resolve package variant and source; record format, units, license/provenance and verification state; inspect orientation and package dimensions separately | File download and optional static preview |
| “Check whether this spec is correct” | Store claim, units, conditions, datasheet section/page, interpretation and verdict; separate absolute maximum from recommended operation | MDX tables, math and evidence links |
| “Use the same format in another project” | Initial context, empty inventories, evidence/decision/experiment templates and one coherent workflow | zudo-doc starter and package-owned site framework |
| “Continue the development” | Current-state summary, pending questions, decision records, tasks and links to authoritative design files | Search, navigation, history and agent-resource mirrors |

The evidence fields should preserve disagreement and uncertainty. A validator can check shape, paths, hashes, duplicate IDs and missing required references; it should not label an electrical design correct merely because the JSON is valid. Specification verification, ERC/DRC, bench tests and human design acceptance need their own evidence and outcomes.

## 7. Update model and compatibility plan

The inspected create-zudo-sg scaffolder is a create-only tool: it rejects nonempty output directories. No update/migration subcommand appears in the inspected CLI surface. Shared engine behavior updates through the dependency, while copied host files remain owned by the generated project. The circuit initializer should state that contract equally clearly. [Create-only CLI](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/packages/create-zudo-sg/src/cli.ts), [destination guard](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/packages/create-zudo-sg/src/scaffold.ts).

Recommended circuit policy:

1. Store the initializer version, schema version, selected preset and tested upstream dependency baseline in project metadata.
2. Keep circuit records and downloaded assets as project source. Generated summaries/indexes must be reproducible and clearly marked.
3. Upgrade package behavior through ordinary dependency changes and a committed lockfile.
4. Apply schema/template changes through explicit, reviewable migrations. A migration should not rewrite authored design decisions or replace downloaded evidence silently.
5. Test a packed initializer in a directory outside the source workspace. This catches missing template files, workspace-only imports and unpublished dependency assumptions.

The foreign-install test is particularly relevant because SG deliberately verifies its packed engine and generated starter, not only its workspace host. A circuit fixture should exercise both an empty start and a small populated case with a valid asset, a deliberately unresolved evidence claim and generated documentation. The required check is that the unresolved claim remains visible and the build never upgrades its status. [SG release workflow](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/packages/styleguide/RELEASE.md), [initializer README verification guidance](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/packages/create-zudo-sg/README.md).

## 8. Suggested implementation order for the local agent

1. Select one pinned zudo-doc baseline and one initializer integration strategy; record the choice in an ADR.
2. Make a minimal project with Japanese-first content, explicit asset/LLM/agent-resource settings and ordinary MDX navigation.
3. Add the circuit data directory, schema, evidence rules, human-editable templates and current-state entry document.
4. Add deterministic local checks for IDs, references, paths, expected file formats and checksums. Keep findings as findings; do not infer design correctness.
5. Import a small, explicitly sourced LED lamp example to prove the format, separating historical facts from example placeholders.
6. Generate a component/evidence index into documentation and reuse zudo-doc's assets UI for selected public previews.
7. Package the initializer from the exercised fixture and check the packed artifact in a clean external directory.
8. Add shared circuit rendering, optional CAD previews and migrations only when the working project demonstrates the need.

No remote repositories were modified during this research. No zudo-sg/zudo-doc package installation, full build or browser execution was performed by this subtask. Source-level observations and proposed design recommendations are intentionally separate.
