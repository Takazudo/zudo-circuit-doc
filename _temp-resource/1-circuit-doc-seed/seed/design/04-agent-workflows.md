# Agent workflows

The goal is to make short requests produce durable project knowledge. These are proposed reusable workflows, derived from the LED project's exact-component audit, new-component procedure, asset notes and integration rules. They do not require an interactive wizard for every step. The agent follows project policy, performs authorized routine work, and asks only when a missing fact or design choice prevents a meaningful result.

Source starting points: [new-component workflow](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/new-component-workflow.md), [footprint guidance](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/footprints/CLAUDE.md), [integration instructions](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/circuit-spec-integration/SKILL.md).

## Shared entry behavior

Read the current project brief, canonical workflow, inventory and existing records relevant to the request. Run the applicable offline audit before editing so pre-existing gaps are not confused with new ones. Route by exact manufacturer/MPN/order code and project role; a bare name such as AO3401A is not enough to resolve cross-vendor identity.

Use a short work note for a multi-step task: requested result, affected records/files, existing uncertainty, actions, new evidence and remaining work. Do not make a new document for every trivial download if its source record already carries the receipt.

## Workflow A — start a circuit

**Input:** An idea, constraints, sketches or an existing design.

1. Fill the project brief: intended behavior, interfaces, power source, dimensions, environment, quantity, constraints and unknowns.
2. Add an initial block diagram and identify the decisions that constrain component selection.
3. Record candidate components in authored research; keep unselected candidates out of the selected BOM inventory.
4. Choose the next useful task: investigate a key component, compare an interface, establish a mechanical envelope or specify a measurement.
5. Initialize integration rules only when a real interaction exists.

**Done:** Another agent can explain the goal and the next decision without reading the original conversation. Unknown electrical values remain unknown.

## Workflow B — add or replace an exact component

**Input:** Exact part/link, function, proposed placement or requested substitution.

1. Resolve the manufacturer, complete MPN/suffix, supplier ordering ID, package variant and population intent.
2. Locate an existing owner or create a standalone/subordinate v1 bundle. Parentage changes organization, not verification rigor.
3. Obtain relevant evidence through Workflow C.
4. Record identity, ratings, pinout, defaults, conditions and relevant behavior at the granularity needed by the design.
5. Map schematic pins, footprint pads and current nets. Treat board placement as project state with its own source revision.
6. Obtain/associate CAD through Workflow D if needed.
7. Reconcile the inventory against the configured identity provider. A manual inventory is valid only when it is the selected provider; it must not pretend to be reconciled against a schematic.
8. Apply the project's publication policy, update the committed selection/counts, generate docs and previews, and run applicable checks.
9. For substitutions, compare the affected electrical, firmware, startup, thermal and mechanical dependencies. Record changes to design decisions explicitly.

**Done:** One exact identity is traceable across the project and every outstanding gap is visible. “Added to the catalog” does not mean “suitable for production.”

## Workflow C — find/download a datasheet or supporting source

**Input:** Exact component and the fact(s) that require evidence.

1. Reuse a retained source if its identity, revision and scope meet the task.
2. Prefer manufacturer-primary sources for performance claims. Distributor pages may establish order identity in the narrow v1 identity lane.
3. Fetch the actual document bytes, not a search snippet or an HTML error page with a PDF filename.
4. Record document title/number, revision/date, source URL, retrieval date, availability and SHA-256. Retain the relevant page/section/table/row locator and minimal normalized extract.
5. Inspect pin diagrams, tables and graphs visually when text extraction loses their meaning. Keep physical PDF page index distinct from printed page label.
6. If acquisition is blocked, record `SOURCE UNAVAILABLE` and the genuine reason. Do not manufacture a hash or silently replace a manufacturer document with a similar part's sheet.
7. Refresh affected claims and their dependency closure. If a formerly unavailable source becomes available, do not bulk-mark all facts PASS merely because the download succeeded.
8. Keep the source receipt and evidence authoritative; regenerate readable references.

**Done:** The next agent can find exactly what was consulted and which facts it supports.

### Retention policy

The LED repository retains source hashes, locators and extracts; the inspected tree contains no tracked PDF files. A reusable initializer can add a configurable local source cache/archive, but must describe that as a new retention option. [Asset audit](../research/led-assets.md).

Suggested choices:

| Source storage | Meaning |
| --- | --- |
| Ignored local cache | Convenient working bytes, reproducible through source receipt if source remains accessible |
| Project-retained authorized archive | Durable source bytes when the project chooses to keep them |
| Public selected asset | Deliberate documentation download, subject to source-specific permission |

