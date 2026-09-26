# KiCad SOIC-8 imports for TMP1075DR

Unmodified files taken from the official KiCad libraries on 2026-09-26, kept next to the project-library copies derived from them. The receipts are in `circuit/cad-receipts/`:

- [kicad-soic8-footprint.receipt.json](../../../circuit/cad-receipts/kicad-soic8-footprint.receipt.json)
- [kicad-soic8-model.receipt.json](../../../circuit/cad-receipts/kicad-soic8-model.receipt.json)
- [kicad-tmp1075d-symbol.receipt.json](../../../circuit/cad-receipts/kicad-tmp1075d-symbol.receipt.json)

## Files in this directory

| File | Library and tag | SHA-256 |
| --- | --- | --- |
| `SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod` | kicad-footprints `9.0.9`, `Package_SO.pretty/` | `623e154d907cd3e49387a81775898feee35c4ed5fd3317865ad11c322f72adfb` |
| `SOIC-8_3.9x4.9mm_P1.27mm.wrl` | kicad-packages3D `8.0.9`, `Package_SO.3dshapes/` | `2b84645ac35f878381da69ebf467feab9e5f054922c809c1b28a1586dd4e462d` |

The matching STEP (kicad-packages3D `8.0.9`, SHA-256 `d9b46f6dd6cf8c5e2028838eed38e2a6a7f26235856078511e5a71a594ca809e`) is used unmodified, so it is kept only in `footprints/kicad/example-minimal-circuit-lib.3dshapes/`.

## Fidelity: family

These are generic JEDEC MS-012AA package assets, not TI CAD:

- The footprint pads, 1.95 × 0.6 mm at x = ±2.475 mm, differ from TI's D0008A example land pattern, 1.55 × 0.6 mm with a 5.4 mm row span (SBOS854F physical page index 39). Using a generic IPC/JEDEC land pattern is a project choice (`fact-tmp1075-footprint-choice`).
- The KiCad `TMP1075D` symbol's default footprint, `Package_SO:SO-8_3.9x4.9mm_P1.27mm`, is an NXP PCF8523-derived pattern (pads 1.75 × 0.6 mm at ±2.575 mm). It is not used, so that the footprint and the 3D model come from one JEDEC package family.
- The WRL is in 0.1-inch units. Converted to mm, its extents are x ±3.000, y ±2.451 and z 0 to 1.750. That is a 6.00 mm lead-tip span, a 3.90 × 4.90 mm body and a 1.75 mm height, inside TI's 5.80–6.19 mm lead span, 3.81–3.98 × 4.81–5.00 mm body and 1.75 mm maximum height.
- Physical seating, solder fillet and clearance are **open**: they need an assembly or bench check (`fact-tmp1075-cad-physical-fit`, NEEDS BENCH).

## Derivations

`derive.mjs` rebuilds the project copies from the two files above, checking their hashes first:

```sh
node footprints/vendor/kicad-soic8/derive.mjs          # write
node footprints/vendor/kicad-soic8/derive.mjs --check  # verify, write nothing
```

| Output | Change | SHA-256 before | SHA-256 after |
| --- | --- | --- | --- |
| `footprints/kicad/SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod` and its byte-identical copy in `example-minimal-circuit-lib.pretty/` | The `(model ...)` locator only: `${KICAD9_3DMODEL_DIR}/Package_SO.3dshapes/SOIC-8_3.9x4.9mm_P1.27mm.step` → `${KIPRJMOD}/../../footprints/kicad/example-minimal-circuit-lib.3dshapes/SOIC-8_3.9x4.9mm_P1.27mm.wrl`. The identity offset, scale and rotation are kept; they are the transform the kicad-footprints `8.0.9` footprint applied to this WRL. | `623e154d907cd3e49387a81775898feee35c4ed5fd3317865ad11c322f72adfb` | `399dfd8e6507193e2d1d929ad003a75992e009cf9eb809341e0836a47c3a47db` |
| `footprints/kicad/example-minimal-circuit-lib.3dshapes/SOIC-8_3.9x4.9mm_P1.27mm.wrl` | Each `material USE <name>` is replaced by the body of its `material DEF <name>`. Every point and index list is unchanged. This was needed when the publication policy refused every VRML `USE`; the policy now accepts `USE` of a `DEF`'d `Material` or `Appearance`, so the unmodified WRL would publish as is and inlining is optional. The committed copy stays inlined to keep its recorded hash. | `2b84645ac35f878381da69ebf467feab9e5f054922c809c1b28a1586dd4e462d` | `cdc8e3df568dd4b2662a639d00976281aa155b336b831323faa9e63a0a62dc99` |

## License

KiCad library files are CC-BY-SA 4.0 with the KiCad library exception; see [NOTICE.md](../../../NOTICE.md).
