# LED evidence system: extraction research for zudo-circuit-doc

Research snapshot: `Takazudo/zudo-led-lamp` at commit `194d8a297e3545588197342130c3111a66c10973`, reviewed 2026-09-25 UTC / 2026-09-26 JST. This is an audit of the repository's evidence system and reusable workflow. The component values, source availability, review dates and verdicts described below are **the repository's retained claims**. This session did not re-download vendor PDFs, independently verify electronic ratings, run KiCad ERC, program hardware, or perform bench measurements.

The corresponding `led-evidence-sources.json` lists all 52 retrieved files with pinned GitHub permalinks and Git blob SHA-1 values. Archived originals are mapped by `../sources/file-manifest.json` into `../references/upstream/led/`, with an inert `.source` suffix. Every archived file was checked against its Git blob hash, so these reference copies preserve upstream bytes. They are research inputs, not installed skills.

## 1. Main finding

The LED project already contains a circuit-development knowledge system that is substantially generic. The initializer should extract and parameterize it, preserving its v1 record contract. Creating a second simplified component database would lose the work already done to distinguish part identity, documentary evidence, project choices, calculations and physical verification.

The natural reusable unit is **an exact orderable component evidence record**, with one or more records organized inside an owner bundle. The current inventory contains 35 orderable lines, 31 fitted lines, four DNP/hand-fit lines, 92 board/refdes placements and 14 owner bundles. These are the LED snapshot's reviewed corpus counts, not starter defaults. [Inventory](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/inventory.json)

The primary extraction problem is at the boundary around this generic model: hardcoded board specifications, LED library names, corpus fixtures, pin locks, integration domains, publication selections and frozen review assertions. The record contract and its reference template are reusable now; the complete existing validator is not yet a generic initializer runtime. [Validator](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/scripts/validate.py)

## 2. Observed ownership and truth model

| Concern | Existing owner | Meaning for extraction |
| --- | --- | --- |
| Circuit identity and placement | Declarative board generator specifications | Establish the selected MPN, LCSC ID, symbol, package, DNP state, board and refdes. |
| Routing to evidence | Central `references/inventory.json` | One inventory line per orderable identity, potentially many placements. |
| Component evidence | The assigned `component-*` owner bundle | Authoritative structured sources, facts, coverage, routes, interactions and pin maps. |
| Multi-component effects | `circuit-spec-integration/references/rules.json` | Explicit relevant records, fact IDs, conditions, calculations and honest outcomes. |
| Human reference | Generated component MDX | A projection of JSON, not another place to author facts. |
| Physical/programmed/bench state | Separate evidence stages and explicit missing artifacts | Schematic intent never proves assembled or measured state. |

The central skill says to resolve a subordinate record directly rather than answer only from its parent. Parentage is organizational: a sense resistor or diode inside an LED-driver bundle still owns its own sources, facts, coverage, routes and pin map. The passives bundle also demonstrates that multiple independent `standalone` records may live in one owner bundle; an owner directory does not have to equal one component. [Audit workflow](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/SKILL.md), [Contract](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/contract.md), [Passive manifest](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-project-passives/manifest.json)

## 3. The v1 files and exact semantics

The eight required owner files are `SKILL.md`, `manifest.json`, `sources.json`, `facts.json`, `coverage.json`, `routing.json`, `interactions.json` and `pin-map.json`. The file named `schema.json` is a custom contract containing required-key lists, enumerations and prose invariants. It is **not a standard JSON Schema document** that an off-the-shelf JSON Schema validator can directly apply. The Python validator implements additional invariants. [Schema](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/schema.json), [Validator](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/scripts/validate.py)

### 3.1 Manifest and inventory

Each manifest record requires `record_id`, `line_id`, `kind`, `parent_record_id`, `mpn`, `manufacturer`, `lcsc`, `package`, `source_ids`, `fact_ids`, `interaction_ids` and `open_domains`. `kind` is `standalone` or `subordinate`. A subordinate parent must resolve to a standalone record within the same bundle. A standalone parent is `null`.

The listed source, fact and interaction IDs must match exactly the objects assigned to the record: no omissions, duplicates or unexplained orphan entries. Sources belong to exactly one record, and a fact must cite a source belonging to that same record. Calculated facts may depend on facts in other records inside the bundle. Each record must also have a manufacturer fact whose ID ends in `-manufacturer`, plus coverage, routes and a pin map. [Validator: `validate_bundle`](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/scripts/validate.py)

