# LED project asset workflow extraction

Reviewed repository: `Takazudo/zudo-led-lamp` at **194d8a297e3545588197342130c3111a66c10973**. Research date: 2026-09-26 JST. This report audits the repository's workflow and recorded findings; it does **not** rerun CAD derivation, independently verify vendor specifications, reserve stock, or establish hardware acceptance. Every hardware measurement below is identified as a recorded project observation. The downloadable initializer should teach the process, not ship these lamp measurements as universal facts.

## 1. What is worth extracting

The useful pattern is **an exact component identity connected to evidence, CAD lineage, reviewed transformations, and downstream deliverables**. “Download the 3D model” is already part of a larger, repeatable transaction in this project: find the exact orderable part, obtain its symbol/footprint/model, inspect the relationship between those assets and the chosen part, retain the source and correction history, generate previews, and state what physical checks remain. The top-level onboarding workflow owns this transaction, while `footprints/CLAUDE.md` owns the KiCad-specific portion. [New component workflow](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/new-component-workflow.md), [KiCad library workflow](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/footprints/CLAUDE.md).

The most instructive cases are C470643 and C5446803. Both assets were downloadable by the correct supplier code, yet neither was initially an exact mechanical/electrical match. A reusable initializer therefore needs to remember **what the file actually represents**, not just its URL and whether downloading succeeded. [Potentiometer asset record](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/footprints/vendor/C470643/README.md), [Switch asset record](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/footprints/vendor/C5446803/README.md).

## 2. Concrete source-to-output inventory

