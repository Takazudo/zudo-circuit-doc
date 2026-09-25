# Validation and acceptance scenarios

These are the **future implementation's** acceptance criteria. The seed's actual checks are recorded separately in [VALIDATION.md](../VALIDATION.md).

## Essential user scenarios

| ID | Scenario | Expected observable outcome |
| --- | --- | --- |
| INIT-01 | Initialize a new project in an empty directory | Docs open with project brief/next task, zero reviewed components, no lamp defaults |
| INIT-02 | Run doc build without KiCad, Docker or vendor logins | Empty authoring state works; optional operations explain their tool needs |
| INIT-03 | Destination exists and contains user files | Exit without overwriting; name/path collision shown |
| INIT-04 | Run installed packages outside monorepo | Runtime, templates, validator resources, CSS and browser imports resolve |
| INIT-05 | Use destination with spaces and a separate project name | Paths and package identifiers remain correct; argument arrays used |
| PART-01 | Add a supplier-linked exact component | Identity, sources, facts, inventory, references and affected docs align |
| PART-02 | Research a PCB component sold outside LCSC | No fabricated C-number; manual/generalized inventory profile retains exact manufacturer+MPN |
| PART-03 | Add an unplaced candidate before KiCad work | Candidate/research state is useful; no false schematic reconciliation |
| PART-04 | Similar MPN from another manufacturer | Route as ambiguous/different identity; no borrowed ratings |
| PART-05 | Multiple placements share one orderable identity | One identity record, explicit placements, correct quantity/population reasoning |
| SRC-01 | Datasheet URL returns HTML/error content | Do not record an available PDF; retain blocked/acquisition result |
| SRC-02 | Source cannot be downloaded | Explicit SOURCE UNAVAILABLE; no real hash or PASS fabricated |
| SRC-03 | Same URL serves new document revision | New bytes inspected; dependent facts marked/reviewed; not a blind re-pin |
| FACT-01 | A typical graph supports a claim | Conditions/type remain visible; not promoted to guaranteed maximum |
| FACT-02 | Calculation uses unavailable or identity-only input | No primary PASS from that dependency closure |
| FACT-03 | Numeric result is correct but units/interpretation are wrong | Agent/engineering review catches it; validator does not claim dimensional proof |
| FACT-04 | Coverage includes a bench-dependent fact | UI still shows bench requirement |
| CAD-01 | Supplier model is a family variant | Family label, dimensions/mismatch and limits recorded |
| CAD-02 | A corrected model is derived from family CAD | Original hash, derivation and output checks retained; no exact-vendor claim |
| CAD-03 | Footprint changes after preview generation | Freshness check fails until regenerated |
| CAD-04 | Selected model file missing or paths escape configured roots | Concrete failure; no silent fallback to another package |
| CAD-05 | No models selected | Valid zero state without converter dependency |
| PUB-01 | New source/record added but not selected | No accidental catalog/raw-asset publication |
| PUB-02 | Selected record/source removed | Stale selection fails with useful diagnostic |
| PUB-03 | Excluded raw file placed under public directory | Publication checks detect scope issue; viewer exclusion alone is not enough |
| OUT-01 | Authored file occupies a generated target | Whole emit is preflighted; preserve authored bytes |
| OUT-02 | Generate twice without input changes | Identical owned outputs and report |
| OUT-03 | Check-only command finds drift | Reports changes without writing |
| AGENT-01 | Claude completes task, Codex continues | Same canonical evidence/workflow; no duplicated divergent database |
| CHANGE-01 | A component or net changes | Relevant facts, source hashes, integration, previews and authored decisions reconsidered |
| BENCH-01 | User submits actual measured results | Board/firmware/setup/revision preserved; conclusion limited to tested state |

## Focused regression tests

Carry forward the upstream evidence, projection, publication, MDX, path, URL, ID, ownership, watcher and browser-preview tests relevant to extracted code. Split generic behavior tests from corpus-specific fixtures. The lamp's named “golden” records belong to the latter.

Do not require every tiny project to include the LED-sized synthetic canary corpus. Test the scanner itself against adversarial fixtures, then validate the actual enabled output surfaces with appropriate non-vacuity checks. Zero components is not a reason to skip path ownership, config validation or publication checks.

The `NOT APPLICABLE` unavailable-source discrepancy and unit-analysis limit require tests that express the intended claim. Avoid tests that merely reproduce an implementation's current branch and call it correct.

## Browser checks after packing

Open catalog and a representative record at desktop and narrow widths, light/dark/system appearance, long tables, source detail expansion, footprint enlargement and WRL controls. Navigate through client transitions and direct reload. Verify static content remains useful before/without viewer initialization.

Check links and stable evidence anchors, including authored-to-generated links. Confirm preview-island hydration in the actual packed consumer. A TypeScript compile cannot establish that zfb has registered the island.

## Toolchain checks

Declare minimum Node/Python requirements and the project-selected KiCad renderer. The LED canonical validator wrapper currently requires Python >=3.12. Preview-renderer version and manufacturing KiCad version serve different purposes. Do not silently substitute a local renderer and then accept new hashes as equivalent.

Ordinary documentation checks should consume committed preview artifacts; only explicit preview regeneration needs the CAD renderer. An expected missing optional tool should yield a targeted instruction instead of unrelated stack traces.

## Release report format

For each relevant scenario record: fixture/revision, command or manual action, result, artifact/log, and limitation. Keep “not run” explicit. Separate source inspection, automated checks, browser checks, CAD geometry checks and physical hardware tests.

Do not describe successful schema validation as a verified circuit. This initializer's success is that evidence and remaining work are visible and consistent.
