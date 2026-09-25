# zudo-circuit-doc — research and implementation seed

Prepared for Takeshi Takatsudo on **2026-09-26 (Asia/Tokyo)**.

## What this bundle is for

Build `Takazudo/zudo-circuit-doc`: a circuit-development project initializer powered by zudo-doc, following the relationship that zudo-sg has with zudo-doc. A newly initialized project should already know where circuit requirements, exact components, retained datasheet evidence, KiCad assets, design decisions, and verification results belong. A local AI agent should be able to turn “download the datasheet”, “get the 3D model”, or “check this specification” into a coherent project update.

The most useful starting point already exists in **zudo-led-lamp**. This bundle explains how to extract it, preserves selected source files for offline reading, and supplies original authoring templates and a concrete implementation sequence.

**Delivery status: research and implementation seed, not a released initializer.** There is no working `create-zudo-circuit-doc` package in this archive. Proposed package names, commands, config and paths are clearly identified as proposals. The content templates can be used in a zudo-doc project after its ordinary host setup.

## Read first

1. [START-HERE.md](START-HERE.md) — the local Claude Code / Codex handoff.
2. [design/01-product-definition.md](design/01-product-definition.md) — what the product should accomplish.
3. [design/02-architecture-and-extraction.md](design/02-architecture-and-extraction.md) — what to reuse and what to parameterize.
4. [design/03-initializer-spec.md](design/03-initializer-spec.md) — generated project and CLI behavior.
5. [design/06-implementation-plan.md](design/06-implementation-plan.md) — build order and reviewable milestones.

## Contents

| Directory | Purpose |
| --- | --- |
| `design/` | Product decisions, architecture, acquisition workflows, evidence semantics, implementation and acceptance criteria |
| `research/` | Detailed audits of zudo-sg/zudo-doc, LED evidence, generator, and CAD assets |
| `templates/` | Content-only MDX pages, agent task examples, canonical instruction draft, empty-data seeds and proposed config |
| `examples/` | Worked extraction lessons from the LED project |
| `sources/` | Exact repository pins, audited file manifest and source snapshot index |
| `references/upstream/` | Selected upstream files stored with a `.source` suffix; inert reading references, not an installed code tree |
| `scripts/` | Offline integrity verification for this bundle |
| `VALIDATION.md` | Checks performed and the remaining implementation boundary |

## Key decisions

- Reuse zudo-doc for the documentation host and zudo-sg for initializer/runtime packaging conventions.
- Extract the LED project's existing electronic-component projection core and evidence workflows. Keep the existing v1 evidence contract during the first extraction.
- Treat exact component knowledge and its web pages as two views of the same data. Do not hand-maintain a second table of datasheet values in MDX.
- Make acquisition an explicit agent operation; ordinary documentation builds read retained local evidence and never fetch or silently refresh it.
- Make zero components and zero boards a supported new-project state.
- Distinguish source availability, claim verification, project choices, unresolved bench work, CAD fidelity, and publication. A file download does not establish any of the others.
- Keep lamp-specific choices and historical fixtures in a reference fixture; do not seed a new circuit with a 15 V supply, specific MCU, LED topology, or manufacturing provider.

## Using this with a local agent

Place the unzipped folder beside the local `zudo-circuit-doc` checkout or inside a clearly named planning folder. Give the agent:

> Read zudo-circuit-doc-seed/START-HERE.md and the linked design documents. Implement the extraction in this repository, beginning with the pinned upstream comparison and the empty-project milestone. Preserve the existing evidence contract, use the supplied source manifest and templates, and report concrete validation results at each milestone. Continue until a newly generated project builds and the first exact component can complete the documented workflow.

Do not run proposed npm commands until the local agent has built and tested the packages. No repository was changed, no issue or PR was created, and no package was published during preparation of this seed.

## Source baseline

| Repository | Reviewed commit / state |
| --- | --- |
| [Takazudo/zudo-circuit-doc](https://github.com/Takazudo/zudo-circuit-doc) | Empty repository, default branch metadata `main`, at inspection |
| [Takazudo/zudo-led-lamp](https://github.com/Takazudo/zudo-led-lamp/tree/194d8a297e3545588197342130c3111a66c10973) | `194d8a297e3545588197342130c3111a66c10973` |
| [Takazudo/zudo-sg](https://github.com/Takazudo/zudo-sg/tree/b9b36ce35d98d6abc641d84e8535552eac0dbded) | `b9b36ce35d98d6abc641d84e8535552eac0dbded` |
| [zudolab/zudo-doc](https://github.com/zudolab/zudo-doc/tree/6a10f764181cd9f73059d4bf523e3673983859d8) | `6a10f764181cd9f73059d4bf523e3673983859d8` |

These are research pins, not a claim that all upstream branches will remain at those revisions. See [sources/repositories.json](sources/repositories.json) and the detailed research reports for observed versions and source locations.
