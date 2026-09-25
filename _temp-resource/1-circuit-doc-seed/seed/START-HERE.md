# Local implementation handoff

## Intended outcome

Create a reusable **circuit development initializer powered by zudo-doc**, using the architecture of zudo-sg and the working circuit knowledge system in zudo-led-lamp. A new project must open as useful documentation before it contains any component, board, KiCad model, or firmware.

The user is a software engineer who already works with pnpm, git, Claude Code, Codex, KiCad and zudo-doc. Optimize for an inspectable repository and short task requests. The user will develop the circuit in that repository after initialization.

## Read in this order

1. [Product definition](design/01-product-definition.md)
2. [Architecture and extraction](design/02-architecture-and-extraction.md)
3. [Initializer specification](design/03-initializer-spec.md)
4. [Evidence semantics](design/05-evidence-and-publication.md)
5. [Implementation milestones](design/06-implementation-plan.md)
6. [Acceptance scenarios](design/07-validation-acceptance.md)
7. The four reports in [research](research/README.md), then the upstream files they identify

Use [sources/repositories.json](sources/repositories.json) as the reproducible research baseline. Resolve the current heads separately. If current upstream fixes a documented problem, record that and adopt the fix; do not downgrade it to match an old audit. Keep the extraction baseline explicit.

## What is already known

- The destination repository was empty during this research.
- zudo-sg has a separate initializer package and domain runtime package.
- zudo-doc already provides the documentation host, MDX, asset pages, history, search, and Claude/Codex resource publication facilities.
- zudo-led-lamp contains `doc/component-docs/core/`, a separate circuit adapter, publication rules, deterministic generation, footprint and WRL previews, an evidence contract, a Python validator, and component onboarding instructions.
- The LED project has an adoption guide which already anticipates package extraction.
- The stock LED adapter/validator is **not** an empty-project scaffold: board names, record sets, source counts, model counts, package paths, scanner thresholds and fixture locks are coupled to that project.

Source: [LED adoption guide](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/src/content/docs/how-to/component-docs-adoption.mdx), [zudo-sg initializer package](https://github.com/Takazudo/zudo-sg/blob/b9b36ce35d98d6abc641d84e8535552eac0dbded/packages/create-zudo-sg/package.json).

## Implementation rules for this handoff

1. **Extract before redesigning.** Preserve the existing v1 record/source/fact/coverage/routing/interaction/pin-map semantics. Do not translate to an invented parallel database in the first release.
2. **Keep package and project ownership distinct.** Runtime, renderer and reusable validation code belong to the package; project decisions, board inventory, source locks and evidence belong to each generated project.
3. **Implement a real empty state.** Zero records is valid; a missing required file, broken source lock or omitted selected record remains an error. Do not disguise failures as an empty catalog.
4. **Preserve truthful statuses.** No generated page may promote distributor identity, typical data, family CAD, inaccessible sources or open bench questions into confirmed exact-part performance.
5. **Use offline validation during builds.** Retrieval, refresh and CAD acquisition happen through explicit agent tasks; generation projects the retained result.
6. **Preserve host extensions during updates.** Do not blindly overwrite zudo-doc config, document routes, browser-island imports, project MDX or existing agent instructions.
7. **No installation of the archived references.** Files ending `.source` are evidence for this handoff. Obtain complete source trees at the pinned commits before extracting code.
8. **Treat proposed names as proposals.** Check npm package ownership/availability and current upstream APIs before publishing. This seed does not claim either is established.
9. **Keep engineering scope separate from implementation scope.** The example lamp is a fixture. No circuit design or component substitution is authorized merely because a documentation extraction needs a green check.

For source-preserving extraction, obey existing repository instructions and license notices. Retain provenance. This seed is not an upstream patch and carries no substitute license grant for third-party datasheets, CAD models or code.

## First concrete deliverable

Implement only enough packaging and configuration to create a new project, start its zudo-doc host, build an honest empty component catalog, and show the authoring templates. Test that in a temporary consumer **outside the monorepo**, using packed package tarballs. A monorepo workspace resolving unpublished paths is insufficient evidence that the initializer works.

Do not start by building a circuit editor, cloud component service, chat UI, a new schema language, or a general-purpose CAD converter. Existing local agents and KiCad remain the working tools.

## Next deliverables

- Add one exact component through the documented workflow.
- Retain a source and extract, record facts with units/conditions/locators, and run canonical validation.
- Keep missing or blocked retrieval explicit.
- Import or associate symbol/footprint/model files with documented fidelity.
- Generate the record page and available previews from retained data.
- Verify that a modification invalidates the right facts/previews and affects only owned generated output.
- Confirm that Claude Code and Codex enter through a shared workflow without two divergent instructions.
- Run the LED corpus as a regression fixture and a small unrelated circuit as the portability test.

## Suggested first response from the local agent

Report the current repository state, verified source revisions, the chosen package layout, the first extraction seam, and the exact command/test planned for the empty consumer. Then implement it. Use [design/06-implementation-plan.md](design/06-implementation-plan.md) as the work queue, updating it with actual outcomes rather than treating it as a fixed script.

## Definition of complete for the first release

The release checklist in [design/07-validation-acceptance.md](design/07-validation-acceptance.md) passes for an empty new project, a one-component project and the retained LED regression fixture. Documentation clearly states which operations need external tools or credentials and which capabilities are optional. npm tarballs include their required templates/assets and resolve every runtime import outside the source checkout.

The current archive is preparation for that implementation. Its validation report covers the seed's files and provenance, not those future runtime behaviors.
