# Evidence semantics and publication

## Preserve the existing v1 contract

The LED project's evidence format is already richer than a part-number-and-datasheet list. Preserve it during package extraction:

| File | Role |
| --- | --- |
| `manifest.json` | Exact record identity, parentage and assigned source/fact/interaction IDs |
| `sources.json` | Source authority, availability, document revision, URL, hash, locator and retained extract |
| `facts.json` | Typed claims, value/unit/conditions, provenance, verdict and calculation dependencies |
| `coverage.json` | Declared domain coverage and explicit reasons/blocking facts |
| `routing.json` | Positive/negative routing to the exact component owner |
| `interactions.json` | Component-level interaction knowledge |
| `pin-map.json` | Source-backed pin identity and project mapping |
| `SKILL.md` | Existing owner-bundle entry instructions |

The central inventory represents orderable identities and placements; the component owner bundle represents evidence. Standalone and subordinate records have the same rigor. [Frozen contract](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/contract.md).

The file named `schema.json` is a custom validator contract containing expected keys/enumerations. It is **not JSON Schema**. Do not feed it to a JSON Schema library and assume equivalent validation. [Schema](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/schema.json).

## Actual verdict vocabulary

| Existing verdict | Meaning to preserve |
| --- | --- |
| `PASS - primary-source confirmed` | A qualifying primary claim, or a supported calculation under the contract |
| `CONFIRMED - distributor identity only` | Narrow identity confirmation; not performance evidence |
| `BLOCKER - deterministic spec violation` | Supported deterministic violation |
| `NEEDS BENCH` | Requires measurement/physical verification |
| `UNSOURCED` | Required support is not retained |
| `NOT APPLICABLE` | Claim/domain does not apply, with reason |

Do not shorten all of these into a single green/red field. In particular, the source contract restricts primary PASS to available manufacturer-primary evidence; a calculated PASS requires qualifying primary PASS leaves throughout its dependency closure.

Provenance and verdict are separate. Existing provenance values include `PRIMARY-SPEC`, `DISTRIBUTOR-IDENTITY`, `REFERENCE-DESIGN`, `CALCULATED`, `PROJECT-CHOICE`, `BENCH-OBSERVED` and `UNVERIFIED`. The ordinary success of retaining a project choice or bench observation does not convert it into a primary datasheet claim.

## Conditions and scope survive every projection

Keep absolute maximum distinct from recommended operation; typical curves distinct from guaranteed limits; clamp figures distinct from standoff and breakdown; design state distinct from manufacturer behavior. Preserve the conditions attached to every quantitative claim.

For a calculated fact, preserve raw fact IDs and an evaluable expression. Validate declared dependencies, missing/cyclic dependencies, required unit presence and the status of the dependency closure. The current arithmetic validator recomputes numbers but does not perform dimensional algebra or prove that a source table was interpreted correctly; dimensional consistency remains an explicit agent/engineering review task. A figure calculated from a typical value remains dependent on typical evidence.

A source lock includes physical PDF page index and printed page label because those may differ. Use an exact section/table/figure/row locator for the claim. Retain a minimal normalized extract sufficient for audit, rather than reproducing an entire datasheet.

## Availability is not authority

A downloaded distributor page is available, but not necessarily primary. A correct manufacturer URL is authoritative in origin, but may currently be unavailable. The existing unavailable-source sentinel is an all-zero SHA-256 and `SOURCE UNAVAILABLE`; it records absence of verified bytes, not a real document digest.

Identity itself can remain unresolved even when the project has an order code and placement. The report and UI must not infer exact electrical equivalence from a shared base part name, package name or supplier search result.

## Coverage is not hardware sign-off

The inspected validator's `COVERED` state is not a synonym for “safe” or “fully proven.” Its evidence-availability helper can count a `NEEDS BENCH` fact as available. Preserve explicit verdicts in the UI and avoid a summary badge that hides measurement work.

The audit also found a contract/code edge case: the contract says `NOT APPLICABLE` never blocks, while `fact_blocks_domain` can block it when its source is unavailable. Resolve this in a focused regression test and explicit compatibility decision during extraction; do not silently claim the seed fixes it. [Evidence audit](../research/led-evidence.md).

## Optional new asset receipt, separate from v1 claims

A richer acquisition receipt can be introduced without changing the evidence schema. Proposed fields:

| Field group | Information |
| --- | --- |
| Identity | Asset ID, component record ID, manufacturer/variant/package |
| Acquisition | Provider, source URL, acquired date, original filename, hash |
| Representation | STEP/WRL/other format, units, original path |
| Fidelity | exact-vendor / family / derived / unknown; supporting reason |
| Derivation | Input hashes, script/version, parameters, output hashes |
| CAD use | Symbol/footprint association, transform and seating plane |
| Checks | Dimensions/pin alignment checked, method/evidence, remaining physical checks |
| Publication | Selected preview/download status and permitted scope |

This is a proposed sidecar/registry, not a claim that the LED v1 record has those exact fields. Reuse existing reference/model descriptors first, and add only fields not already represented.

## Publication is a separate projection

The LED core applies three gates: selected instance, allowed field and acceptable value/URL. Preserve them. A source can have readable metadata while its URL or retained local extract remains excluded. Adding a record to the evidence inventory does not automatically publish it. [Publication core](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/core/publication.ts).

A generated project should start with no selected component assets. Onboarding can update publication selection according to the user's configured policy as part of the authorized task. A reviewable policy/count diff is required; a new conversational permission prompt for every part is not.

Keep raw source downloads outside `doc/public/` unless selected for publication. zudo-doc's `assetViewerExclude` affects viewer/index visibility, not whether a raw file is public. Asset search, llms output, raw agent-resource mirrors and generated HTML should all be included in relevant publication checks. [Asset viewer docs](https://zudo-doc.takazudomodular.com/docs/guides/asset-viewer/).

## Generated output and stale evidence

The generator reads evidence without modifying it and writes only its owned MDX/preview outputs. Generation freshness does not refresh the evidence. Source hash changes require explicit inspection and record updates.

An authored architecture page can mention a decision and link to the authoritative record/fact. It should not duplicate a long manually-maintained table of live component ratings. Keep current conclusions separate from historical reasoning. The LED project's evolving next-steps page illustrates why conflicting historical prose must not be the final source of a claim. [Next steps](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/src/content/docs/architecture/next-steps.mdx).
