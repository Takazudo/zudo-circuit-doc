# Scenario traceability matrix

All 31 acceptance-scenario IDs from the epic's validation plan, each mapped to an executable check or an explicit, reasoned "not automatable".

Every acceptance scenario in the epic's validation plan, preserved in the planning seed's git
history, is traceable to an executable check or carries an explicit, reasoned "not automatable" /
"deferred" note — never a fabricated PASS. `pnpm test:scenarios` runs the automated checks below (unit and integration
tiers) and prints this same table from a single source of truth,
[`scripts/run-scenarios.mjs`](https://github.com/Takazudo/zudo-circuit-doc/blob/main/scripts/run-scenarios.mjs).
`pnpm test:scenarios --with-pack` additionally runs the packed-consumer tier (the LED fixture
regression and every `verify:pack` fixture), which needs the LED fixture materialized and drives
full packed-tarball builds, so it is opt-in and heavy.

Two rows are never marked passed here: **AGENT-01** is an agent run (one agent session hands a task
to a fresh second session over committed evidence alone; run as a Claude Code variant, not passed),
recorded in the v0.1 validation report, which remains in git history, and **BENCH-01** requires
physical hardware and is not run.

## INIT — initialize and run outside the monorepo

| ID | Scenario | Check | Type |
| --- | --- | --- | --- |
| INIT-01 | Initialize a new project in an empty directory | `scripts/verify-pack.mjs --fixture empty`, scenario `INIT-01` | packed consumer |
| INIT-02 | Run doc build without KiCad, Docker or vendor logins | `scripts/verify-pack.mjs --fixture empty`, scenario `INIT-02` | packed consumer |
| INIT-03 | Destination exists and contains user files | `scripts/verify-pack.mjs --fixture empty`, scenario `NEG-INIT-03` | packed consumer |
| INIT-04 | Run installed packages outside monorepo | `scripts/verify-pack.mjs --fixture empty`, scenario `INIT-04` | packed consumer |
| INIT-05 | Use destination with spaces and a separate project name | `packages/create-zudo-circuit-doc/test/{args,scaffold}.test.ts`; `verify-pack.mjs` scenario `INIT-05` | automated unit + packed consumer |

INIT-03's script scenario constant is literally `NEG-INIT-03`, not `INIT-03` — a naming drift from
an earlier issue, recorded here rather than silently renamed in someone else's script.

## PART — component identity and placement

| ID | Scenario | Check | Type |
| --- | --- | --- | --- |
| PART-01 | Add a supplier-linked exact component | `pnpm test:led` — the LED fixture's 35 LCSC-linked records, identity/sources/facts/inventory/references/docs aligned end to end | automated integration |
| PART-02 | Research a PCB component sold outside LCSC | `python/tests/test_inventory_manual.py::test_part_02_blank_lcsc_line_routes_by_manufacturer_and_mpn`; `verify-pack.mjs --fixture minimal` scenario `PART-02` | automated unit + packed consumer |
| PART-03 | Add an unplaced candidate before KiCad work | `python/tests/test_inventory_manual.py::test_part_03_empty_placements_pass_with_scope` | automated unit |
| PART-04 | Similar MPN from another manufacturer | `python/tests/test_inventory_manual.py::test_part_04_same_mpn_from_two_manufacturers_needs_the_qualifier`; `test_contract.py::test_same_mpn_resolves_only_with_its_manufacturer` | automated unit |
| PART-05 | Multiple placements share one orderable identity | `python/tests/test_inventory_manual.py::test_part_05_one_line_with_several_placements` | automated unit |

## SRC — source acquisition and revision

| ID | Scenario | Check | Type |
| --- | --- | --- | --- |
| SRC-01 | Datasheet URL returns HTML/error content | `python/tests/test_scenarios.py::Src01Tests` — a local `http.server` serves an HTML body and a 500 error page at a `.pdf` URL; `validate --refresh-source` FAILs on the hash mismatch either way, and a lint confirms `circuit/WORKFLOW.md` Workflow C keeps the `%PDF-` magic-byte check | automated unit |
| SRC-02 | Source cannot be downloaded | `python/tests/test_contract.py` — zero-hash sentinel and explicit `SOURCE UNAVAILABLE` state tests | automated unit |
| SRC-03 | Same URL serves new document revision | `python/tests/test_contract.py::test_stale_online_hash_fails_and_removes_download`; `test_cli.py::test_online_stale_hash_fails` (a real local server, `--refresh-source` FAILs naming the stale hash, nothing kept) | automated unit |

SRC-01's own gap is narrow: `circuit_evidence` never inspects `Content-Type` or magic bytes —
it only compares the fetched bytes' SHA-256 against the recorded one. That is already sufficient
to reject any HTML or error page served in place of the locked PDF, which is what the tests above
prove; the magic-byte check itself lives in the human/agent workflow (Workflow C step 4), covered
by the lint.

## FACT — evidence classification and calculation

| ID | Scenario | Check | Type |
| --- | --- | --- | --- |
| FACT-01 | A typical graph supports a claim | `test/core/render-options.test.ts`, `describe("FACT-01 ...")` | automated unit |
| FACT-02 | Calculation uses unavailable or identity-only input | `test/core/render-options.test.ts`, `describe("FACT-02 ...")`; `test_contract.py::test_primary_and_calculated_pass_require_available_primary_leaves` | automated unit |
| FACT-03 | Numeric result is correct but units/interpretation are wrong | `python/tests/test_scenarios.py::Fact03Tests` | **automated (limit) + agent/engineering review (documented)** |
| FACT-04 | Coverage includes a bench-dependent fact | `test/core/render-options.test.ts`, `describe("FACT-04 ...")` | automated unit |

FACT-03 is deliberately never recorded as fully automated. `Fact03Tests` proves the *limit*: a
calculated fact whose arithmetic recomputes exactly (`fact-golden-limit - fact-golden-project`)
still passes even after `fact-golden-limit`'s unit is silently swapped from volts to millivolts —
the contract's recompute check (`circuit_evidence/facts.py`) only compares numbers, never units.
A second test scans every `.py` file in the validator package for phrases like "dimensionally
checked/verified" or "units verified" and asserts none exist, so the contract never overclaims. A
third confirms `circuit/WORKFLOW.md` Workflow E keeps its explicit sentence: "the arithmetic check
does not prove dimensional correctness" — the actual catch for this scenario is the human/agent
review step Workflow E requires, not code.

## CAD — footprints, models and fidelity

| ID | Scenario | Check | Type |
| --- | --- | --- | --- |
| CAD-01 | Supplier model is a family variant | `test/scenarios/cad-01.test.ts`; `verify-pack.mjs --fixture minimal` scenario `CAD-01` | automated unit + packed consumer |
| CAD-02 | A corrected model is derived from family CAD | `test/scenarios/cad-02.test.ts` | **source inspection + automated receipt check** |
| CAD-03 | Footprint changes after preview generation | `test/footprint-previews/check.test.ts`; `scripts/check-cad-freshness.mjs` | automated unit + automated integration |
| CAD-04 | Selected model file missing or paths escape configured roots | `test/provider/model-assets.test.ts`, `test/provider/references.test.ts`, `test/footprint-previews/transforms.test.ts` | automated unit |
| CAD-05 | No models selected | `test/provider/references.test.ts`, `test/provider/model-assets.test.ts`; `verify-pack.mjs` scenario `CAD-05` | automated unit + packed consumer |

CAD-02's evidence is the `examples/minimal` TMP1075DR footprint/model derivation
(`footprints/vendor/kicad-soic8/`), the only derived-CAD record in this repository (the LED
corpus has none). `cad-02.test.ts` does two things: it inspects `README.md` and the three
`circuit/cad-receipts/*.json` files for the original (input) hash, the derivation tool
(`derive.mjs`) and parameters, the output hashes, and confirms `fidelity.class` is `"family"`,
never `"exact-vendor"`; and it runs `node footprints/vendor/kicad-soic8/derive.mjs --check`, which
re-derives the committed outputs from the committed inputs and fails if either has drifted.

## PUB — publication scope

| ID | Scenario | Check | Type |
| --- | --- | --- | --- |
| PUB-01 | New source/record added but not selected | `test/provider/publication.test.ts`, "selects nothing by default — an unlisted instance is unpublished" | automated unit |
| PUB-02 | Selected record/source removed | `test/provider/publication.test.ts`, `describe("selection freshness")` (`STALE_SELECTION`) | automated unit |
| PUB-03 | Excluded raw file placed under public directory | `test/scan/public-scope.test.ts`, `test/cli/scan-check-built.test.ts`, `test/provider/model-assets.test.ts` | automated unit |

## OUT — generation and emit safety

| ID | Scenario | Check | Type |
| --- | --- | --- | --- |
| OUT-01 | Authored file occupies a generated target | `test/core/emit.test.ts`, `"OUT-01 ..."` | automated unit |
| OUT-02 | Generate twice without input changes | `test/core/emit.test.ts`, `"OUT-02 ..."` | automated unit |
| OUT-03 | Check-only command finds drift | `test/core/emit.test.ts`, `"OUT-03 ..."` | automated unit |

## AGENT, CHANGE, BENCH

| ID | Scenario | Check | Type |
| --- | --- | --- | --- |
| AGENT-01 | Claude completes task, a fresh agent continues (Claude Code variant run; Codex variant not run) | Agent run, detailed in the v0.1 validation report retained in git history; structural scaffold only here (`verify-pack.mjs --fixture empty` scenario `AGENT-VARIANTS` proves `CLAUDE.md`/`AGENTS.md`/`.claude/skills/**` exist per `--agent` mode) | agent-run — **never marked passed here** |
| CHANGE-01 | A component or net changes | `scripts/scenarios/change-01.mjs`, four cases on a throwaway copy of `examples/minimal` (below) | automated integration |
| BENCH-01 | User submits actual measured results | Not run: requires physical hardware. `circuit/WORKFLOW.md` Workflow F and `circuit/templates/project-docs/verification/bring-up.mdx` reviewed | **manual — not run** |

`scripts/scenarios/change-01.mjs` covers CHANGE-01's four sub-cases, each on its own scratch copy
so the committed fixture is never touched:

- **(a)** a synthetic raw/calculated fact pair is added to the copy; editing the raw fact's value
  makes `validate` FAIL naming the calculated fact as stale — the same mechanism SRC-03 and
  `test_contract.py`'s cycle tests exercise, applied to a live project.
- **(b)** a source's `authoritative_url` is repointed at a local stand-in server (never the real
  network); a refresh against it never matches the recorded hash, and `validate --refresh-source`
  FAILs naming the source.
