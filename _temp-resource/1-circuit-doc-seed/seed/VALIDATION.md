# Seed validation and implementation boundary

Prepared on 2026-09-26 Japan time. This report covers the research/seed archive, not a released initializer.

## Checks completed for this deliverable

| Check | Result / scope |
| --- | --- |
| Source provenance | 174 unique pinned source references; all 174 archived snapshots match original Git blob SHA-1, recorded SHA-256 and byte length |
| Repository baseline | LED, zudo-sg and zudo-doc commits retained; destination confirmed empty at inspection |
| Source archive handling | Original bytes retained with inert `.source` suffix; no active skills installed |
| JSON files | Parsed successfully; consolidated manifests and three empty-data seeds included |
| Empty-data shapes | Inventory/rules/selection envelopes checked against inspected upstream structures |
| Authored MDX templates | Ten pages; required frontmatter present, local links resolve, no unintended expression braces |
| Internal documentation links | Checked for existing targets within the bundle |
| Proposed TypeScript config | Parsed successfully using Node type stripping; zero boards and CAD-disabled defaults confirmed |
| Conceptual review | Separate review checked scope, three motivating workflows, evidence semantics, proposed API labels, empty state, non-LCSC handling and source paths |
| ZIP archive | Integrity and archive path checks performed after assembly |

The provided [scripts/verify-seed.py](scripts/verify-seed.py) repeats the source, JSON, data-shape and document-structure checks without network access. Structural template checks are not an MDX compilation or browser rendering test.

## Focused upstream experiments used in the research

- An empty publication selection passes the existing policy constructor and freshness check.
- The pure evidence index/projection can represent zero records when supplied an explicit empty reference fixture.
- The unmodified reference reader rejects an empty fixture because it requires exactly 25 preview packages. This expected failure substantiates the extraction blocker.
- The unchanged upstream component template and an empty aggregate pass the relevant pure Python bundle checks.
- A non-LCSC owner bundle using an empty LCSC field and exact MPN/manufacturer routing passes targeted in-memory checks. The central inventory/generator remains LCSC-specific for PCB lines.
- A targeted check reproduces the NOT APPLICABLE/unavailable-source blocking discrepancy documented in the evidence audit.

Details and limits are in [research/led-doc-engine-validation.json](research/led-doc-engine-validation.json), [the generator report](research/led-doc-engine.md) and [the evidence report](research/led-evidence.md).

## Not claimed as complete

- New initializer or runtime package implementation, installation or publication.
- Full LED Python validator/test suite, zfb/MDX build or browser-preview checks in this session.
- Fresh manufacturer datasheet acquisition or independent verification of the lamp's electrical claims.
- KiCad rendering, STEP/WRL geometry regeneration, manufacturing export or physical hardware verification.
- Npm namespace availability, registry releases, or compatibility of an untested future dependency set.

The implementation plan and acceptance scenarios specify how the local agent should complete those relevant to the first release. The downloadable files are the finished research and preparation deliverable requested for that local work.
