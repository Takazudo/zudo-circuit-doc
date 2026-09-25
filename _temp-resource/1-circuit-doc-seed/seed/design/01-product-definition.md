# Product definition

## Purpose

`zudo-circuit-doc` should initialize a repository in which circuit development can begin immediately: write the idea, research components, retain the primary evidence, obtain KiCad assets, document design choices, and progressively verify the circuit.

The distinctive feature is the **working agreement between a project and its AI agents**. The project knows how to complete a request, where its result belongs, and which parts remain uncertain. The web documentation makes that accumulated knowledge easy to inspect.

This follows the user's proposed relationship: zudo-doc supplies the documentation framework; zudo-circuit-doc adds circuit-development conventions and tools, as zudo-sg adds styleguide capabilities. The inspected zudo-sg uses `packages/create-zudo-sg` plus `packages/styleguide`; the LED project already owns a circuit evidence/projection system. [zudo-sg packages](https://github.com/Takazudo/zudo-sg/tree/b9b36ce35d98d6abc641d84e8535552eac0dbded/packages), [LED adoption guide](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/src/content/docs/how-to/component-docs-adoption.mdx).

## Three everyday requests

| User request | Complete project result |
| --- | --- |
| “Download this component's datasheet.” | Resolve exact part; retain the relevant source/revision; record origin, date, hash and availability; extract needed claims with page/section context; update source references and docs; report blocked evidence honestly |
| “Download the 3D data.” | Resolve exact package/variant; acquire available model files; retain origin and original bytes; establish whether exact/family/derived; associate the KiCad footprint; record alignment/dimensions and remaining checks; update selected preview |
| “Check whether this spec is correct.” | Find the exact claim and its dependencies; read the retained or refreshed primary evidence; compare condition/type/unit/revision; check pin/net/project use where relevant; record conclusion and remaining bench work; regenerate affected docs |

A short task request should not require the user to restate the file layout, preferred source hierarchy, component identity convention, source-hash procedure or meaning of “verified” every time.

## Users and authoring model

The first user is a developer comfortable with files, git and AI agents. Repository files remain editable. A database server or account is not a prerequisite. Use Markdown/MDX for authored explanation and the existing structured evidence format for precise component knowledge. The site is a readable projection; it must not become the only place to recover the design.

A candidate is allowed to exist before selection. A component may be selected while a source is unavailable. A footprint can be usable while its model is only a family approximation. An electrical claim can be source-confirmed while behavior on the actual board still needs measurement. Preserve these distinctions.

## V0.1 scope

| Capability | First-release expectation |
| --- | --- |
| Project initialization | pnpm-based zudo-doc host, docs, circuit config, canonical workflow entry point, empty project state |
| Component onboarding | Reusable exact-identity and evidence workflow, standalone/subordinate records |
| Datasheet/source retention | Explicit acquisition and refresh with provenance, minimal extracts, blocked-source state |
| Evidence audit | Existing v1 fact semantics and canonical validation, decoupled from lamp board generators |
| Documentation | Catalog, record pages, integration findings, references and honest open states |
| CAD handling | Existing footprint/model conventions, source association, reviewed previews, fidelity labels |
| Project reasoning | Requirements, architecture, alternatives, decisions, changes, sourcing and verification templates |
| Agent use | One canonical workflow with thin Claude Code/Codex entry points |
| Portability | Empty, one-component and unrelated circuit fixtures; packed consumer works outside repo |

## Later extensions

Keep manufacturer-specific acquisition helpers, simulation integration, firmware toolchains, JLCPCB export profiles, shared component libraries, bench-data import and richer 3D formats as separate extensions. The LED project's board generators, enclosure generator, manufacturing exports and production choices can inform them without becoming initializer defaults.

Do not make the first release depend on automated schematic generation. KiCad files may be hand-authored, script-generated or imported. Inventory extraction must expose that as a provider choice.

## Product behavior worth preserving

The LED project already routes circuit/BOM/firmware work through exact component owners and cross-component integration rules. It also centralizes adding/replacing a part, including evidence, KiCad assets, publication, previews and checks. Preserve that connected workflow while replacing its concrete part list with project configuration. [Root routing](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/CLAUDE.md), [new component workflow](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/new-component-workflow.md).

## Observable success

Starting from an empty directory, the user can initialize the project, open its docs, state an idea, and ask an agent to research the first component. After that task, another agent can understand the part choice and the evidence without the original conversation. A second component and a different circuit type work without editing package internals.

That is the practical test of whether this project has captured the useful part of the LED workflow.