The hash belongs to the bytes actually inspected. A source URL can later serve different bytes. Do not interpret the old hash as proof of current remote content.

## Workflow D — obtain symbol, footprint and 3D model

**Input:** Exact orderable variant and intended board/mechanical use.

1. Resolve the part and package. Determine whether symbol, footprint and model already exist in the project.
2. Acquire available assets, recording provider, exact product/page, original filename, date and checksum. Keep the unmodified import alongside a documented derived version where correction is needed.
3. Inspect symbol pins and footprint pads against the exact datasheet. Numbering, EP/pad exposure, pin 1, polarity, pitch, drill, body envelope and mounting method need independent checks.
4. Check the 3D asset's variant, units, axis/origin, scale, rotation, translation, seating plane and dimensions against the available mechanical drawing.
5. Classify fidelity as exact-vendor, family/approximate, derived or unavailable, with the evidence supporting that label. A familiar shape is not proof of exact variant.
6. If deriving a model, preserve the upstream file hash, transformation/generator, parameters, output hashes and dimensional checks. Keep physical fit as a separate result.
7. Connect the footprint to project-relative model paths; confirm the actual KiCad project resolves them.
8. Regenerate selected footprint/WRL previews and check their input hashes. A missing chosen preview asset is an error; an intentionally unselected/unavailable model is a documented state.
9. Report which checks were performed and which remain visual or physical.

**Done:** A future agent can tell which file to use, why it matches, and what the model cannot establish.

The LED preview pipeline expects selected STEP+WRL pairs locally and publishes selected WRL previews. That is the current implementation's contract. CAD acquisition may retain other formats, but those are not automatically supported preview inputs.

### Why the workflow needs fidelity records

The lamp's C470643 potentiometer import needed an electrical pad correction and retained family-qualified 3D data. Its C5446803 slide-switch family model had a different actuator height from the selected variant; the repo records a reproducible derived model and dimensional audit. These are reusable process lessons, not universal corrections to apply to every potentiometer/switch. [Potentiometer record](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/footprints/vendor/C470643/README.md), [slide-switch record](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/footprints/vendor/C5446803/README.md).

## Workflow E — verify a specification

**Input:** A claim, component record, design decision or changed source.

1. Identify the exact claim, raw facts, units, conditions, provenance and source revision.
2. Determine the fact class: absolute maximum, recommended operation, guaranteed characteristic, typical curve, transient/protection condition, thermal/SOA or project state.
3. Inspect the relevant primary evidence; compare the requested use condition to the source condition.
4. Recompute calculations using explicit dependencies and units. A calculation cannot gain stronger evidence than its raw inputs.
5. Check cross-component interaction and the actual design state where the conclusion depends on rails, startup/defaults, pins, harnesses, thermal assumptions or firmware.
6. Record the v1 verdict and its reason. Preserve `NEEDS BENCH` and `UNSOURCED` where applicable.
7. Regenerate affected documentation, update the current decision/open question and run the related checks.
8. Present the finding as source-confirmed, violated, unsupported or awaiting measurement. Include the locator.

**Done:** The claim's meaning and evidential support are clear. A syntax/schema pass is not an electrical correctness result.

## Workflow F — record a bench result

**Input:** Actual measurements or a user-supplied test log.

Record board revision, population changes, firmware/configuration, instrument/setup, supply/load, ambient conditions, method, raw observation, expected range and conclusion. Keep raw data/photographs linked when available. Use `BENCH-OBSERVED` provenance rather than forcing a measurement into manufacturer-primary PASS.

One test result applies to its tested configuration and conditions. It does not automatically validate all units, future component substitutions, source revisions or environmental conditions. On a failed test, connect the finding to the affected design decision and next action.

## Workflow G — source or design change

**Input:** Updated datasheet, component substitution, footprint edit, firmware change or schematic/net change.

Find all references to affected source/fact/record IDs. Evaluate stale project-state hashes, calculated dependencies, integration rules, pin maps, footprint/model hashes and authored decisions. Update each affected item or mark it pending with a reason. Do not clear unrelated unresolved items merely to get a clean output.

The workflow should produce a small reviewable diff containing evidence, the relevant design state, generated pages and any revised decision. Never re-pin a source hash without inspecting the changed bytes.

## Completion response pattern

A useful final task report has four parts: what was obtained or checked; the relevant exact part/source/variant; changed project records and generated outputs; remaining work with the reason. Include the evidence locator or asset receipt. Keep routine tool chatter out of the report.

Examples of compact bilingual user requests are supplied in [templates/agent-task-examples.md](../templates/agent-task-examples.md).
