# Extraction Baseline (M0)

Pins, toolchain, re-run checks and the import inventory this project extracts from zudo-led-lamp.

## What this page is

The M0 baseline for the Circuit Doc v0.1 epic
([Takazudo/zudo-circuit-doc#1](https://github.com/Takazudo/zudo-circuit-doc/issues/1)). It
lets a reviewer identify the exact original of every extracted subsystem, see which checks
actually ran and when, and read the empty-consumer test plan this project will grow into.
Every result below is either measured in this task, with the exact command, or explicitly
marked "not run" with a reason. Nothing here is copied forward as "passed" without running it.

## Pins

| Repository | Pinned commit | Pin date |
| --- | --- | --- |
| [zudo-led-lamp](https://github.com/Takazudo/zudo-led-lamp/tree/194d8a297e3545588197342130c3111a66c10973) | `194d8a297e3545588197342130c3111a66c10973` | 2026-09-26 |
| [zudo-sg](https://github.com/Takazudo/zudo-sg/tree/b9b36ce35d98d6abc641d84e8535552eac0dbded) | `b9b36ce35d98d6abc641d84e8535552eac0dbded` | 2026-09-26 |
| [zudo-doc](https://github.com/Takazudo/zudo-doc/tree/6a10f764181cd9f73059d4bf523e3673983859d8) | `6a10f764181cd9f73059d4bf523e3673983859d8` | 2026-09-26 |

At planning time (2026-09-26) upstream heads were equal to these pins: nothing had moved on any
of the three repositories. Every task in this epic reads the pinned commit by SHA regardless of
where local clones currently point, because `zudo-doc` in particular is under active
development and its local clone head moves between sessions.

## npm names

`create-zudo-circuit-doc` and `@takazudo/zudo-circuit-doc` both returned 404 on the npm
registry at planning time. This is an availability result, not a claim of ownership — no
package has been published under either name.

## Toolchain

Measured in this task's environment:

| Tool | Version |
| --- | --- |
| Node.js | 24.13.1 |
| pnpm (via corepack) | 11.5.2 |
| Python 3 | 3.12.3 (declared floor: 3.10, see [ADR-003](./decisions.md#adr-003-—-version-family)) |
| Docker | present (`/usr/bin/docker`) |
| google-chrome | present (`/usr/bin/google-chrome`) |

## Version family

The exact-pinned dependency set (`@takazudo/zudo-doc` 5.27.0, the `zfb`/`zfb-runtime`/`zfb-md-wasm`
family 2.21.0, pnpm 11.5.2, Node >=22.18.0, Python >=3.10 stdlib-only) is
[ADR-003](./decisions.md#adr-003-—-version-family).

## LED checks re-run now

Every check below was re-run in this task, on a `git archive` copy of the pinned
`zudo-led-lamp` commit made in `mkdtemp`. The user's clone at `$HOME/repos/circuits/zudo-led-lamp`
was never checked out, installed or built into — only read with `git archive` and one read-only
symlink to its existing `doc/node_modules` (removed afterward). `git status --short` on that
clone was confirmed empty before and after every run below.

| Check | Command (run from the archive's `doc/` unless noted) | Result | Date |
| --- | --- | --- | --- |
| Validator | `python3 -B .claude/skills/component-spec-audit/scripts/validate.py` (repo root) | `PASS: component-spec contract; 35 lines; offline=True; refreshed=none` — exit 0 | 2026-09-26 |
| `unittest` (38) | `python3 -B -m unittest discover -s .claude/skills/component-spec-audit/scripts -p "test_*.py"` (repo root) | `Ran 38 tests in 1.356s — OK` | 2026-09-26 |
| `check_forward_tests.py` | `python3 -B .claude/skills/circuit-spec-integration/scripts/check_forward_tests.py` (repo root) | `PASS: 5 integration cases; 7 negative routes` — exit 0 | 2026-09-26 |
| Component-docs test suite | `node --experimental-strip-types --test "component-docs/tests/*.test.ts"` | `tests 470, suites 99, pass 470, fail 0` | 2026-09-26 |
| `check.ts` | `node --experimental-strip-types component-docs/cli/check.ts` | `generated output is up to date` (35/35 records, 91/91 sources) — exit 0 | 2026-09-26 |
| `models.ts --check` | `node --experimental-strip-types component-docs/cli/models.ts --check` | `models 25 selected; 0 written, 25 unchanged` — exit 0 | 2026-09-26 |
| `footprint-previews/check.ts` | `node --experimental-strip-types component-docs/footprint-previews/check.ts` | `25 committed footprint previews are current and safe` — exit 0 | 2026-09-26 |

The component-docs test suite needs the LED doc's installed `node_modules`. Per the sub-issue
brief, this was provided by a read-only symlink from the archive's `doc/node_modules` to the
user's clone's `doc/node_modules` (not copied, not written to), removed once the run finished.

The measured 470/470 is a higher pass count than the epic's planning-time note of "446/451,
the 5 failures reading host-only files outside the minimal fixture set" — that earlier run used
a stripped-down fixture tree. This task ran the full suite against a complete `git archive` of
the repository, where every host file the tests read is present, so all 470 tests pass.

## Pre-existing findings

These are defects and stale claims in the current upstream code, found during planning and
confirmed again while writing this baseline. They are **not** extraction-work bugs — extraction
copies the code as-is first, and each one is deliberately fixed later, under its own issue and
test, per the epic's "Extract before redesign" rule.

| Finding | Location | Resolved by |
| --- | --- | --- |
| `fact_blocks_domain` blocks NOT APPLICABLE facts sitting on unavailable sources, contradicting `contract.md:9` | `validate.py:563-566` | [#6](https://github.com/Takazudo/zudo-circuit-doc/issues/6) — see [ADR-008](./decisions.md#adr-008-—-not-applicable-never-blocks) |
| `resolve_identities` rejects a same-MPN match before manufacturer narrowing runs | `validate.py:317` (narrowing logic at `:374-381`) | [#6](https://github.com/Takazudo/zudo-circuit-doc/issues/6) — see [ADR-009](./decisions.md#adr-009-—-resolver-manufacturer-narrowing-before-rejection) |
| `--online` can never pass on this corpus: every AVAILABLE VOLATILE-HTML source hits the HASH-LOCKED requirement and fails deterministically | `validate.py:1092` (6 VOLATILE-HTML sources in the corpus) | [#12](https://github.com/Takazudo/zudo-circuit-doc/issues/12) — see [ADR-019](./decisions.md#adr-019-—-validator-online-behavior-stays-explicit-and-skips-volatile-html) |
| `expected_mpn`'s C144397 special case is dead code — no generator spec has contained C144397 since upstream commit `d892e13` | `validate.py:226-228` | [#17](https://github.com/Takazudo/zudo-circuit-doc/issues/17) |
| Emit ownership gap: a marker-less target is silently overwritten, and `prune()` runs only after all writes, so a failed run leaves partial writes | `emit.ts:104-124` (reproduced in `planning/prototypes/emit-gap.ts`) | [#10](https://github.com/Takazudo/zudo-circuit-doc/issues/10) |
| `generator_inventory`'s `specs or (...)` fallback silently substitutes the three hardcoded LED board specs, even when passed `()` or `[]` | `validate.py:192-198` | [#17](https://github.com/Takazudo/zudo-circuit-doc/issues/17) — see [ADR-010](./decisions.md#adr-010-—-two-inventory-profiles) |
| Stale doc claim: "online mode mutates retained evidence" — it does not (`store_and_verify` never mutates) | `validate.ts:15`, `ARCHITECTURE.md:198` | [#16](https://github.com/Takazudo/zudo-circuit-doc/issues/16) |
| Stale doc claim: "rules.json is not covered by validate.py" — `validate_integration_artifacts` (`validate.py:903-940`) does cover it | `evidence.ts:248`, `integration.test.ts:297` | [#11](https://github.com/Takazudo/zudo-circuit-doc/issues/11) |

## Import inventory per extracted subsystem

Full file-by-file detail lived in the planning exploration notes
`planning/explore/{led-engine,led-validator,led-ui-cad}.md` of the epic's planning seed. The seed
was removed from the tree before release ([#34](https://github.com/Takazudo/zudo-circuit-doc/issues/34))
and stays readable in git history.
This table summarizes each extraction unit: its source root in the pinned `zudo-led-lamp`
commit, its destination in this repository, and the sub-issue that lands it.

### Projection engine (`doc/component-docs/{core,core/render}`)

| Source (zudo-led-lamp) | Destination | Owning issue |
| --- | --- | --- |
| `doc/component-docs/core/{errors,text,url,ids,mdx,page,links,emit,publication,view-model,adapter,pipeline,scan,model-descriptor,reference-descriptor}.ts` | `packages/circuit-doc/src/core/**` | [#5](https://github.com/Takazudo/zudo-circuit-doc/issues/5) |
| `doc/component-docs/core/render/{shared,catalog,integration,landing,record}.ts` | `packages/circuit-doc/src/core/render/**` | [#5](https://github.com/Takazudo/zudo-circuit-doc/issues/5) |
| `emit.ts` ownership/prune rewrite, package-neutral `GENERATED_MARKER` | `packages/circuit-doc/src/core/{emit,page}.ts` | [#10](https://github.com/Takazudo/zudo-circuit-doc/issues/10) |
| `render/shared.ts` routes/glosses, `RenderOptions` (`agentResources`, `integrationDomainGloss`) | `packages/circuit-doc/src/core/site.ts` + render options | [#14](https://github.com/Takazudo/zudo-circuit-doc/issues/14) |

### Adapter (`doc/component-docs/adapters/circuit`)

| Source (zudo-led-lamp) | Destination | Owning issue |
| --- | --- | --- |
| `adapters/circuit/paths.ts` → `CircuitProjectPaths`/`resolveCircuitPaths`; `read.ts`, `evidence.ts`, `index.ts` factory | `packages/circuit-doc/src/adapters/**` | [#11](https://github.com/Takazudo/zudo-circuit-doc/issues/11) |
| `adapters/circuit/references.ts`, `model-assets.ts` (exact-25 gates → `selection.expect.packages`, allowing 0) | `packages/circuit-doc/src/adapters/{references,model-assets}.ts` | [#15](https://github.com/Takazudo/zudo-circuit-doc/issues/15) |
| `adapters/circuit/validate.ts` (Python subprocess runner) | `packages/circuit-doc/src/validate/**` | [#16](https://github.com/Takazudo/zudo-circuit-doc/issues/16) |
| `cli/{run,generate,check,watch,models,scan-artifacts}.ts` → exported functions, unified CLI | `packages/circuit-doc/src/cli/**` | [#18](https://github.com/Takazudo/zudo-circuit-doc/issues/18) |
| `cli/scan-artifacts.ts` → config-driven `ScanPolicy`, declared-empty mode | `packages/circuit-doc/src/cli/scan-policy.ts` | [#19](https://github.com/Takazudo/zudo-circuit-doc/issues/19) |
| `footprint-previews/{config,footprint,generate,check,hash,manifest,parity,selection,svg}.ts` | `packages/circuit-doc/src/footprint-previews/**` | [#20](https://github.com/Takazudo/zudo-circuit-doc/issues/20) |
| `adapters/circuit/selection.ts` (LED instance selection, expect 35/91/8) | `fixtures/led/**` (regression data, not shipped) | [#21](https://github.com/Takazudo/zudo-circuit-doc/issues/21) |

### UI, islands and CAD previews (`doc/component-docs/ui`, `doc/src/component-*`)

| Source (zudo-led-lamp) | Destination | Owning issue |
| --- | --- | --- |
| `core/model-descriptor.ts`, `core/reference-descriptor.ts` | `packages/circuit-doc/src/descriptors/**` (`./descriptors` export) | [#13](https://github.com/Takazudo/zudo-circuit-doc/issues/13) |
| `ui/{evidence-anchor,evidence-details,evidence-fact,evidence-table,component-references,footprint-preview,package-model-viewer}.tsx` + new `mdx-extras.ts` | `packages/circuit-doc/src/ui/**`, `packages/circuit-doc/src/mdx-extras.ts` | [#13](https://github.com/Takazudo/zudo-circuit-doc/issues/13) |
| `src/component-preview/footprint-preview-island.tsx`, `src/component-model-viewer/{package-model-viewer-island,viewer-runtime,viewer-state}.tsx` | `packages/circuit-doc/src/islands/**` (`./islands` seed export) | [#13](https://github.com/Takazudo/zudo-circuit-doc/issues/13) |
| `doc/src/styles/global.css:30-535` (`.zld-*` rules) | `packages/circuit-doc/styles.css` (`.zcd-*`, see [ADR-015](./decisions.md#adr-015-—-css-prefix-zld--→-zcd)) | [#13](https://github.com/Takazudo/zudo-circuit-doc/issues/13) |
| `doc/component-docs/adapters/circuit/references.ts` (VRML/WRL validation), `model-assets.ts` (WRL publication) | `packages/circuit-doc/src/cad/**` | [#15](https://github.com/Takazudo/zudo-circuit-doc/issues/15) |
| `component-docs/scripts/check-built-component-references.mjs` | `packages/circuit-doc/src/cli/check-built.ts` | [#19](https://github.com/Takazudo/zudo-circuit-doc/issues/19) |
| `component-docs/scripts/model-viewer-browser-smoke.mjs` | `packages/circuit-doc/src/browser-smoke/**` (`check-browser` CLI command) | [#27](https://github.com/Takazudo/zudo-circuit-doc/issues/27) |
| `doc/pages/docs/[[...slug]].tsx` island imports, `src/chrome-bindings.tsx` | `examples/empty` host glue (`pages/lib/_circuit-doc-islands.ts`, `src/chrome-bindings.tsx`) | [#22](https://github.com/Takazudo/zudo-circuit-doc/issues/22) |

### Python validator (`.claude/skills/{component-spec-audit,circuit-spec-integration}`)

| Source (zudo-led-lamp) | Destination | Owning issue |
| --- | --- | --- |
| `validate.py:402-746` (generic v1 core: source/fact/pass-trust/bundle/coverage/routing/arithmetic) | `packages/circuit-doc/python/zudo_circuit_evidence/contract/**` | [#6](https://github.com/Takazudo/zudo-circuit-doc/issues/6) |
| `validate.py:192-274` generator inventory + manual profile draft | `packages/circuit-doc/python/.../inventory/{common,manual}.py` | [#12](https://github.com/Takazudo/zudo-circuit-doc/issues/12) |
| `validate.py:74-231` `ComponentDsl`, `generator_inventory` (LED profile, specs from config, `PROJECT_NAME`-derived board names) | `packages/circuit-doc/python/.../inventory/led_generator_v1.py` | [#17](https://github.com/Takazudo/zudo-circuit-doc/issues/17) |
| `validate.py:903-940`, `circuit-spec-integration/scripts/check_forward_tests.py` (generic rule/calculation checks) | `packages/circuit-doc/python/.../integration/{rules,forward}.py` | [#12](https://github.com/Takazudo/zudo-circuit-doc/issues/12) |
| `validate.py:806-940` LED-only gates (pin locks, critical-fact-review, refresh evidence, exact domains) → data-driven policy | `packages/circuit-doc/python/.../policy/checks.py` + `fixtures/led/policy.json` | [#17](https://github.com/Takazudo/zudo-circuit-doc/issues/17) |
| `validate.py:1098-1131` `validate_all`/`main` orchestration | `packages/circuit-doc/python/circuit_validate.py` (CLI entry) | [#12](https://github.com/Takazudo/zudo-circuit-doc/issues/12) |
| `.claude/skills/component-spec-audit/assets/component-skill-template/**`, `new-component-workflow.md` | `packages/create-zudo-circuit-doc` templates + `circuit/WORKFLOW.md` | [#8](https://github.com/Takazudo/zudo-circuit-doc/issues/8) |

## Planned empty-consumer test

M5's decisive portability proof, owned by [#28](https://github.com/Takazudo/zudo-circuit-doc/issues/28):
pack both packages, then create and build a new project **outside the monorepo** from the
tarballs alone (a workspace resolving unpublished paths is not evidence). The command sequence:

```sh
corepack pnpm --filter @takazudo/zudo-circuit-doc pack --pack-destination <mkdtemp>
corepack pnpm --filter create-zudo-circuit-doc pack --pack-destination <mkdtemp>
node <extracted>/package/bin/create-zudo-circuit-doc.js "<tmp>/my circuit" \
  --name my-circuit --title "My Circuit" --yes --no-install --no-git
```

Then: rewrite the runtime dependency to a local `file:.tarball/<tgz>` path, `corepack pnpm install`
with CI-like strictness, `git init` and commit, execute the initializer's printed next-steps
verbatim, and assert `pnpm check`, `pnpm build` and `pnpm check:site` all pass.

Scenarios (`bash $HOME/.claude/scripts/heavy-guard.sh -- pnpm verify:pack`):

| Scenario | What it proves |
| --- | --- |
| INIT-01 | A new project in an empty directory opens with the project brief and next task, zero reviewed components, no lamp defaults |
| INIT-02 | `pnpm build`/`pnpm check:site` succeed with no KiCad, Docker or vendor logins — optional operations explain their tool needs |
| INIT-03 | An existing non-empty destination exits non-zero with every byte unchanged |
| INIT-04 | Installed packages run outside the monorepo: runtime, templates, validator resources, CSS and browser imports all resolve from `node_modules` (the Python validator's `SCOPE:` line is asserted) |
| INIT-05 | A destination path with spaces and a separate project name keeps paths and package identifiers correct (argument arrays used throughout) |

Negative and tool-availability scenarios (malformed config, deleted inventory, stale selection,
missing Docker/Chrome, interrupted install, `--agent` variants, template file permissions) are
listed in full in [issue #28](https://github.com/Takazudo/zudo-circuit-doc/issues/28). None of
this has run yet — the runtime and initializer packages this test packs do not exist until
later waves land.
