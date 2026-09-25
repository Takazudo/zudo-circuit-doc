# Reusable seed templates

These are inspectable starting resources for the local implementation.

| Resource | Status |
| --- | --- |
| [project-docs/README.md](project-docs/README.md) and ten MDX pages | Content-only pages using inspected zudo-doc frontmatter |
| [agent-task-examples.md](agent-task-examples.md) | Nine English/Japanese request pairs |
| [project-agent-instructions.md](project-agent-instructions.md) | Canonical workflow instruction draft, not an installed skill |
| [circuit.config.proposed.ts](circuit.config.proposed.ts) | Proposed config shape, not consumed by an existing runtime |
| [empty-data/README.md](empty-data/README.md) and three JSON files | Existing data-shape seeds; generic loader/validator extraction still required |

Begin with only the project brief, architecture overview and next-actions page. Use the other authored templates when those activities occur. A new project has no preselected circuit, supplier, voltage, board count or verified component.

The upstream eight-file component-bundle template is preserved separately as inert source material and includes deliberate fake example values. Its source manifest and cautions are described in [empty-data/README.md](empty-data/README.md). It is not part of the live empty seed.
