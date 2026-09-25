# Implementation plan

This sequence delivers a useful project early while preserving the strongest existing work. It is a work queue for the local agent, not a claim that these milestones have been completed.

## M0 — reproduce and pin the source baseline

Read the exact sources in the manifest. Obtain full source checkouts separately: the archived `.source` files are selected references, not a complete executable tree. Record current upstream heads, the chosen extraction baseline, package/tool versions and relevant repository instructions.

Run the existing LED checks locally with its dependencies and tools. Preserve known pre-existing findings separately from extraction regressions. Capture the real zudo-sg template generation and current create-zudo-doc API behavior.

**Deliverable:** source baseline note and a dependency/import inventory.

**Acceptance:** a reviewer can identify the exact original of each extracted subsystem and which checks actually ran.

## M1 — build a real empty host

Create the two-package workspace and one working host fixture. Compose zudo-doc using a supported strategy. Add the project brief, architecture and next-actions pages, a canonical agent workflow and an explicitly empty component area.

Pass project-root/config paths into the adapter. Split generic evidence validation from LED inventory/fixture requirements sufficiently to accept zero explicit records, sources, rules, boards and models. Remove lamp enclosure commands. Zero-state is not implemented by catching every exception and returning an empty array.

**Deliverable:** an empty project which starts and builds without KiCad/Docker/vendor credentials.

**Acceptance:** clean offline documentation generation; no lamp values or records; malformed/missing declared files still fail.

## M2 — extract the evidence projection package

Move the existing core, adapter and relevant UI/CLI into the runtime package. Retain v1 IDs, branded text/URLs, publication matrix, canonical validator callback, pure projection and deterministic report/output.

Parameterize expected selections, path roots, library names, model/preview plans and scanner baselines. Move LED-specific positive controls and counts into fixture data. Add preflight ownership checks for every existing output path before writing.

**Deliverable:** same LED projection under the package and the same zero-state under the generic profile.

**Acceptance:** compare representative generated output, links, anchors, conditions and withheld fields; any intentional changes have explicit fixtures. A colliding authored file is preserved and reported.

## M3 — make exact-component onboarding portable

Connect the workflow to inventory and source retention. Keep v1 component/source/fact semantics and standalone/subordinate ownership. Reuse the upstream example bundle only as a template; never insert its placeholder IDs/hashes into the live selected inventory.

Add a manual inventory provider for research before a schematic exists. Preserve provenance about the provider and reconciliation state; switch to a schematic/generator provider explicitly when available.

**Resolve the supplier-specific inventory boundary:** the LED central inventory requires an LCSC C-number for PCB-mounted lines. The bundle format can represent an empty LCSC field, but the current inventory/generator layer requires PCB C-numbers and generator placement parity. Blank-LCSC direct routing already works; do not introduce a fix for a nonexistent empty-alias failure. Provide an explicit generalized inventory profile that uses stable line IDs and manufacturer + complete MPN identity, with optional supplier IDs. Keep the LED v1 profile available for compatibility. Also correct the current resolver ordering for same-MPN parts from different manufacturers: apply exact manufacturer qualification before rejecting multiple candidates, while refusing ambiguous bare-MPN requests. Do not invent C-numbers or mislabel a PCB part as external to bypass validation. See the evidence audit's portability follow-up.

**Deliverable:** one real exact component's source/facts/selection workflow and a non-LCSC/manual fixture.

**Acceptance:** blocked downloads, same-name cross-vendor parts, empty supplier aliases and pre-schematic placements are represented honestly. Existing LED v1 fixtures still behave as expected.

## M4 — package CAD references and previews

Move footprint preview generation, model descriptors, WRL viewer runtime and browser islands. Keep a tested path for selected STEP+WRL pairs and qualified family/derived models. A record without the required published reference remains research/evidence until it satisfies the strict catalog contract.

Make renderer versions/tool invocation explicit. Preserve separate KiCad expectations for preview reproducibility and manufacturing. Record original/imported versus corrected artifacts and maintain checks on any mirrored footprint files.

**Deliverable:** a selected footprint and WRL preview in the external consumer, with evidence/fidelity labels and working controls.

**Acceptance:** input changes invalidate preview freshness; missing selected files fail; zero selected models requires no converter; interactive islands work after client navigation.

## M5 — initialize from a tested fixture

Following zudo-sg, derive the default template mechanically from the known-good empty/minimal host fixture. Use a deterministic sync/check script so the template cannot drift from the example.

Implement path/name validation, minimal prompts, noninteractive mode, install/git flags, version output from package metadata, failure cleanup and next commands. Add thin Claude/Codex entries to the canonical workflow without replacing unrelated instructions.

**Deliverable:** packed initializer creates a new circuit repository.

**Acceptance:** pack both packages and install outside the monorepo. All templates, Python resources, TypeScript/runtime exports, CSS and browser assets resolve from tarballs.

## M6 — validate the complete user tasks

Use the [acceptance scenarios](07-validation-acceptance.md). Exercise empty, one-component, non-LCSC/manual and retained LED fixtures. Run one real acquisition task locally with authorized network access and retain the receipt; this seed has not performed that end-to-end acquisition.

Use a different circuit topic from the lamp to discover accidental assumptions. A simple sensor, controller or passive interface may serve as a fixture, but no particular component or topology is prescribed by this seed.

**Deliverable:** a release candidate with clear commands, capability boundaries and a reproducible validation report.

**Acceptance:** the user can initialize, research a component, acquire data, check claims and continue the project with another agent.

## Release and subsequent upgrades

Confirm package names/ownership, package contents, license/provenance, dependency compatibility and documentation before publishing. Publishing is a separate local-session action; this archive is not authorization to publish a particular release.

Document a scaffold-refresh procedure using source pins and an ownership-aware diff. Defer automatic migration until it can preserve project evidence, custom pages, host island bindings and agent instructions.

## Known issues to close deliberately

| Finding | Treatment |
| --- | --- |
| Full validator assumes three lamp boards | Inventory provider extraction |
| Empty `specs` falls back through `specs or (...)` | Distinguish omitted argument from explicit empty list |
| Non-LCSC PCB inventory / qualified same-name routing | Generalized inventory profile with explicit compatibility semantics |
| `NOT APPLICABLE` + unavailable source blocking inconsistency | Focused contract/code decision with regression |
| `COVERED` can include NEEDS BENCH | Truthful UI; do not redefine as physical verification |
| Units checked for presence, not dimensional algebra | Keep human/agent dimensional review explicit |
| Inventory summary may lag detailed facts | Derive/reconcile summaries or clearly label scope |
| Exact 25/35/91/8 and scanner corpus limits | Project-owned expectations |
| Current route needs static preview-island imports | Preserve/test integration seam |
| Existing generated target ownership not preflighted | Add safe preflight |
| SG version constant differs from package version | Read actual metadata |

These are research findings at pinned commits. Recheck current upstream before applying any fix. Detailed evidence is in the four research reports.
