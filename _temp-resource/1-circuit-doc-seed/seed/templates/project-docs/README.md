# Circuit project authoring templates

These are **content-only seed pages** for a future project initialized with zudo-circuit-doc and hosted by zudo-doc. They are not an application, an initializer implementation, a completed circuit design, or the LED lamp's documentation copied into a new project.

Copy the `.mdx` files into the initialized project's authored documentation directory, preserving the relative paths. In the LED reference project that directory is `doc/src/content/docs/`; the eventual initializer should own the actual location. The seed uses only Markdown, MDX-compatible frontmatter, and local document links. It requires no custom components. Titles, descriptions, and `sidebar_position` follow the inspected LED site's frontmatter shape.

## Start with three pages

| Page | When to use it | What to enter |
|---|---|---|
| `index.mdx` | First session | Purpose, user behavior, constraints, current design revision |
| `architecture/overview.mdx` | First planning session | Functional blocks, operating states, unconfirmed boundaries |
| `workflow/next-actions.mdx` | First session and every handoff | Current unanswered questions, exact next task, dependencies |
| `architecture/interfaces.mdx` | Once blocks or connectors are proposed | Power, signal, mechanical and programming boundaries |
| `research/component-candidate.mdx` | When comparing or researching a component | Research question, criteria, linked canonical evidence, missing proof |
| `decisions/decision.mdx` | When making a consequential choice | Alternatives, chosen direction, tradeoffs, evidence and conditions |
| `decisions/sourcing.mdx` | When assembly or procurement becomes relevant | Population policy, cost reasoning, dated sourcing observations |
| `verification/bring-up.mdx` | Before performing a specific verification | Revision, setup, planned checks, results and limits |
| `workflow/change-impact.mdx` | Before applying a change with downstream effects | Affected components, interfaces, generated assets and tests |
| `workflow/task-request.mdx` | When delegating a bounded research or implementation task | Goal, scope, references, outputs and a definition of done |

The initial information architecture has five section folders: architecture, research, decisions, verification, and workflow. Keep it small. Add repeated component research, decision, or verification pages as the project needs them; do not publish empty copies merely to fill navigation.

For repeated records, duplicate the relevant page and give it a topic-specific filename, title, and ordering value. A decision ID identifies a decision across edits; its filename need not become its identity. A verification report identifies one execution against a particular revision; do not overwrite a failed run with the later successful run.

## Authored rationale and generated records

The **component evidence bundle** is the authoritative home for exact part identity, source documents, retained facts, qualification conditions, KiCad asset provenance, and verification coverage. This phrase is intentionally independent of a final storage path; use the storage contract adopted during local implementation.

These MDX pages explain the project: what it should do, why a part or architecture was considered, why a decision was made, and what remains to be tested. They refer to stable record, fact, calculation, asset, and report IDs in the component evidence bundle. Once generated routes exist, replace textual references with links to them.

Do not maintain a second full pin table, rating table, source inventory, or component catalog by hand in these pages. If an argument needs a numeric value, cite its canonical fact and retain its qualifier and conditions. A contextual excerpt should be traceable and checked when that fact changes. A generated catalog is regenerated from evidence records; editing its MDX output directly creates an untracked fork.

The examples are unfilled. “Not entered,” “unreviewed,” and “not run” do not represent component facts, approvals, or completed tests. Remove instructional text as the project becomes concrete. No component selection, electrical limit, board count, MCU, supplier, or manufacturing method is preselected here.

## Good first handoff

1. Fill the project brief from the owner's actual intent and mark unknowns.
2. Draft the functional blocks without selecting parts merely to complete a diagram.
3. Put the three most consequential uncertainties in next actions.
4. Choose one bounded research task and use the task-request page or the bilingual examples in `../agent-task-examples.md`.
5. After evidence exists, write the rationale and link it to the records. Publish generated component pages only according to the local project's publication policy.

## Reference basis

These templates are original generalizations of workflow observed at the pinned LED project revision. The references justify the documentation structure; they do not transfer that project's electrical decisions or verify any new project.

- [Root routing and exact component ownership](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/CLAUDE.md): component identity and interaction evidence must be considered together.
- [Decision rationale](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/src/content/docs/architecture/decisions.mdx): preserve reasons for accepting and rejecting alternatives.
- [BOM rationale](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/src/content/docs/architecture/bom.mdx): authored sourcing reasoning is distinct from canonical component records, and supply information is dated.
- [Next steps and bring-up](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/src/content/docs/architecture/next-steps.mdx): distinguish document evidence, conditioned analysis, future hardware tests, and changes that reopen earlier conclusions.
