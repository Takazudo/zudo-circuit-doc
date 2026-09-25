# Research index

These reports inspect current repository source at the commits recorded in [sources/repositories.json](../sources/repositories.json). They distinguish observed behavior, source-code findings, focused experiments and proposals.

The [design documents](../design/01-product-definition.md) are the reconciled implementation recommendation. A report may discuss alternatives from its particular scope; it does not establish a competing implementation order.

| Report | Scope |
| --- | --- |
| [sg-architecture.md](sg-architecture.md) | zudo-sg initializer/runtime split, fixture-derived template, zudo-doc composition, asset viewer and agent resources |
| [led-evidence.md](led-evidence.md) | v1 identity/source/fact/coverage contract, exact verdicts, component onboarding, empty-state and non-LCSC portability |
| [led-doc-engine.md](led-doc-engine.md) | Core/adapter API, project coupling, empty-state checks, publication, ownership and browser-island extraction |
| [led-assets.md](led-assets.md) | Datasheet retention, symbol/footprint/3D acquisition, real mismatch cases, previews and manufacturing extension |

Each report has a corresponding source manifest in this directory. [sources/file-manifest.json](../sources/file-manifest.json) consolidates and deduplicates them into 174 audited source files and exact inert snapshots. Paths in manifest entries are relative to the bundle root where named as such. Original source filenames gain `.source` in the archive so they are reading references, not automatically discovered instructions or a runnable checkout.

The engine audit's executed-check receipt is [led-doc-engine-validation.json](led-doc-engine-validation.json). Source and geometry reports do not claim fresh manufacturer-data verification or physical hardware tests. The evidence report describes its focused pure-function checks.

Dates may be expressed as 2026-09-25 UTC or 2026-09-26 Japan; these refer to the same research session.