Inventory lines require `line_id`, `mpn`, `manufacturer`, `lcsc`, `package`, `dnp`, `owner_skill`, `identity_state`, `source_state`, `function` and `placements`. The identity state is `VERIFIED` or `UNRESOLVED`; source state is `AVAILABLE` or `SOURCE UNAVAILABLE`. A placement is a board/refdes pair. Current PCB lines require an LCSC-style `C` number. Purchased external components use `mounting: external`, blank LCSC/PCB footprint, and exact manufacturer/supplier/order-code declarations. Bare-copper test/pogo pads are explicit exclusions, not fabricated orderable parts. [Inventory validation](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/scripts/validate.py), [External component workflow](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/new-component-workflow.md)

### 3.2 Sources

A source lock requires the document title/number/revision/date, primary and optional alternate URL, retrieval date, authority class, SHA-256, availability, physical PDF page index, printed page label, exact locator and normalized evidence extract. The physical index is zero-based; printed numbering remains a separate string. A page-like source uses explicit labels such as `web page` or `source file` with an index of zero. The same document may have separate source records for different owning components or physical-page locators. [Contract](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/contract.md), [STUSB source records](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-stusb4500qtr/sources.json)

Allowed authority classes are `MANUFACTURER_PRIMARY`, `MANUFACTURER_MIRROR`, `REFERENCE_DESIGN`, `DISTRIBUTOR_IDENTITY`, `PROJECT_GENERATOR` and `BENCH_RECORD`. Availability is independent of authority. An available mirror can be useful retained evidence without qualifying for the contract's manufacturer-primary PASS. An unavailable source must use 64 zeroes as its SHA-256; an available source must not use that sentinel. Historical extracts may remain on unavailable sources but cannot support newly promoted claims. [Schema](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/schema.json)

