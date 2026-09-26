import tempfile
import unittest
from pathlib import Path

from generic_project import inventory, line, make_project

from circuit_evidence.errors import ContractError
from circuit_evidence.inventory import provider_for
from circuit_evidence.inventory.led_generator_v1 import LedGeneratorProvider, expected_mpn, generator_inventory, parse_components
from circuit_evidence.orchestrator import validate

EMPTY_AGGREGATE = {"records": [], "sources": [], "facts": []}
MAIN_SPEC = (
    '"""Synthetic board spec."""\n'
    "PROJECT_NAME = 'main-board'\n"
    "COMPONENTS = {\n"
    "    'D1': ('SS26_C7420363', 'SS26', 'C7420363', 'lib:SMB', False, (0, 0)),\n"
    "    'D2': ('SS26_C7420363', 'SS26', 'C7420363', 'lib:SMB', False, (10, 0)),\n"
    "    'TP1': ('TestPoint', 'TP', '', 'lib:PAD', False, (20, 0)),\n"
    "}\n"
    "for i in range(3, 5):\n"
    "    COMPONENTS[f'R{i}'] = ('0603WAF1002T5E', '10k', 'C25804', 'lib:R0603', False, (i * 10, 5))\n"
    "NETS = {'GND': ['D1.1', 'D2.1']}\n"
)


class LedGeneratorTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def spec(self, name, text):
        path = self.root / name
        path.write_text(text, encoding="utf-8")
        return path

    def config(self):
        return {"projectRoot": str(self.root), "cad": {"enabled": False}}

    def main_inventory(self, generator_specs=("main_spec.py",)):
        lines = [
            line("line-c7420363", "SS26", "Vishay", lcsc="C7420363", package="SMB", owner="component-vishay-ss26",
                 placements=[{"board": "main-board", "refdes": "D1"}, {"board": "main-board", "refdes": "D2"}]),
            line("line-c25804", "0603WAF1002T5E", "UNI-ROYAL", lcsc="C25804", package="R0603", owner="component-passives",
                 placements=[{"board": "main-board", "refdes": "R3"}, {"board": "main-board", "refdes": "R4"}]),
        ]
        data = inventory(lines)
        data["generator_specs"] = list(generator_specs)
        data["exclusions"] = [{"board": "main-board", "refdes": "TP1", "reason": "bare-copper test pad"}]
        return data

    def test_malicious_generator_is_rejected_without_execution(self):
        marker = self.root / "executed"
        malicious = self.spec("spec.py", (
            "COMPONENTS = {'U1': ('SAFE', 'SAFE', 'C1', 'lib:PKG', False, (0, 0))}\n"
            f"open({str(marker)!r}, 'w').write('owned')\n"
            "NETS = {}\n"
        ))
        with self.assertRaisesRegex(ContractError, "unsafe generator syntax"):
            parse_components(malicious)
        provider = provider_for({"kind": "led-generator-v1", "specs": [{"path": str(malicious)}]})
        with self.assertRaisesRegex(ContractError, "unsafe generator syntax"):
            provider.board_names({"lines": []})
        self.assertFalse(marker.exists())

    def test_generator_dsl_rejects_unsupported_component_syntax(self):
        unsafe = {
            "import": "import os",
            "attribute": "BAD = (1).real",
            "call": "BAD = len([])",
            "comprehension": "BAD = [x for x in []]",
            "lambda": "BAD = lambda: 1",
        }
        for name, statement in unsafe.items():
            with self.subTest(name=name):
                path = self.spec(f"{name}.py", f"COMPONENTS = {{}}\n{statement}\nNETS = {{}}\n")
                with self.assertRaisesRegex(ContractError, "unsafe generator syntax"):
                    parse_components(path)

    def test_generator_dsl_rejects_late_component_mutation(self):
        path = self.spec("late.py", "COMPONENTS = {}\nNETS = {}\nCOMPONENTS['U1'] = ('X', 'X', 'C1', 'lib:P', False, (0, 0))\n")
        with self.assertRaisesRegex(ContractError, "after NETS"):
            parse_components(path)

    def test_specs_come_only_from_config(self):
        with self.assertRaisesRegex(ContractError, "specs option is required"):
            provider_for({"kind": "led-generator-v1"})
        with self.assertRaisesRegex(ContractError, "spec path must be absolute"):
            provider_for({"kind": "led-generator-v1", "specs": [{"path": "scripts/schgen/board_p_spec.py"}]})
        with self.assertRaisesRegex(ContractError, "unexpected options"):
            provider_for({"kind": "led-generator-v1", "specs": [], "fallback": True})
        provider = provider_for({"kind": "led-generator-v1", "specs": []})
        self.assertIsInstance(provider, LedGeneratorProvider)
        self.assertEqual(provider.generated(), ({}, [], []))
        self.assertEqual(provider.board_names({"lines": []}), [])
        result = provider.validate(inventory([]), EMPTY_AGGREGATE, self.config())
        self.assertEqual(result.lines, [])
        with self.assertRaisesRegex(ContractError, "LCSC identity differs from generator specs"):
            provider.validate(self.main_inventory(generator_specs=()), EMPTY_AGGREGATE, self.config())

    def test_board_names_come_from_project_name_and_can_be_overridden(self):
        path = self.spec("main_spec.py", MAIN_SPEC)
        grouped, excluded, boards = generator_inventory([{"path": str(path)}])
        self.assertEqual(boards, ["main-board"])
        self.assertEqual(excluded, [("main-board", "TP1")])
        self.assertEqual(grouped["C7420363"]["mpn"], "SS26")
        self.assertEqual(sorted(grouped["C25804"]["placements"], key=lambda item: item["refdes"]), [
            {"board": "main-board", "refdes": "R3", "dnp": False}, {"board": "main-board", "refdes": "R4", "dnp": False},
        ])
        _, excluded, boards = generator_inventory([{"path": str(path), "board": "override-board"}])
        self.assertEqual((boards, excluded), (["override-board"], [("override-board", "TP1")]))
        nameless = self.spec("nameless.py", "COMPONENTS = {}\nNETS = {}\n")
        with self.assertRaisesRegex(ContractError, "PROJECT_NAME"):
            generator_inventory([{"path": str(nameless)}])
        self.assertEqual(generator_inventory([{"path": str(nameless), "board": "b"}])[2], ["b"])

    def test_generator_parity_on_a_synthetic_spec(self):
        path = self.spec("main_spec.py", MAIN_SPEC)
        provider = provider_for({"kind": "led-generator-v1", "specs": [{"path": str(path)}]})
        self.assertEqual(provider.board_names(None), ["main-board"])
        result = provider.validate(self.main_inventory(), EMPTY_AGGREGATE, self.config())
        self.assertEqual(len(result.placements), 4)
        self.assertIn("inventory provider=led-generator-v1", result.scope_lines[0])
        for target, value, expected in (
            ("mpn", "SS27", "wrong MPN against generator"),
            ("package", "SMA", "wrong package against generator"),
            ("dnp", True, "board/refdes or DNP mismatch"),
        ):
            data = self.main_inventory()
            data["lines"][0][target] = value
            with self.subTest(target=target), self.assertRaisesRegex(ContractError, expected):
                provider.validate(data, EMPTY_AGGREGATE, self.config())
        data = self.main_inventory()
        data["exclusions"] = []
        with self.assertRaisesRegex(ContractError, "bare-copper exclusions differ"):
            provider.validate(data, EMPTY_AGGREGATE, self.config())

    def test_generator_specs_must_equal_the_configured_spec_paths(self):
        path = self.spec("main_spec.py", MAIN_SPEC)
        provider = provider_for({"kind": "led-generator-v1", "specs": [{"path": str(path)}]})
        for specs in ((), ("other_spec.py",), ("./main_spec.py",), ("main_spec.py", "main_spec.py")):
            with self.subTest(specs=specs), self.assertRaisesRegex(ContractError, "differ from the configured specs"):
                provider.validate(self.main_inventory(generator_specs=specs), EMPTY_AGGREGATE, self.config())
        outside = tempfile.TemporaryDirectory()
        self.addCleanup(outside.cleanup)
        other = Path(outside.name) / "main_spec.py"
        other.write_text(MAIN_SPEC, encoding="utf-8")
        provider = provider_for({"kind": "led-generator-v1", "specs": [{"path": str(other)}]})
        with self.assertRaisesRegex(ContractError, "outside projectRoot"):
            provider.validate(self.main_inventory(), EMPTY_AGGREGATE, self.config())

    def test_expected_mpn_strips_only_the_lcsc_suffix(self):
        self.assertEqual(expected_mpn("AO3401A_C347476"), "AO3401A")
        self.assertEqual(expected_mpn("SS-12D01-G020"), "SS-12D01-G020")
        self.assertEqual(expected_mpn("B6B-XH-A_C144397"), "B6B-XH-A")

    def test_empty_generator_project_passes_the_full_run(self):
        config = make_project(self.root)
        config["inventory"]["provider"] = {"kind": "led-generator-v1", "specs": []}
        report = validate(config)
        self.assertEqual(report.lines, 0)
        self.assertEqual(report.scope, ["inventory provider=led-generator-v1; placements bound to 0 generator specs (0 lines, 0 placements, 0 exclusions); pin-asset check not performed: cad disabled"])


if __name__ == "__main__":
    unittest.main()
