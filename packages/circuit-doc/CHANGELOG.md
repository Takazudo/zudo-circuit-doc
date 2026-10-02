# Changelog

All notable changes to `@takazudo/zudo-circuit-doc` are documented in this file.

The format is based on Keep a Changelog, and release notes are generated from the changelog MDX pages.

## [0.2.0] - 2026-10-02

Version 0.2.0 widens exported reference and descriptor types for optional documents and 3D models.
Projects using those types may need to handle `null` values. The reviewed document-kind union also
adds `source-record`.

## Features

- Publish a selected record with an explicit reviewed `documentExceptions` reason when no public
  document exists. A footprint with no declared model is published as footprint-only; a declared
  but broken asset still fails validation.
- Allow custom publication matrices to deny owner-skill fields and package membership while keeping
  the default preset output unchanged.
- Add opt-in per-placement fit, board-scoped generator specs, and a finite reviewed list for deriving
  generator MPNs from values.
- Validate audited replacement candidates in owner bundles while excluding them from fitted
  placements, CAD binding, and public selection. Cross-partition references fail.
- Add explicitly declared, provenance-checked canonical footprint hash exemptions for SITE scans.
  OWNED scans retain the full canary set.

## Bug Fixes

- Keep headless Chrome foregrounded during browser smoke checks and contain long model captions on
  narrow screens.
- Exclude generated component pages from the authored-content subtraction corpus using the
  configured generated-content path.

## [0.1.0] - 2026-09-27

Initial release of `@takazudo/zudo-circuit-doc`, the runtime for evidence-first circuit-development
projects. It adds a structured component evidence model, documentation rendering and preview
components, a project CLI, and a Python validator for canonical evidence records.

## Features

- `circuit.config.ts` contract with types, a strict validator, a loader, and project path
  resolution, exported from `@takazudo/zudo-circuit-doc/config`.
- Component-docs core and render pipeline with site conventions, render options, and truthful
  zero-state copy (view-model version 2).
- Evidence provider with injected project paths, an adapter factory, and a CAD reference contract
  stored as a project-owned package lock.
- zudo-doc integration: UI components, islands, MDX extras, and `styles.css`.
- Unified `zudo-circuit-doc` CLI covering validation, config-driven footprint preview generation and
  freshness checks, post-build publication checks, and a CDP browser smoke check (`check-browser`).
- Python validator package (`circuit_evidence`, `circuit_validate`, standard library only) with a
  generic manual inventory profile, CAD pin-asset and integration checks, and placeholder-leak
  detection, discovered and version-gated by the JS runner.
- Post-build publication checks: scanner policy, public-scope enforcement, and a built-output
  reference checker.
- Explicit `docs.generatedNotice` config and an exported `DEFAULT_PREVIEW_RENDERER`.

## Bug Fixes

- Pin names and units that contain MDX delimiters are published as escaped text.
- KiCad 9 multi-line model transforms are read correctly; STEP models are optional for generation,
  while WRL stays required, and material-only DEF/USE is allowed in published WRLs.
- CAD footprint and model roots that escape the project are rejected early.
- Package-less record pages are verified truthfully by the built-output checker.
- The validator reports owner-directory set differences and same-run placeholders clearly.
