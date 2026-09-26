# Notices

## KiCad library files

This example contains files from the official KiCad libraries. They are licensed under the [Creative Commons CC-BY-SA 4.0 License](https://creativecommons.org/licenses/by-sa/4.0/legalcode), with the KiCad library exception:

> To the extent that the creation of electronic designs that use 'Licensed Material' can be considered to be 'Adapted Material', then the copyright holder waives article 3 of the license with respect to these designs and any generated files which use data provided as part of the 'Licensed Material'.

The exception does not apply to redistributing the libraries, or parts of them, as a collection. The license text of each library is `LICENSE.md` at the pinned tag.

| File in this project | Library, tag and original file | Receipt |
| --- | --- | --- |
| `symbols/example-minimal-circuit-lib.kicad_sym` (symbol `TMP1075D` only) | [kicad-symbols `9.0.9`](https://gitlab.com/kicad/libraries/kicad-symbols/-/blob/9.0.9/LICENSE.md), `Sensor_Temperature.kicad_sym` | [kicad-tmp1075d-symbol](circuit/cad-receipts/kicad-tmp1075d-symbol.receipt.json) |
| `footprints/vendor/kicad-soic8/SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod` (unmodified) | [kicad-footprints `9.0.9`](https://gitlab.com/kicad/libraries/kicad-footprints/-/blob/9.0.9/LICENSE.md), `Package_SO.pretty/SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod` | [kicad-soic8-footprint](circuit/cad-receipts/kicad-soic8-footprint.receipt.json) |
| `footprints/kicad/SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod` and `footprints/kicad/example-minimal-circuit-lib.pretty/SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod` (model path changed) | same as above | [kicad-soic8-footprint](circuit/cad-receipts/kicad-soic8-footprint.receipt.json) |
| `footprints/kicad/example-minimal-circuit-lib.3dshapes/SOIC-8_3.9x4.9mm_P1.27mm.step` (unmodified) | [kicad-packages3D `8.0.9`](https://gitlab.com/kicad/libraries/kicad-packages3D/-/blob/8.0.9/LICENSE.md), `Package_SO.3dshapes/SOIC-8_3.9x4.9mm_P1.27mm.step` | [kicad-soic8-model](circuit/cad-receipts/kicad-soic8-model.receipt.json) |
| `footprints/vendor/kicad-soic8/SOIC-8_3.9x4.9mm_P1.27mm.wrl` (unmodified) | kicad-packages3D `8.0.9`, `Package_SO.3dshapes/SOIC-8_3.9x4.9mm_P1.27mm.wrl` | [kicad-soic8-model](circuit/cad-receipts/kicad-soic8-model.receipt.json) |
| `footprints/kicad/example-minimal-circuit-lib.3dshapes/SOIC-8_3.9x4.9mm_P1.27mm.wrl` and its published copy `doc/public/assets/component-previews/models/SOIC-8_3.9x4.9mm_P1.27mm.wrl` (materials inlined) | same as above | [kicad-soic8-model](circuit/cad-receipts/kicad-soic8-model.receipt.json) |
| `doc/public/assets/component-previews/footprints/SOIC-8_3.9x4.9mm_P1.27mm.svg` (rendered from the footprint by kicad-cli 9.0.9) | generated from the footprint above | [kicad-soic8-footprint](circuit/cad-receipts/kicad-soic8-footprint.receipt.json) |

The modifications are described in [footprints/vendor/kicad-soic8/README.md](footprints/vendor/kicad-soic8/README.md).