Source authority is reviewed metadata, not something a content hash proves. A hash establishes that bytes match a lock; it does not validate the technical interpretation or the publisher. In this snapshot some vendor-authored distributor-hosted drawings are classified as manufacturer primary, whereas the STUSB archive mirror remains manufacturer mirror. Preserve the recorded classification and require an explicit source review to change it. [STM32 bundle's DEALON drawing source](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-stm32g031f8p6/sources.json), [STUSB sources](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-stusb4500qtr/sources.json)

The validator also has an optional `VOLATILE-HTML` refresh lane, restricted to available distributor identity evidence. It requires a canonical `identity_extract_sha256` and an explicit note that live HTML refresh is not deterministic. Dated stock observations must not become permanent procurement facts. Other sources default to `HASH-LOCKED`. [Validator: `validate_source`](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/scripts/validate.py)

### 3.3 Facts, calculations and verdicts

A fact requires `fact_id`, `record_id`, `source_id`, `class`, `value`, `unit`, `conditions`, `locator`, `provenance`, `verdict`, `depends_on` and `expression`. Textual facts use unit `NONE`; quantitative facts carry explicit units and conditions. Preserve rating categories rather than turning them into a generic maximum.

| Dimension | Exact vocabulary |
| --- | --- |
| Fact class | `ABSOLUTE_MAXIMUM`, `RECOMMENDED_OPERATION`, `GUARANTEED_ELECTRICAL`, `TYPICAL_CURVE`, `TRANSIENT`, `PROTECTION_STANDOFF`, `PROTECTION_BREAKDOWN`, `PROTECTION_CLAMP`, `THERMAL_SOA`, `PROJECT_STATE` |
| Provenance | `PRIMARY-SPEC`, `DISTRIBUTOR-IDENTITY`, `REFERENCE-DESIGN`, `CALCULATED`, `PROJECT-CHOICE`, `BENCH-OBSERVED`, `UNVERIFIED` |
| Verdict | `PASS - primary-source confirmed`, `CONFIRMED - distributor identity only`, `BLOCKER - deterministic spec violation`, `NEEDS BENCH`, `UNSOURCED`, `NOT APPLICABLE` |

[Frozen vocabulary](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/schema.json)

A raw fact has empty dependencies and expression. A calculated fact has a nonempty dependency list and arithmetic expression. Expression names replace hyphens in fact IDs with underscores. The expression must name exactly the listed dependencies; missing, unused, undeclared, self or cyclic references fail. The evaluator allows only bounded arithmetic, and a retained calculated value must recompute exactly. This is arithmetic validation, not dimensional analysis: unit conversion is still explicit authored logic. [Validator: `arithmetic`, `validate_facts`](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/scripts/validate.py)

Primary PASS requires an available manufacturer-primary source. Calculated PASS requires every raw leaf of the full dependency closure to be a primary-source PASS; a project-choice input does not become manufacturer evidence through arithmetic. Deterministic BLOCKER similarly requires trusted evidence. A plausible value from memory, a same-name alternate vendor or a distributor listing cannot become a deterministic electrical claim. [Contract](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/contract.md)

The distributor identity exception is deliberately narrow: the fact must pair `DISTRIBUTOR-IDENTITY` provenance with `CONFIRMED - distributor identity only`, use class `PROJECT_STATE`, cite an available `DISTRIBUTOR_IDENTITY` source, and have a structured value containing exactly `lcsc`, `manufacturer`, `mpn` and `variant`. Its canonical JSON hash must match the source's identity hash. That fact cannot support electrical or thermal limits, calculations, primary PASS or deterministic BLOCKER. [Validator: `validate_facts`, `validate_bundle`](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/scripts/validate.py)

### 3.4 Coverage and pin maps

Coverage records explicitly name a domain, `COVERED` or `OPEN`, a reason, fact IDs and `blocking_fact_ids`. `open_domains` in the manifest must match the set of `OPEN` domains exactly. Blocking IDs are a unique same-record subset of the coverage fact IDs. For an open entry, named blockers must be `UNSOURCED`, `NEEDS BENCH`, or cite unavailable sources; when listed facts contain blockers, the array cannot be empty. The validator requires at least one such ID, not necessarily every possible blocking ID. Reasons that claim unavailable/lower-authority/UNSOURCED evidence must name blocking facts. [Contract](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/contract.md)

`COVERED` means explicit evidence with an available, non-UNSOURCED dependency closure; it is not a synonym for component PASS or complete circuit verification. The AL8860 limits domain is covered while some current calculations remain `NEEDS BENCH`. The UI must preserve both pieces of information. [AL8860 coverage](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-al8860mp-13/coverage.json), [AL8860 facts](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-al8860mp-13/facts.json)

A pin map identifies its record, symbol, footprint, all physical symbol pins, footprint pads, pin names/functions and reviewer. Current validation requires unique symbol and pad numbers and checks these against actual local KiCad assets. It also enforces symbol-pin number equals footprint-pad number. External devices reuse `footprint_pad` to hold the physical terminal number while leaving the footprint empty; this unusual meaning is explicitly documented upstream. [Pin validation](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/scripts/validate.py), [External devices](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/new-component-workflow.md)

## 4. Representative lessons from real records

### AL8860: a clean extraction example with useful boundaries

The bundle groups the driver with a TA-I sense resistor, Cjiang inductor and exact R+O SS26 catch diode. Its driver facts distinguish a 40 V recommended input maximum from 42 V absolute maximum, retain EP thermal handling, and calculate current/power from explicit raw IDs. The inductor's primary document supports some properties while the mirror-only max-design current columns remain open. The R+O SS26 record records an unsuccessful primary retrieval rather than borrowing another vendor's SS26 datasheet. These are useful regression examples for exact identity and partial source recovery. They should remain example data, not starter BOM choices. [Manifest](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-al8860mp-13/manifest.json), [Sources](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-al8860mp-13/sources.json), [Coverage](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-al8860mp-13/coverage.json)

### STUSB4500: failed retrievals and programmed state remain useful knowledge

The STUSB bundle retains dated failed st.com retrieval attempts separately from reproducible archive mirror records. A later agent is told not to treat those failures as permanent, and not to erase their meaning by assuming primary trust. The record asks for an NVM acceptance artifact containing normalized bytes, hash, decoded fields, tool version, pre-write dump, post-write readback, reset readback and power-cycle readback. This turns a recurring conversation into a concrete acceptance checklist. A requested NVM image is distinct from evidence that a particular board actually contains it. [STUSB workflow](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-stusb4500qtr/SKILL.md), [Facts](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-stusb4500qtr/facts.json)

### STM32: physical pin, alternate function and firmware state differ

The MCU record distinguishes multiple GPIO labels sharing one package pin from software-remappable bracketed names. It links package mappings, reset/boot behavior, ADC acquisition constraints, debug state and errata to the relevant documents. Those ST documents are marked unavailable in the frozen record, so retained technical leads remain unverified. The schematic's PA0 brightness assignment is a project-state fact; it does not prove that ADC configuration, option bytes or firmware have been programmed. This is a model for any programmable device's evidence. [STM32 facts](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-stm32g031f8p6/facts.json), [Pin map](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-stm32g031f8p6/pin-map.json)

### Passives: exact parts matter even when values look ordinary

The passive owner is not a generic resistor/capacitor table. It keeps exact Samsung/Yageo/UNI-ROYAL orderables, rating conditions, temperature derating, DC-bias/simulation caveats and placement-specific topology. For the 150 kΩ resistor, the record retains nominal resistance, tolerance, power, voltage cap, TCR, a derived P×R quantity and an open installed-waveform pulse domain. For the 100 nF Yageo part, nominal capacitance is distinct from effective capacitance under installed bias/aging/ripple. Zero-ohm jumpers use their current conditions instead of the normal resistor voltage formula. [Passive workflow](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-project-passives/SKILL.md), [Passive facts](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-project-passives/facts.json)

## 5. Reusable end-to-end onboarding

Upstream deliberately gives the existing `component-spec-audit` skill sole end-to-end ownership. It says not to invent a separate catalog-update/onboarding skill. An initializer should preserve a single coherent task flow even if its installed name or agent wrappers later change.

1. Resolve exact MPN/manufacturer/supplier identity, board/refdes, DNP state, symbol, footprint, pin map and connectivity.
2. Update the authoritative circuit identity source and central inventory together.
3. Create the evidence owner from the existing template; replace every placeholder, retain every required file, record uncertainties honestly.
4. Acquire symbol, footprint, STEP and WRL; review pin/pad mapping, polarity, orientation, size and model transforms.
5. Explicitly choose records, source links, document kinds and previews that become public.
6. Generate previews and human reference pages, run contract/build checks, then review the new route and physical schematic.

[Complete observed workflow](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/new-component-workflow.md)

Datasheet acquisition means more than retaining a URL. The workflow follows redirects, retains response headers during inspection, checks `%PDF-`, and inspects the document title/content against the exact part. A URL ending in `.pdf` can return a product page or denial HTML. The public document is explicitly classified as `datasheet`, `specification` or `drawing`, with a dated verification record. Vendor PDFs are downloaded into ignored `tmp/pdfs/`, extracted, and removed; normalized minimal evidence is retained. Online hash refresh is opt-in, uses a process-unique temporary directory and does not rewrite source evidence. [New component workflow](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/new-component-workflow.md), [Refresh implementation](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/scripts/validate.py)

## 6. Integration and source-to-bench chain

Integration rules explicitly name all relevant records/facts, conditions, an honest verdict and what cannot yet be concluded. They include conditioned calculations with declared scenario inputs. The generic pattern is useful; the current eight rule domains, component IDs and their actual outcomes belong to the lamp project.

The retained evidence-chain stages are: `official-source`, `conditioned-requirement`, `generated-netlist`, `symbol-footprint`, `pcb-orientation`, `bom-cpl`, `as-built`, `programmed`, `bench`. The central lesson is that completing one stage does not imply completing later stages. Current statuses `CONFIRMED`, `MIXED`, `OPEN` are separate from fact verdicts. The lamp snapshot's downstream stages deliberately remain open. A new initializer must not bake this historical result into a generic stage engine; it should preserve requirements for real evidence before a stage closes. [Integration rules](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/circuit-spec-integration/references/rules.json)

The testing evidence is also carefully scoped. Deterministic forward fixtures prove routing and discovery parity. `observed-runs.json` records responses to explicit skill invocation with frozen evidence and tools disabled; it expressly does not prove independent model discovery. Some later entries are parent-session responses, not independent subagents. Do not describe these as a fully validated autonomous hardware agent. [Forward fixtures](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/circuit-spec-integration/references/forward-tests.json), [Observed-run provenance](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/circuit-spec-integration/references/observed-runs.json)

## 7. Extraction blockers and compatibility decisions

| Current implementation | Why it cannot be copied unchanged into a new project | Proposed treatment |
| --- | --- | --- |
| `generator_inventory()` defaults to board-p, board-l, swd-adapter | `validate_inventory()` ignores the declared `generator_specs` list and calls those defaults; even an empty list falls back through `specs or (...)` | Explicit board-identity adapter/config; distinguish `None` from empty. |
| `expected_mpn()` has a C144397 special case | Corpus knowledge lives in runtime code | Move the exception into reviewed project data or a named adapter. |
| PCB lines require LCSC IDs | New projects may source exact parts from other suppliers | Keep v1 compatibility for the first extraction; treat broader supplier identity as a versioned design decision, not a silent field change. |
| `validate_pin_assets()` uses zudo-led-lamp library paths | New projects own different assets | Project config supplies symbol/footprint libraries. |
| Pin validator requires identical pin/pad numbering and uniqueness | Other existing KiCad libraries may need repeated pad numbers or a reviewed mapping | Explicit compatibility decision; do not weaken checks without examples and intended semantics. |
| `validate_real_pin_locks()` forces STUSB UNSOURCED and AL8860 EP 9 | Locks encode this particular reviewed corpus | Keep as LED regression fixture; generic runtime validates declared locks. |
| Critical review requires fixed domains and two independent passes | An empty project cannot supply real reviews | Separate generic contract checks from optional project review-policy gates. |
| Refresh evidence requires generator and manufacturer examples | Empty projects have no sources | No fabricated refresh records; report not applicable until evidence exists. |
| Integration validator requires exactly eight LED domains, NEEDS BENCH/UNSOURCED, and last five chain stages OPEN | This freezes historical lamp outcomes, preventing future genuine closure | Project-reviewed assertions belong to fixtures; generic engine validates shape/evidence, not a permanent outcome. |
| Root `.claude/skills` paths and trigger text | Couples data storage to one agent convention | Preserve v1 bundle semantics; make future Claude/Codex routing adapters point to the same data. |
| Corpus count/publication locks | Adding any real part requires updating deliberately reviewed projections | Parameterize identities/paths while keeping reviewed count changes explicit. |

[All validator couplings](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/scripts/validate.py), [Onboarding publication locks](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/references/new-component-workflow.md)

### Observed consistency caveats to preserve as follow-up tests

- `fact_blocks_domain()` comments and the frozen prose say `NOT APPLICABLE` never blocks, but the implementation returns true if such a fact cites `SOURCE UNAVAILABLE`. A focused local call reproduced this edge case. Decide the intended behavior explicitly before extraction; do not silently change the archived contract.
- The inventory's AL8860 summary remains `UNRESOLVED` / `SOURCE UNAVAILABLE` although its own current primary-source driver facts are PASS. The validator checks allowed summary values but does not derive them from owner facts. Treat inventory as routing/placement identity; derive or clearly label UI readiness from detailed evidence rather than assuming this summary is current.
- AL8860 narrative calls DSW an analog/PWM duty range while `fact-al8860-duty-band` explicitly identifies internal buck-switch duty and distinguishes CTRL dimming. This illustrates why JSON authority and generated human projection matter. Preserve the fact's explicit condition when producing new documentation.
- `validate_facts()` checks arithmetic and required nonblank units, not unit dimensions or whether prose correctly interprets a vendor table. The validator supports review; it cannot replace source reading and physical verification.

[Blocking and inventory behavior](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/scripts/validate.py), [AL8860 narrative](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-al8860mp-13/SKILL.md), [AL8860 fact](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-al8860mp-13/facts.json)

## 8. Concrete starter seeds supplied by this research

`led-evidence-empty-inventory.json` retains the existing top-level v1 inventory shape with empty `generator_specs`, `exclusions` and `lines`, and all three reviewed counts set to zero. It has no pretend component IDs, sources, ratings, pins or placements. This is a proposed initializer seed, **not a claim that today's full LED validator accepts it**.

The eight unmodified upstream template files are archived at `../references/upstream/led/.claude/skills/component-spec-audit/assets/component-skill-template/` (each filename has the `.source` suffix). They intentionally contain `EXAMPLE-MPN`, `C000000`, `example.invalid`, zero hash and UNSOURCED facts. They are reference templates and must never enter an active project as a real selected component. [Upstream template](https://github.com/Takazudo/zudo-led-lamp/tree/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/assets/component-skill-template)

Focused verification performed here:

- The unchanged archived template passes the upstream `validate_template_skill()` and `validate_bundle()` pure checks.
- An aggregate with empty `records`, `sources`, `facts`, `coverage`, `routes`, `interactions` and `pin_maps` passes the pure bundle validator. This proves the bundle core can represent no records; it does not establish empty-project CLI/build support.
- All 52 archived source files match their pinned Git blob hashes.

Suggested first local implementation milestone: initialize a documentation site with zero real parts and no fabricated validation history, then onboard one actual user-selected component through the full preserved contract. Keep the complete lamp corpus available as a separate regression/example project. This tests the intended workflow while avoiding accidental inheritance of the lamp BOM, rails, thermal assumptions, old source outcomes and deployment setup.

## 9. Portability follow-up: non-LCSC parts and research before schematics

The limits occur at different layers; saying that all v1 records require an LCSC ID would be inaccurate.

| Layer | Observed current behavior |
| --- | --- |
| Owner manifest and bundle validation | Requires an `lcsc` key but permits an empty string. The exact MPN, manufacturer, package, real pin map and evidence obligations remain. |
| Owner routing | A blank-LCSC record uses `aliases.lcsc: []`; exact MPN/manufacturer routes still work. Alias classes are fixed to `mpn`, `lcsc`, `manufacturer`, `function`; there is no supplier-SKU alias class. |
| Central direct-routing tests | Skip empty query strings using `filter(None, queries)`, so absence of LCSC is supported here too. |
| Central PCB inventory | Requires `lcsc` to match `C[0-9]+` for `mounting: pcb`; it uses LCSC as the grouping key. |
| Board generator inventory | A PCB component tuple with blank LCSC becomes an excluded board feature. Only explicitly declared external components take another path. |
| Placement validation | No direct nonempty-array assertion, but inventory placements must exactly equal generated board/refdes/DNP placements. Therefore a manually researched selected part cannot simply be added with `placements: []` to the existing CLI. |
| External component path | Blank LCSC is valid for actual externally mounted parts with supplier/order code; it must not be used to disguise a Mouser/DigiKey-sourced PCB component. |

[Targeted implementation: `generator_inventory`, `inventory_key`, `validate_inventory`, `validate_routing`, `validate_bundle`](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/scripts/validate.py)

A focused in-memory check confirmed that the unchanged pure bundle validator accepts the existing template shape with `lcsc: ""`, empty LCSC aliases and exact MPN/manufacturer routes. Central direct routing also accepts that shape. No fabricated C number is necessary in the owner contract.

### Proposed smallest explicit generalization

Keep the v1 owner evidence contract unchanged and introduce an explicitly documented **generic inventory adapter/profile**. This is a compatibility decision for the initializer, not an assertion that the current LED CLI already supports it.

1. Keep `lcsc` present and permit `""`; when a C number is present, validate it. Use stable `line_id` joins and reviewed exact manufacturer/MPN/package identity instead of treating LCSC as the universal key.
2. Declare whether inventory identity currently comes from manually reviewed selected parts or from a configured schematic/generator adapter. A manual selected part can have an empty placement list; the check report must state that schematic binding has not been performed. This message is a validation-scope result, not a new fact verdict or a successful schematic check.
3. Keep supplier order codes in explicitly additive procurement metadata keyed by `line_id`, or separately documented optional inventory fields. Do not place a distributor SKU into `mpn`, invent a C number, or classify a PCB part as external. The first generic release can resolve exact MPN/manufacturer identities without promising arbitrary Mouser/DigiKey SKU routing.
4. When a schematic exists, its adapter resolves actual placed identities back to `line_id`, and the full placement, symbol and footprint parity gates apply. Keep the lamp's generator adapter and its strict regression corpus intact.
5. Keep early candidates whose exact package/pins remain unknown in research/intake notes until they can be promoted to a complete v1 evidence record. The existing owner contract requires real pin-map entries; filling that obligation with hypothetical pins would create false evidence.

The alternative is a smaller first release explicitly limited to LCSC-selected PCB BOMs plus the documented external-parts workflow. That is feasible, but it must be stated as a product limit; it would not yet meet a broad claim that arbitrary circuit projects can use the same initializer.

Another routing limitation should remain visible: `resolve_identities()` rejects more than one MPN match before manufacturer filtering, and direct-routing checks expect a bare MPN to identify one record. A project selecting same-named parts from multiple manufacturers will therefore need an explicit ambiguity-handling change. A generic resolver should preserve refusal for an ambiguous bare MPN while permitting a reviewed exact manufacturer/MPN identity; do not silently loosen wrong-vendor rejection. [Resolver](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/.claude/skills/component-spec-audit/scripts/validate.py)
