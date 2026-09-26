import tempfile
import unittest
from pathlib import Path
from unittest import mock

from generic_project import bundle_for, line, make_project

from circuit_evidence import cad
from circuit_evidence.errors import ContractError
from circuit_evidence.orchestrator import validate

PIN_NAMES = ["VIN", "EN", "GND", "FB", "SW", "BST", "PG", "VOUT"]


def symbol_library(name, pins):
    units = "\n".join(
        f'      (pin passive line (at 0 {index} 0) (length 2.54) (name "{pin_name}") (number "{number}"))'
        for index, (number, pin_name) in enumerate(pins)
    )
    return (
        "(kicad_symbol_lib (version 20231120) (generator test)\n"
        '  (symbol "OTHER-PART" (symbol "OTHER-PART_1_1" (pin passive line (at 0 0 0) (length 2.54) (name "X") (number "99"))))\n'
        f'  (symbol "{name}" (in_bom yes)\n    (property "Reference" "U" (at 0 0 0))\n    (symbol "{name}_1_1"\n{units}\n    )\n  )\n)\n'
    )


def footprint(name, pads):
    body = "\n".join(f'  (pad "{pad}" smd rect (at 0 {index}) (size 1 1) (layers "F.Cu"))' for index, pad in enumerate(pads))
    return f'(footprint "{name}" (layer "F.Cu")\n{body}\n)\n'


class CadPinAssetTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.part = line("line-a", "TST-8", "Test Maker", owner="component-a", package="SOIC-8")
        self.bundle = bundle_for(self.part, suffix="a")
        self.bundle["pin_maps"][0]["pins"] = [
            {"symbol_pin": str(number), "name": name, "footprint_pad": str(number), "function": name.lower()}
            for number, name in enumerate(PIN_NAMES, start=1)
        ]
        self.cad_dir = self.root / "cad"
        (self.cad_dir / "footprints").mkdir(parents=True)
        self.library = self.cad_dir / "project.kicad_sym"
        self.write_assets()

    def tearDown(self):
        self.directory.cleanup()

    def write_assets(self, symbol="TST-8", symbol_pins=None, pads=None, footprint_name="SOIC-8"):
        symbol_pins = symbol_pins or [(str(number), name) for number, name in enumerate(PIN_NAMES, start=1)]
        self.library.write_text(symbol_library(symbol, symbol_pins), encoding="utf-8")
        for path in (self.cad_dir / "footprints").glob("*.kicad_mod"):
            path.unlink()
        (self.cad_dir / "footprints" / f"{footprint_name}.kicad_mod").write_text(footprint(footprint_name, pads or [str(n) for n in range(1, 9)]), encoding="utf-8")

    def config(self, bundle=None, part=None, enabled=True):
        part = part or self.part
        return make_project(
            self.root / "project", [part], bundles={part["owner_skill"]: bundle or self.bundle},
            cad={"enabled": enabled, "symbolLibraries": [str(self.library)], "footprintDirs": [str(self.cad_dir / "footprints")], "requirePinEqualsPad": True},
        )

    def test_matching_eight_pin_symbol_and_footprint_pass(self):
        report = validate(self.config())
        self.assertEqual(report.skip, [])
        self.assertIn("pin-asset check performed", report.scope[0])

    def test_missing_symbol_fails(self):
        self.write_assets(symbol="OTHER-8")
        with self.assertRaisesRegex(ContractError, "KiCad symbol TST-8 missing from configured symbol libraries"):
            validate(self.config())

    def test_missing_footprint_fails(self):
        self.write_assets(footprint_name="QFN-8")
        with self.assertRaisesRegex(ContractError, "KiCad footprint SOIC-8 missing"):
            validate(self.config())

    def test_pin_and_pad_mismatches_fail(self):
        self.write_assets(symbol_pins=[(str(number), name) for number, name in enumerate(PIN_NAMES[:7], start=1)])
        with self.assertRaisesRegex(ContractError, "pin map differs from KiCad symbol TST-8"):
            validate(self.config())
        self.write_assets(pads=[str(n) for n in range(1, 8)] + ["EP"])
        with self.assertRaisesRegex(ContractError, "pin map differs from KiCad footprint SOIC-8"):
            validate(self.config())

    def test_pin_equals_pad_stays_strict(self):
        pins = self.bundle["pin_maps"][0]["pins"]
        pins[0]["footprint_pad"], pins[1]["footprint_pad"] = "2", "1"
        with self.assertRaisesRegex(ContractError, "symbol-pin to footprint-pad mapping differs"):
            validate(self.config())

    def test_missing_configured_library_fails_naming_the_path(self):
        self.library.unlink()
        with self.assertRaisesRegex(ContractError, f"configured symbol library is missing: {self.library}"):
            validate(self.config())

    def test_disabled_cad_skips_without_reading_libraries(self):
        self.library.unlink()
        with mock.patch.object(Path, "read_text", side_effect=AssertionError("library read")) as read_text:
            skipped = cad.validate_pin_assets({"records": [], "pin_maps": []}, [], {"enabled": False, "symbolLibraries": [str(self.library)], "footprintDirs": [], "requirePinEqualsPad": True})
        read_text.assert_not_called()
        self.assertEqual(skipped, "pin-asset check not performed: cad disabled")
        report = validate(self.config(enabled=False))
        self.assertEqual(report.skip, ["pin-asset check not performed: cad disabled"])

    def test_external_record_uses_terminal_semantics_with_empty_footprint(self):
        part = line("line-ext", "TST-8", "Test Maker", owner="component-ext", package="SOIC-8", mounting="external", supplier="Panel Shop", order_code="PS-8")
        bundle = bundle_for(part, suffix="ext")
        bundle["pin_maps"][0]["pins"] = self.bundle["pin_maps"][0]["pins"]
        validate(self.config(bundle, part))
        bundle["pin_maps"][0]["pins"][0]["footprint_pad"] = "T1"
        with self.assertRaisesRegex(ContractError, "external terminal mapping differs"):
            validate(self.config(bundle, part))

    def test_provider_hook_runs_after_generic_checks(self):
        seen = []

        class Provider:
            def extra_pin_asset_checks(self, provider_result, aggregate):
                seen.append((provider_result, len(aggregate["pin_maps"])))

        aggregate = {"records": self.bundle["records"], "pin_maps": self.bundle["pin_maps"]}
        cad_config = {"enabled": True, "symbolLibraries": [str(self.library)], "footprintDirs": [str(self.cad_dir / "footprints")], "requirePinEqualsPad": True}
        cad.validate_pin_assets(aggregate, [self.part], cad_config, provider=Provider(), provider_result="result")
        self.assertEqual(seen, [("result", 1)])

    def test_sexp_named_block_ignores_parentheses_in_strings(self):
        text = '(lib (symbol "A" (property "Note" "has ) paren") (pin (number "1"))) (symbol "B" (pin (number "2"))))'
        self.assertEqual(cad.SYMBOL_PIN.findall(cad.sexp_named_block(text, "symbol", "A")), ["1"])


if __name__ == "__main__":
    unittest.main()
