# Empty-data seeds

These JSON files are **data-shape seeds**, not a runnable project. The unchanged LED CLI cannot validate/build a new empty project because it loads fixed board generators, pin fixtures, integration domains and package-count requirements.

| File | Basis | Where the proposed initializer places it |
| --- | --- | --- |
| `inventory.json` | Existing v1 inventory shape with zero real lines | Configured inventory path |
| `integration-rules.json` | Existing rules envelope with zero rules | Configured integration rules path |
| `publication-selection.json` | Existing TypeScript InstanceSelection object serialized as JSON | Project-owned publication selection |

The local implementation must add a config loader and a generic/manual provider before consuming these. JSON parsing alone does not demonstrate compatibility with the complete validator.

An empty inventory is intentional. Do not populate it with the upstream component template's EXAMPLE-MPN, C000000, example.invalid or zero-hash demonstration entries. The unmodified upstream eight-file component template is retained as inert `.source` reference files under `references/upstream/led/.claude/skills/component-spec-audit/assets/component-skill-template/`.

Empty integration rules do not prove circuit safety. They mean the project has not declared a cross-component rule yet. Empty publication selection means no component record/source is selected for public projection.

No preview manifest is included here: its exact generalized zero-state contract is part of the extraction work. Reusing the lamp's 25-package manifest would misrepresent a new project.