Counts below were computed from the complete GitHub tree at the pinned commit, not from a running local checkout. [Pinned repository tree](https://github.com/Takazudo/zudo-led-lamp/tree/194d8a297e3545588197342130c3111a66c10973).

| Layer | Existing location | Observed inventory / role |
| --- | --- | --- |
| Canonical footprint authoring | `footprints/kicad/*.kicad_mod` | 31 files |
| KiCad resolving library | `footprints/kicad/zudo-led-lamp.pretty/*.kicad_mod` | 31 mirrored files; the two sets must be byte-identical |
| Source/useable component models | `footprints/kicad/zudo-led-lamp.3dshapes/` | 27 STEP + 27 WRL files |
| Original/derived provenance | `footprints/vendor/<supplier-code>/` | C470643 notes; C5446803 originals, derivation script, measured report |
| Shared symbols | `symbols/zudo-led-lamp.kicad_sym` | One multi-symbol library; importer output must be merged per symbol |
| Board projects | `boards/<board>/` | Equal directory depth is required by the current relative model and library references |
| Generated footprint previews | `doc/public/assets/component-previews/footprints/` | 25 SVGs + a hash/renderer manifest |
| Public browser models | `doc/public/assets/component-previews/models/` | 25 WRL files; selected subset of local assets |
| Source PDFs | Temporary ignored path, for example `tmp/pdfs/` | No tracked PDF blobs in the pinned tree; short normalized evidence and PDF hashes are retained instead |
| Manufacturing release | `manufacturing/jlcpcb/2026-09-19/` | Per-board source snapshots, raw exports, Gerbers, BOM, CPL, checks, rendered views, manifest |

The distinction between downloaded inventory and selected public references matters. The current public page generator selects reviewed records; it does not automatically expose every local footprint/model or infer that all files are equally authoritative. Public document links are specifically reviewed document selections with a truthful kind (`datasheet`, `specification`, or `drawing`). [Reference construction](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/adapters/circuit/references.ts), [Model publication](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/adapters/circuit/model-assets.ts).

## 3. Case study: a correct supplier code can yield the wrong pin identity

### ALPS RK10J11E0034 / C470643

The project selected a single-unit potentiometer. The asset downloaded through EasyEDA for C470643 instead used the shared `RES-TH_RK10J12E0A0A` dual-unit footprint/model. The repository records that the original electrical pad numbers must not be used. Its corrected electrical row is `1 / MP1 / 2 / MP2 / 3`, with two other mechanical supports `MP3` and `MP4`; four mechanical pads are electrical no-connects. The wiper is pin 2. The project distinguishes the electrical mapping established from the drawing from rotation/direction behavior that still requires continuity/calibration checking. [Recorded correction](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/footprints/vendor/C470643/README.md).

The original STEP and WRL are retained using an explicit `_family` basename and individual SHA-256 hashes. The record calls this supplier-family geometry compared with a manufacturer drawing, not exact manufacturer-certified CAD. It notes wheel-center offset, wheel envelope, terminal reach, project-enlarged support slots, and remaining insertion/seating/assembly checks. It also avoids turning a drawing's “insertion (t:2 mm)” label into a new claim that the chosen 1.6 mm board is impossible. These are examples of making the model's applicability explicit instead of burying a disclaimer in an unrelated document. [Recorded geometry and fit limits](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/footprints/vendor/C470643/README.md).

**Reusable design lesson:** split `orderablePart`, `electricalPinMap`, `footprintLandPattern`, and `mechanicalModel` into linked identities. A match of supplier code establishes where the asset came from; it does not prove all four identities match. A part can have an audited pin map and a family-level mechanical preview at the same time. A single `verified: true` flag cannot describe this case.

## 4. Case study: a derived model should remain reproducible and labeled

### G-Switch SS-12D01-G020 / C5446803

The repository records a mismatch between the selected G020 part and downloaded `SW-TH_SS-12D01-GX` family CAD. Its source STEP has a 3.5 mm case with an actuator extending 4 mm above it; the selected variant needs a 2 mm actuator projection. The original WRL also uses a slightly different seating frame. The project retains the original STEP/WRL, their hashes, the manufacturer's drawing identity and PDF hash, and a detailed written account. [CAD discrepancy record](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/footprints/vendor/C5446803/README.md).

The correction is expressed as a versioned script, `derive-model.py`. It hash-checks the source, checks the source solid and measured bounds, verifies three terminals, removes only the actuator material above the chosen cut plane, and checks Boolean identity below the cut. It applies a rigid seating-frame translation rather than scaling the entire part. It writes STEP, reloads it and checks geometry/volume/bounds, then meshes that same reloaded solid to WRL. A normalized STEP timestamp makes the reported output hashes reproducible. This report inspected that code and its recorded audit; it did not execute the CAD operation. [Derivation script](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/footprints/vendor/C5446803/derive-model.py), [Measured audit](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/footprints/vendor/C5446803/model-audit.json).

The resulting assets remain explicitly **project-derived from supplier family CAD**. The record preserves open questions about molding/chamfer, actual seating, terminal protrusion, insertion, solder fill and assembler acceptance. The hole enlargement and its tolerance calculation are separately described as a project-adapted land pattern; they are not presented as the manufacturer's recommended footprint. [Derived asset scope](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/footprints/vendor/C5446803/README.md).

**Reusable design lesson:** a “correct model” workflow should emit a derivation recipe and a comparison report, not silently replace an original file with something that looks plausible. Each derived asset needs a source asset ID/hash, derivation tool/version, parameters, invariant checks, output hashes, intended use, and unresolved fit assumptions. This applies equally to shortened connectors, package-family variants, enclosure keep-outs and simplified collision geometry.

## 5. The reusable acquisition transaction

The sequence below is a proposed generalization of the source project, not an already implemented CLI contract. The original workflow is a mature lamp-specific process; the initializer should support incomplete new projects while preserving explicit missing information. [Source onboarding transaction](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/new-component-workflow.md).

### A. “Download the datasheet for this part”

1. Resolve manufacturer + exact MPN + supplier identifiers. If the input names only a family, record it as unresolved identity instead of silently choosing a variant.
2. Find the manufacturer's document or another explicitly classified source. Save the requested URL, final URL, retrieval time, HTTP metadata and document identity.
3. Download to a temporary/cache location; inspect redirects, `%PDF-` signature, title and actual page content. The repository explicitly warns that a `.pdf` URL may return HTML or a denial page.
4. Verify applicability to the chosen MPN and package. Record revision/date/document number, physical page index, printed page label and exact table/figure/row locator.
5. Retain file hash and short relevant normalized extracts. Treat full vendor PDFs as local transient/cached inputs by default in this source-derived design; explicitly choose what document URL becomes public.
6. Return a receipt stating which source was acquired, what identity it covers, where retained evidence lives and what remains unreviewed. Download success alone must not imply full specification verification.

This repository has an explicit dated document-verification record and keeps network refresh separate from deterministic generation. Copy that distinction into the initializer: a routine documentation build should not silently update manufacturer evidence based on whatever a live URL returns that day. [Source audit and public-document rules](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/new-component-workflow.md), [Offline reference constructor](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/adapters/circuit/references.ts).

### B. “Download the footprint and 3D data”

1. Use the exact supplier ID and an acquisition adapter. The lamp uses `easyeda2kicad --lcsc_id <ID> --footprint --symbol --3d --output <temporary-target>`.
2. Keep imported files separate long enough to inspect them. Merge just the imported symbol entry; do not overwrite an existing multi-symbol library.
3. Match pin numbering, pad location/shape, mechanical dimensions and mounting type with component evidence. Distinguish a package-family asset from exact-part CAD.
4. Store source files and hashes. Where changes are needed, keep a reproducible patch/derivation and a reviewed explanation.
5. Install the canonical footprint and models; review model origin, units, offset, rotation and scale. In the lamp's selected preview contract, both same-basename STEP and WRL are required, the footprint references WRL, and STEP is an audit/useable-CAD partner.
6. Regenerate human previews from canonical assets and record hashes. Return an action receipt that says whether the result is exact, family, derived, or still missing, plus the remaining physical checks.

The existing import notes describe historical rate limiting and filename collisions for shared passive footprints. Those are useful adapter diagnostics, not fixed universal retry timings. Tool errors should be interpreted per failed operation: an already-existing shared footprint does not prove the symbol/model import failed, and the caller should inspect the resulting inventory. [KiCad asset procedure and import observations](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/footprints/CLAUDE.md).

### C. “Check whether this specification is correct”

1. Resolve the exact claim and its conditions: value/unit, package/variant, min/typ/max or absolute maximum, temperature, supply, test setup and applicable revision.
2. Trace it to retained evidence, not to a matching filename, CAD appearance or a similarly named vendor part.
3. Report the outcome per claim/domain. A correct electrical rating does not establish pin-map correctness, mechanical fit, assembly process compatibility or bench behavior.
4. If the claim changes, report which derived calculations, schematic fields, BOM placements, pin maps, preview assets or fit assumptions depend on it.

The source BOM illustrates why this matters: its low-profile controls replace earlier choices; stock is explicitly dated; the TVS replacement note calls for exact vendor identity and re-auditing conditioned ratings/pad orientation; the circuit decisions retain both chosen/rejected reasoning and open verification questions. The reusable feature is those linked, qualified decisions, not the lamp's choices or stock numbers. [BOM](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/src/content/docs/architecture/bom.mdx), [Decisions](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/src/content/docs/architecture/decisions.mdx).

## 6. Recommended seed fields for an asset record

These fields are a proposal for local implementation. Names can be reconciled with the wider evidence model; avoid creating a second component identity registry.

| Field group | Required meaning |
| --- | --- |
| Identity | Asset ID, owning component record ID(s), exact manufacturer/MPN if known, package/footprint identity, supplier ID |
| Kind | Datasheet, drawing, symbol, footprint, STEP, WRL, derived preview or collision model |
| Provenance | Requested/final URL, source authority, retrieved date, source hash, original filename, license/redistribution metadata when known |
| Fidelity | Exact manufacturer asset, supplier asset matched to exact part, family model, project-derived model, generic model, unknown; evidence for classification |
| Applicability | Which exact variants, package and intended use this asset supports |
| Derivation | Source asset ID/hash, script/recipe path, tool version, parameters, output hashes, changed/unchanged features |
| Geometry | Unit/frame convention, origin, placement transforms, observed envelope, relevant dimensions and their evidence |
| Verification | Evidence review, pin-map review, mechanical comparison, pair consistency, visual review, physical-fit status; each distinct and dated |
| Publication | Local source/cache path, publish eligibility/selection, public derived path; preserve local source versus public preview distinction |
| Gaps | Missing asset, unresolved exact identity, family-only geometry, prototype fit check, unavailable supplier evidence |

For a new project, “not downloaded”, “family preview available”, and “not applicable because this is an off-board wired part” should all be honest supported states. The source lamp currently requires complete STEP/WRL pairs for every selected PCB preview. That is a useful publication/release gate; it should not prevent initializing a new circuit project or recording a candidate without a model. External purchased panel parts in the source are represented with `mounting: external`, no fabricated PCB footprint/LCSC identity, a real terminal map, and separate real board wire pads where needed. [External component handling](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/footprints/CLAUDE.md), [Reference exclusions](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/adapters/circuit/references.ts).

## 7. Preview features to extract

### Footprint SVGs

The footprint preview generator makes an isolated temporary `.pretty` library, suppresses footprint text only in the temporary copy, invokes a pinned KiCad renderer and normalizes exported SVG. It hashes canonical inputs and generated outputs, checks that source footprints did not change, and publishes a manifest describing renderer image/version, layers, options and postprocessing. It first enforces byte parity between the authoring and KiCad-resolution library directories. Its check command detects stale input/output hashes, missing/extra outputs and unreviewed selection changes. [Generation](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/footprint-previews/generate.ts), [Checks](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/footprint-previews/check.ts), [Parity](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/footprint-previews/parity.ts).

The existing renderer is pinned to KiCad 9.0.9 in an explicit `linux/amd64` image, including support for running on ARM via the declared platform. The current manufacturing export documents KiCad 10 separately. Preserve this distinction in configuration: changing the circuit author's KiCad version does not automatically authorize different preview bytes. Both should report their own toolchain versions. [Preview config](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/footprint-previews/config.ts), [Manufacturing requirements](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/manufacturing/README.md).

The human view uses a real SVG image/link without JavaScript, with an enlargement dialog as an enhancement. This is valuable for documentation and review: a broken interactive feature should not hide the footprint identity or its downloadable reference. [Footprint island](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/src/component-preview/footprint-preview-island.tsx).

### Interactive component 3D

The existing viewer is a Preact island using Three.js `VRMLLoader` and `OrbitControls`. It provides orbit/zoom/pan, enlargement, responsive camera fitting, lazy runtime import, explicit loading/error/no-WebGL states, and disposal on unmount. It renders on changes instead of running continuous animation. The caption identifies a shared footprint package, links the model file, and says that geometry may not match the exact manufacturer part. [Viewer island](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/src/component-model-viewer/package-model-viewer-island.tsx), [Runtime](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/src/component-model-viewer/viewer-runtime.ts).

Publication checks reject external/resource-loading VRML constructs, unsupported nodes, path escapes, symlinks and oversized previews. Only selected local WRL files are copied to the public directory; STEP stays in the project model store. These are deterministic public-asset boundary checks, not network specification audits. The public asset sync refuses to silently delete unknown model files, while the fully generated SVG directory can be replaced after validation. This ownership distinction is worth retaining. [Reference checks](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/adapters/circuit/references.ts), [Model sync](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/adapters/circuit/model-assets.ts), [Descriptor boundary](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/core/model-descriptor.ts).

**Extraction caution:** the runtime directly applies the stored footprint transforms to loaded VRML. For reuse as precise board/enclosure inspection, add explicit transform-unit/frame fixtures, including non-zero offsets and STEP/WRL alignment. The source's `derive-model.py` explicitly handles KiCad WRL unit conversion, but an attractive isolated viewer is not by itself dimensional evidence. This is a recommended verification task, not a claim that the current lamp viewer is wrong.

## 8. Manufacturing handoff worth preserving as an optional module

The retained manufacturing release goes beyond three export files. Its manifest records source commit and hashes, tool version, board identity, fitted counts, population overrides, exclusions, stale supplier-field normalization, coordinate convention, placement corrections and DRC/ERC results. Each board has a snapshot of actual export inputs, raw netlists/positions, BOM/CPL, actual Gerber ZIP, checks, and assembly/Gerber renders. The generator writes into a new empty release directory rather than overwriting an old release. [Manufacturing process](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/manufacturing/README.md), [Release manifest](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/manufacturing/jlcpcb/2026-09-19/manifest.json).

Three details translate especially well:

- **Population is a release decision.** The September 19 release assembles connectors that remain hand-fit/DNP in design defaults. These overrides are explicit and applied consistently to the snapshot, BOM and CPL; bare pads are separately excluded. A generic `DNP` boolean on a component definition alone cannot describe every manufacturing variant.
- **Placement correction is not footprint geometry.** RV1's 180° JLCPCB correction is stored by board/refdes and exact LCSC code, with the reviewed reason. The original placement coordinates are retained. The record explicitly avoids applying the correction twice.
- **Release status has evidence levels.** `ORDER-STATUS.md` records a user-reported order completion and the absence of independently checked factory acceptance/shipping or receipt. That is different from having generated a valid ZIP or having a placed order acknowledged by a factory.

[Release population and rotation explanation](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/manufacturing/README.md), [Part-locked correction source](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/manufacturing/jlcpcb-rotation-corrections.json), [Order status](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/manufacturing/ORDER-STATUS.md).

The manufacturing report also documents a mismatch between an older personal converter's coordinate behavior and the current release's convention. This is a strong reason for adapters that declare their toolchain/format conventions rather than treating an AI agent's remembered converter as timeless. The generic seed should preserve raw coordinates and verify the final exported Gerber/CPL data. It should not prescribe lamp-specific corrections or current supplier manufacturing rules without rechecking them for a new project. [Recorded coordinate decision](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/manufacturing/README.md).

Enclosure work follows the same pattern: source generator, pinned dependencies, model placement, hash-linked output manifest, geometry checks and a separate physical assembled-fit verdict. The documentation says source/mesh hashes are checked while actual seating, cable fit, solder clearance, optical behavior and temperatures remain bench work. This can be a later optional module; do not make all circuit projects initialize a lamp enclosure generator. [Enclosure source and checks](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/src/content/docs/architecture/enclosure.mdx).

## 9. Lamp-specific coupling to remove before extraction

| Existing coupling | Consequence | Generalization proposal |
| --- | --- | --- |
| `zudo-led-lamp.pretty`, `.3dshapes`, library nicknames | A second project inherits lamp names and fixed relative paths | Generate from project configuration |
| Boards must live exactly at `boards/<name>` | Path moves break KiCad model/library resolution | Declare board roots; generate/validate references or document one supported layout |
| Hard-coded `.claude/skills` evidence root | Other agents/locations depend on a Claude-specific structure | Core evidence root plus generated agent routing/adapters |
| Exactly 25 packages in reference construction/model publication/SVG generator/check | A new part addition requires editing program source | Centralized reviewed project selection expectations, with new empty projects supported |
| Exactly 35 aliased records in SVG generation | Legitimate new project sizes fail | Assert coverage against the selected manifest and a reviewed project-level lock, not lamp counts |
| One footprint must reference exactly one WRL | Multiple-model footprints and missing-CAD candidates are excluded | Keep as declared current adapter capability; support explicit unavailable state, extend intentionally later |
| Always require same-basename STEP/WRL pair | Candidate research cannot become a selected complete preview until pair exists | Separate research completeness from publish/fit gates |
| Personal BOM converter path | Export depends on the original user's machine | Optional supplier adapter with explicit installation/tool configuration |
| Lamp stock dates, population, board dimensions, LED/PD control gates | Misleading defaults in unrelated circuits | Example fixture only; never prefill them as accepted project evidence |

The repository explicitly directs new-part onboarding to update count locks in multiple code/test files. That choice is understandable for a reviewed fixed corpus; a reusable initializer should retain the intent of reviewed scope while moving the project-specific values into one project manifest. Simply removing every assertion would discard the regression protection. [Onboarding lock updates](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/new-component-workflow.md), [Hard-coded roots](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/adapters/circuit/paths.ts), [Count assertions](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/component-docs/footprint-previews/generate.ts).

## 10. Suggested implementation seeds and acceptance examples

The local implementation agent should receive these as small, independent source artifacts:

1. An `asset-acquisition` workflow: exact identity → retrieve → inspect → classify → retain → regenerate → receipt.
2. A `datasheet-source` record template with revision/hash/page/locator/conditions plus content-type verification and source refresh behavior.
3. A `cad-asset` record template with original/derived lineage, fidelity, units/transforms, dimensions and unresolved physical checks.
4. A `component-onboarding` recipe that connects evidence, inventory, symbol, footprint, preview and affected component pages.
5. A `manufacturing-release` template that preserves snapshot inputs, population variant, raw exports, final outputs, validations and release status.
6. Two **clearly marked historical case studies** based on C470643 and C5446803, useful for teaching agents the failure modes without making those specific parts default starter content.

Useful acceptance scenarios should check outcomes that an agent would otherwise get wrong:

| Scenario | Expected behavior |
| --- | --- |
| Datasheet URL returns HTML | No PDF evidence record is marked verified; retain a failed acquisition result |
| Supplier model is for a taller family variant | Preserve original, mark family fidelity, report mismatch, propose a reproducible correction |
| Exact symbol imported into a shared library | Existing unrelated symbols survive |
| Master footprint changed but `.pretty` copy stale | Parity check explains both paths and fails before stale previews are published |
| Same footprint used by multiple BOM parts | Package preview is shared; exact electrical/specification records remain distinct |
| STEP present, WRL absent | Explicit incomplete preview capability; no fabricated mesh or false completion |
| External wired potentiometer | No fabricated PCB footprint/model; real terminal identity remains visible |
| Component evidence updated but source geometry unchanged | No unnecessary re-download or model rewrite; regenerate only affected outputs |
| Release assembles a previously hand-fit header | Explicit population override, consistent BOM/CPL/snapshot, design default preserved |
| Manufacturer/source content hash changes | Mark source refresh requiring review; deterministic build never silently rewrites retained evidence |

These are proposed behaviors for `zudo-circuit-doc`, grounded in the observed repository mechanisms and failure cases. The next implementation step is to reconcile them with the doc engine and shared evidence contract, then replace hard-coded lamp paths/counts with configuration while keeping the existing provenance and review semantics.
