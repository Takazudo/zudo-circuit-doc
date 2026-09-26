---
name: component-ti-tmp1075dr
description: Resolve exact Texas Instruments TMP1075DR (SOIC-8, TI package D) temperature-sensor limits and application constraints. Use whenever TMP1075DR, its DigiKey order code 296-51833-1-ND, its pins, I2C address, supply range, accuracy, supply current, package, bypass or pullup values, substitution, bring-up or firmware behavior is relevant.
---

# TMP1075DR exact component record

Run the central validator, read every local JSON record, and cite fact/source IDs with
conditions and locators. Every source in this bundle is one retrieval of TI datasheet
SBOS854F (revision F, revised June 2024), split per page group: each source carries the
0-based physical PDF page index and the printed page label of its page. Preserve
`NEEDS BENCH` and `NOT APPLICABLE`; never replace exact-orderable evidence with memory or
same-name vendor data.

- This record is the TMP1075 (non-N) variant. The TMP1075N rows of the datasheet
  (1.62 V to 3.6 V, SOT563) do not apply; `fact-tmp1075n-vplus-range` records that.
- Keep the 6.5 V absolute maximum separate from the 1.7 V to 5.5 V recommended supply,
  and guaranteed accuracy/IQ maxima separate from the typical values.
- Datasheet accuracy is the sensor's error. The fitted breakout's measurement error and
  self-heating stay `NEEDS BENCH` until measured.
- The address `0x48` is the datasheet's binary `1001000` with A2 = A1 = A0 = GND.
- LCSC is deliberately empty: this example exercises the generic (non-LCSC) inventory
  profile. The DigiKey order code in the inventory is display-only and not evidence.
- TI regenerates this PDF (the addendum is appended live). A later hash change at the same
  revision means "regenerated; re-verify locators", not corruption.

Keep this owner aligned with its `manifest.json`, `sources.json`, `facts.json`,
`coverage.json`, `routing.json`, `interactions.json` and `pin-map.json`, its inventory
line and its direct-routing case.

## Human component reference

Human projection of this bundle: [rec-tmp1075dr](/docs/components/records/tmp1075dr/).
These pages are generated from this bundle's JSON files and add nothing to them; where
the two disagree, this bundle is correct. See also the [component
catalog](/docs/components/catalog/) and the [cross-component rules](/docs/components/integration/).