- **(c)** a footprint edit is caught by `footprints check` — this reuses
  `scripts/check-cad-freshness.mjs` (CAD-03) unchanged rather than duplicating it.
- **(d)** a legitimate evidence edit (a fact's `conditions` text) is followed by `generate`; the
  diff `generate` itself produces is scoped to exactly `doc/src/content/docs/components/**` and
  `circuit/generated/preflight.json` — never any other file.

## Known gaps closed by this issue

- `scripts/check-cad-freshness.mjs` (CAD-03) and `scripts/check-authored-content.mjs` were not
  wired into any CI workflow or package script before this issue. `pnpm test:scenarios` now runs
  both on every invocation: `check-cad-freshness.mjs` directly (and again via CHANGE-01(c)), and
  `check-authored-content.mjs` against `examples/empty` and `examples/minimal`.
- `packages/circuit-doc/scripts/__tests__/*.test.mjs` remain outside every `pnpm test*` script —
  they test build-time sync scripts (`sync-create-template.mjs`, `check-upstream-scaffold.mjs`),
  not an acceptance scenario, and are outside this issue's `Owns`; reported here rather than
  edited.

## Running it yourself

```sh
pnpm test:scenarios                              # unit + integration tiers (fast, no network)
bash $HOME/.claude/scripts/heavy-guard.sh -- \
  pnpm test:scenarios --with-pack                 # + the LED fixture and every packed fixture
pnpm doc:build                                    # this page, and the rest of the site
```
