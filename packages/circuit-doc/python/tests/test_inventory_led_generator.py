import copy
import tempfile
import unittest
from pathlib import Path

from generic_project import inventory, line, make_project, run_cli, write_json

from circuit_evidence.errors import ContractError
from circuit_evidence.inventory import effective_fit, line_fit, load_inventory, placements, provider_for, validate_counts, validate_inventory_shape
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

    def mixed_inventory(self):
        specs = []
        for board, dnp in (("a", True), ("b", False)):
            path = self.spec(f"{board}_spec.py", (
                f"PROJECT_NAME = {board!r}\n"
                f"COMPONENTS = {{'R1': ('TST-100', '10k', 'C123', 'lib:PKG', {dnp!r}, (0, 0))}}\n"
                "NETS = {}\n"
            ))
            specs.append({"path": str(path)})
        part = line("line-r", "TST-100", "Test Maker", lcsc="C123", owner="component-r", placements=[
            {"board": "a", "refdes": "R1", "dnp": True},
            {"board": "b", "refdes": "R1", "dnp": False},
        ])
        data = inventory([part])
        del part["dnp"]
        data["generator_specs"] = ["a_spec.py", "b_spec.py"]
        data["assertions"].update(dnp_or_hand_fit_lines=1, fitted_placements=1, dnp_placements=1)
        return data, {"kind": "led-generator-v1", "specs": specs, "fit": "placement"}

    def test_mixed_fit_requires_placement_mode_and_preserves_every_bit(self):
        data, options = self.mixed_inventory()
        path = write_json(self.root / "inventory.json", data)
        self.assertEqual(load_inventory(path, placement_fit=True), data)
        provider = provider_for(options)
        result = provider.validate(data, EMPTY_AGGREGATE, self.config())
        self.assertTrue(provider.placement_fit)
        self.assertEqual(result.placements, [
            {"line_id": "line-r", "board": "a", "refdes": "R1", "dnp": True},
            {"line_id": "line-r", "board": "b", "refdes": "R1", "dnp": False},
        ])
        self.assertIn("fit=placement", result.scope_lines[0])
        with self.assertRaisesRegex(ContractError, r"missing keys \['dnp'\]"):
            load_inventory(path)

    def test_placement_fit_passes_full_run_and_seeded_policy_parity(self):
        data, options = self.mixed_inventory()
        policy = {"checks": [{"type": "seeded-fixtures", "invalidCases": [{
            "name": "wrong-mpn", "base": "inventory", "target": "lines.line-r.mpn",
            "value": "OTHER-200", "expected_error": "wrong MPN against generator",
        }]}]}
        # make_project builds legacy line-mode assertions; replace them with the reviewed inventory.
        config = make_project(self.root, [{**data["lines"][0], "dnp": False}], policy=policy, direct_routing={
            "schema_version": 1, "contract": "direct-routing-v1",
            "cases": [{"line_id": "line-r", "negative": "check OTHER-200 pinout"}],
        })
        write_json(config["inventory"]["path"], data)
        config["inventory"]["provider"] = options
        self.assertEqual(validate(config).lines, 1)
        result = run_cli("--config", "-", config=config)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("fit=placement", result.stdout)
        config["inventory"]["provider"] = {**options, "fit": "line"}
        with self.assertRaisesRegex(ContractError, r"missing keys \['dnp'\]"):
            validate(config)

    def test_line_and_placement_fit_conflicts_and_types(self):
        for mode in (False, True):
            for line_dnp in (False, True):
                with self.subTest(placement_fit=mode, line_dnp=line_dnp):
                    data = self.main_inventory()
                    for part in data["lines"]:
                        part["dnp"] = line_dnp
                        for item in part["placements"]:
                            item["dnp"] = line_dnp
                    validate_inventory_shape(data, placement_fit=mode)
                    data["lines"][0]["placements"][0]["dnp"] = not line_dnp
                    with self.assertRaisesRegex(ContractError, "line-c7420363: conflicting line/placement dnp"):
                        validate_inventory_shape(data, placement_fit=mode)
            for value in (None, 0, 1, "false"):
                for target in ("line", "placement"):
                    with self.subTest(placement_fit=mode, value=value, target=target):
                        data, _ = self.mixed_inventory()
                        part = data["lines"][0]
                        part["dnp"] = False
                        for item in part["placements"]:
                            item["dnp"] = False
                        (part if target == "line" else part["placements"][0])["dnp"] = value
                        with self.assertRaisesRegex(ContractError, "dnp must be a boolean"):
                            validate_inventory_shape(data, placement_fit=mode)

    def test_placement_fit_requires_placement_bits_or_an_unplaced_line_bit(self):
        data, _ = self.mixed_inventory()
        del data["lines"][0]["placements"][0]["dnp"]
        with self.assertRaisesRegex(ContractError, r"line-r placement: missing keys \['dnp'\]"):
            validate_inventory_shape(data, placement_fit=True)
        data["lines"][0]["placements"] = []
        with self.assertRaisesRegex(ContractError, r"line-r: missing keys \['dnp'\]"):
            validate_inventory_shape(data, placement_fit=True)
        data["lines"][0]["dnp"] = True
        validate_inventory_shape(data, placement_fit=True)
        self.assertEqual(line_fit(data["lines"][0]), [True])

    def test_parity_rejects_flipped_or_duplicate_placements(self):
        data, options = self.mixed_inventory()
        provider = provider_for(options)
        flipped = copy.deepcopy(data)
        flipped["lines"][0]["placements"][0]["dnp"] = False
        with self.assertRaisesRegex(ContractError, "board/refdes or DNP mismatch"):
            provider.validate(flipped, EMPTY_AGGREGATE, self.config())
        for mode in ("placement", "line"):
            with self.subTest(mode=mode):
                if mode == "line":
                    path = self.spec("main_spec.py", MAIN_SPEC)
                    provider = provider_for({"kind": "led-generator-v1", "specs": [{"path": str(path)}]})
                    data = self.main_inventory()
                duplicate = copy.deepcopy(data)
                duplicate["lines"][0]["placements"].append(dict(duplicate["lines"][0]["placements"][0]))
                with self.assertRaisesRegex(ContractError, "board/refdes or DNP mismatch"):
                    provider.validate(duplicate, EMPTY_AGGREGATE, self.config())

    def test_counts_include_mixed_and_unplaced_lines_without_phantom_placements(self):
        data, _ = self.mixed_inventory()
        for name, bits in (("fitted", [False, False]), ("dnp", [True]), ("unplaced-fitted", []), ("unplaced-dnp", [])):
            part = line(f"line-{name}", name, "Maker", owner="component-r", dnp=name == "unplaced-dnp", placements=[
                {"board": "c", "refdes": f"R{i}", "dnp": bit} for i, bit in enumerate(bits)
            ])
            if bits:
                del part["dnp"]
            data["lines"].append(part)
        data["assertions"] = {"orderable_lines": 5, "fitted_lines": 3, "dnp_or_hand_fit_lines": 3, "fitted_placements": 3, "dnp_placements": 2}
        validate_inventory_shape(data, placement_fit=True)
        validate_counts(data, placement_fit=True)
        for key in data["assertions"]:
            with self.subTest(key=key):
                wrong = copy.deepcopy(data)
                wrong["assertions"][key] += 1
                with self.assertRaisesRegex(ContractError, "count differs from reviewed assertion"):
                    validate_counts(wrong, placement_fit=True)

    def test_optional_placement_assertions_are_strict_in_both_modes(self):
        for mode in (False, True):
            data = self.mixed_inventory()[0] if mode else self.main_inventory()
            if not mode:
                data["assertions"].update(fitted_placements=4, dnp_placements=0)
            validate_counts(data, placement_fit=mode)
            for key in ("fitted_placements", "dnp_placements"):
                for value in (True, False, -1, "1", 1.0, None):
                    with self.subTest(placement_fit=mode, key=key, value=value):
                        wrong = copy.deepcopy(data)
                        wrong["assertions"][key] = value
                        for check in (validate_inventory_shape, validate_counts):
                            with self.assertRaisesRegex(ContractError, "counts must be non-negative integers"):
                                check(wrong, placement_fit=mode)
                wrong = copy.deepcopy(data)
                wrong["assertions"][key] += 1
                with self.assertRaisesRegex(ContractError, f"{key} count differs"):
                    validate_counts(wrong, placement_fit=mode)

    def test_fit_helpers_fall_back_to_line_and_preserve_false(self):
        part = self.main_inventory()["lines"][0]
        self.assertEqual(line_fit(part), [False, False])
        self.assertFalse(effective_fit(part, part["placements"][0]))
        self.assertEqual([item["dnp"] for item in placements([part])], [False, False])
        self.assertFalse(effective_fit({"dnp": True}, {"dnp": False}))
        self.assertTrue(effective_fit({"dnp": True}, {}))

    def test_fit_options_are_explicit_and_manual_stays_line_mode(self):
        for value in ("unknown", "PLACEMENT", "", None, True, 1, [], {}):
            with self.subTest(value=value), self.assertRaisesRegex(ContractError, "fit must be 'line' or 'placement'"):
                provider_for({"kind": "led-generator-v1", "specs": [], "fit": value})
        implicit = provider_for({"kind": "led-generator-v1", "specs": []})
        explicit = provider_for({"kind": "led-generator-v1", "specs": [], "fit": "line"})
        self.assertFalse(implicit.placement_fit)
        self.assertEqual(implicit.validate(inventory([]), EMPTY_AGGREGATE, self.config()), explicit.validate(inventory([]), EMPTY_AGGREGATE, self.config()))
        self.assertFalse(provider_for({"kind": "manual"}).placement_fit)
        with self.assertRaisesRegex(ContractError, "unexpected options"):
            provider_for({"kind": "manual", "fit": "placement"})

    def test_external_placement_mode_requires_every_placement_fitted(self):
        path = self.spec("external.py", (
            "PROJECT_NAME = 'panel'\n"
            "COMPONENTS = {'J1': ('EXT-9', 'EXT-9', '', '', False, (0, 0))}\n"
            "EXTERNAL_COMPONENTS = {'J1': {'mpn': 'EXT-9', 'manufacturer': 'Panel Maker', 'package': 'PKG', "
            "'supplier': 'Panel Shop', 'order_code': 'PS-9', 'datasheet': 'https://vendor.test/ext.pdf'}}\n"
            "NETS = {}\n"
        ))
        part = line("line-ext", "EXT-9", "Panel Maker", owner="component-ext", mounting="external", supplier="Panel Shop", order_code="PS-9", placements=[{"board": "panel", "refdes": "J1", "dnp": False}])
        data = inventory([part])
        del part["dnp"]
        data["generator_specs"] = ["external.py"]
        provider = provider_for({"kind": "led-generator-v1", "specs": [{"path": str(path)}], "fit": "placement"})
        validate_inventory_shape(data, placement_fit=True)
        provider.validate(data, EMPTY_AGGREGATE, self.config())
        for target in (part, part["placements"][0]):
            target["dnp"] = True
            with self.assertRaisesRegex(ContractError, "external identity must have no LCSC and be fitted"):
                provider.validate(data, EMPTY_AGGREGATE, self.config())
            del target["dnp"]

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
        self.assertEqual(result.scope_lines, ["inventory provider=led-generator-v1; placements bound to 1 generator specs (2 lines, 4 placements, 1 exclusions); pin-asset check not performed: cad disabled"])
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
