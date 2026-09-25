# LED-bound provider test cases

The provider tests here were moved from zudo-led-lamp `doc/component-docs/tests/` at `194d8a297e3545588197342130c3111a66c10973`. They cover `evidence`, `projection`, `integration`, `publication`, `read` and `adversarial`, plus `provider-fixtures.ts`.

Every upstream case in those six files is in one of three states:

- **Moved:** the case is here unchanged, apart from import specifiers and non-null type assertions that `noUncheckedIndexedAccess` needs.
- **Rewritten:** the case is here, but now runs against a `mkdtemp` project.
- **Deferred:** the case is listed in the table below.

A deferred case needs the real LED corpus, which is the evidence tree, the committed generated pages, the LED selection, or the real adapter with the LED Python validator. These cases move to the LED fixture harness, #21. The LED-corpus test migration itself is sibling #26.

## Deferred

| Upstream case (file:line) | Why it is LED-bound | Destination |
| --- | --- | --- |
| `integration.test.ts:488` "marks every barren stage on the committed page for the real corpus" | Reads the committed LED `components/integration/index.mdx` and asserts its five barren OPEN stages. | #21 |
| `publication.test.ts:129` "keeps the instance selection free of duplicates" | Asserts on `CIRCUIT_SELECTION`, the LED selection. It becomes LED fixture data (`fixtures/led/circuit/selection.json`). | #21 |
| `publication.test.ts:140` "matches the asserted corpus size" | Asserts that `CIRCUIT_SELECTION` matches its own `expect` (35/91). | #21 |
| `adversarial.test.ts:290-322` "invalid input fails before the generated tree is replaced" | Runs the real adapter over the LED evidence with the LED `validate.py`. | #21 for the real-corpus run. The generic half is moved: see below. |

## Rewritten

| Upstream case (file:line) | Now |
| --- | --- |
| `read.test.ts:65` "applies the same rule to the real skills root" | `read.test.ts` "applies the same rule to a project's bundles root". Uses `assertContainedUnder` on a `mkdtemp` project that `projectPaths` builds. |
| `read.test.ts:142` "still reads the real inventory" | `read.test.ts` "still reads a project's inventory". Uses `readInventory(bundlesRoot, inventoryFile)` on a `mkdtemp` project. |
| `publication.test.ts:145` "produces a deterministic report" | Same case, built on `FIXTURE_SELECTION` instead of the LED selection. |
| `adversarial.test.ts:290-322` (generic half) | `adapter.test.ts` "leaves the previous output byte-identical when validation fails". Uses `createCircuitAdapter` over a `mkdtemp` project with a stub validator, and a failing `createPythonValidator` script. |

## Not in scope here

The other upstream test files are owned elsewhere: `corpus`, `gates`, `pipeline`, `references`, `model-viewer`, `footprint-previews`, `narrative-links`, `workflow-contract` and `watch`, plus the core and UI suites, which #5 and #13 own.
