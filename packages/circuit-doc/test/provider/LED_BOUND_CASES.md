# LED-bound provider test cases

The provider tests here were moved from zudo-led-lamp `doc/component-docs/tests/` at `194d8a297e3545588197342130c3111a66c10973`. They cover `evidence`, `projection`, `integration`, `publication`, `read` and `adversarial`, plus `provider-fixtures.ts`.

Every upstream case in those six files is in one of three states:

- **Moved:** the case is here unchanged, apart from import specifiers and non-null type assertions that `noUncheckedIndexedAccess` needs.
- **Rewritten:** the case is here, but now runs against a `mkdtemp` project.
- **Deferred:** the case is listed in the table below.

A deferred case needs the real LED corpus, which is the evidence tree, the committed generated pages, the LED selection, or the real adapter with the LED Python validator. These cases moved to the LED fixture harness (#21) and the LED-corpus test migration (#26), landing in `packages/circuit-doc/test-led/**` — every entry below is now resolved, either migrated there or dropped with a recorded reason.

## Migrated (into `test-led/**`, #26)

Every case below copies `fixtures/led/` into a `mkdtemp` scratch directory, then loads it through the real config loader (#9) and config-to-project mapping (#18), and either calls the provider API directly or drives `runPipeline`/the real Python validator — never a subprocess, never the real fixture tree.

| Upstream case (file:line) | Why it is LED-bound | Migrated to |
| --- | --- | --- |
| `corpus.test.ts` (whole file) | The corpus figures the epic states (35 records, 91 sources, 391 facts, 116 coverage, 49 interactions, 35 pin maps, 163 pins) and the al8860mp-13-specific assertions only hold against the real evidence. | `test-led/corpus.test.ts` |
| `gates.test.ts` (corpus split: open=68, barren=24, open-without-blocker=31) | The exact split only holds against the real coverage data. | `test-led/gates.test.ts` |
| `gates.test.ts:313-327` (8 denied-field ↔ provider-key mapping) | Ties the committed publication matrix's 8 denied fields to the provider keys `readCanaries`/`harvestCanaries` must walk. | `test-led/gates.test.ts` |
| `pipeline.test.ts:26-113` ("the real circuit adapter") | Runs the real adapter through the real Python validator over the materialized corpus. | `test-led/pipeline.test.ts` |
| `pipeline.test.ts:198-205` ("committed output") | Compares the pipeline's dry-run output and preflight report to the pinned goldens (`fixtures/led/expected/`, ADR-011's `viewModelVersion` bump). | `test-led/pipeline.test.ts` |
| `references.test.ts:25-98` (reviewed document shortcuts, KiCad preview manifest) | The reviewed per-record document selection and the 35→25 package collapse only hold against the real reference data; ports `CIRCUIT_DOCUMENT_VERIFICATION` from `fixtures/led/circuit/document-verification.json`. | `test-led/references.test.ts` |
| `model-viewer.test.ts:49-58` "projects 35 records onto 25 safe local package models and preserves rotations" | The 35→25 collapse and the non-zero rotations are real-corpus facts. | `test-led/model-viewer.test.ts` |
| `footprint-previews.test.ts:64-136` (no-KiCad drift check) | Proves the real, committed 25-package/35-record footprint preview set is current and safe, the same way `footprints check` does. | `test-led/footprint-previews.test.ts` |
| `integration.test.ts:488` "marks every barren stage on the committed page for the real corpus" | Reads the committed LED `components/integration/index.mdx` and asserts its five barren OPEN stages. | `test-led/integration.test.ts` |
| `publication.test.ts:129` "keeps the instance selection free of duplicates" | Asserts on `CIRCUIT_SELECTION`, now `fixtures/led/circuit/selection.json` loaded through the real project. | `test-led/publication.test.ts` |
| `publication.test.ts:140` "matches the asserted corpus size" | Asserts that the committed LED selection matches its own `expect` (35/91). | `test-led/publication.test.ts` |
| `read.test.ts:65-68` "applies the same rule to the real skills root" | `assertContainedUnder` against the real, materialized LED `bundlesRoot`. | `test-led/read.test.ts` |
| `read.test.ts:142-143` "still reads the real inventory" | `readInventory` against the real LED inventory (35 lines, 31 fitted, 4 DNP/hand-fit). | `test-led/read.test.ts` |
| `adversarial.test.ts:290-322` "invalid input fails before the generated tree is replaced" | Runs the real adapter over the LED evidence with the real Python validator, then a seeded failing script, and proves the previously-written pages are byte-identical afterward. | `test-led/adversarial.test.ts` |

## Dropped (#26)

| Upstream case (file) | Reason |
| --- | --- |
| `narrative-links.test.ts` | Reads the excluded hand-authored LED pages. The generic authored→generated link checking lives in `check:site --strict-broken` + `--strict-anchors`. |
| `workflow-contract.test.ts` | Reads the LED `.github/workflows`. This repo's CI is tested by #33's gate list. |

## Rewritten

| Upstream case (file:line) | Now |
| --- | --- |
| `read.test.ts:65` "applies the same rule to the real skills root" | `read.test.ts` "applies the same rule to a project's bundles root". Uses `assertContainedUnder` on a `mkdtemp` project that `projectPaths` builds. |
| `read.test.ts:142` "still reads the real inventory" | `read.test.ts` "still reads a project's inventory". Uses `readInventory(bundlesRoot, inventoryFile)` on a `mkdtemp` project. |
| `publication.test.ts:145` "produces a deterministic report" | Same case, built on `FIXTURE_SELECTION` instead of the LED selection. |
| `adversarial.test.ts:290-322` (generic half) | `adapter.test.ts` "leaves the previous output byte-identical when validation fails". Uses `createCircuitAdapter` over a `mkdtemp` project with a stub validator, and a failing `createPythonValidator` script. |

## Not in scope here

`watch.test.ts` is owned by the CLI suite (#18, `test/cli/watch.test.ts`). The core and UI suites (`emit`, `evidence-fact`, `ids`, `links`, `mdx`, `pipeline-anchors`, `presentation`, `projection`, `render`, `scan`, `text`, `url`) are owned by #5 and #13.
