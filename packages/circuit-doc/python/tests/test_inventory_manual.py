import tempfile
import unittest
from pathlib import Path

from generic_project import bundle_for, inventory, line, make_project

from circuit_evidence.errors import ContractError
from circuit_evidence.inventory import ManualProvider, evidence_states, provider_for
from circuit_evidence.orchestrator import validate
from circuit_evidence.routing import resolve

CAD_OFF = {"cad": {"enabled": False}}
EMPTY_AGGREGATE = {"records": [], "sources": [], "facts": []}


def scope_of(report):
    return [line for line in report.scope if line.startswith("inventory provider=manual")]


class ManualInventoryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def test_empty_inventory_passes_with_scope_line(self):
        report = validate(make_project(self.root))
        self.assertEqual(report.lines, 0)
        self.assertEqual(report.scope, ["inventory provider=manual; schematic/placement binding not performed (0 lines, 0 declared placements unverified); pin-asset check not performed: cad disabled"])

    def test_part_02_blank_lcsc_line_routes_by_manufacturer_and_mpn(self):
        part = line("line-a", "TST-100", "Test Maker", owner="component-test-maker-tst-100")
        config = make_project(self.root, [part], direct_routing={"schema_version": 1, "contract": "direct-routing-v1", "cases": [{"line_id": "line-a", "negative": "check OTHER-200 pinout"}]})
        report = validate(config)
        self.assertEqual(report.lines, 1)
        self.assertEqual(resolve("Test Maker TST-100", [part]), ["line-a"])
        self.assertEqual(resolve("TST-100", [part]), ["line-a"])

    def test_part_03_empty_placements_pass_with_scope(self):
        part = line("line-a", "TST-100", "Test Maker", owner="component-a", placements=[])
        report = validate(make_project(self.root, [part]))
        self.assertIn("(1 lines, 0 declared placements unverified)", report.scope[0])

    def test_part_04_same_mpn_from_two_manufacturers_needs_the_qualifier(self):
        vishay = line("line-vishay", "SS26", "Vishay", owner="component-vishay-ss26")
        rectron = line("line-rectron", "SS26", "Rectron", owner="component-rectron-ss26")
        report = validate(make_project(self.root, [vishay, rectron]))
        self.assertEqual(report.lines, 2)
        lines = [vishay, rectron]
        self.assertEqual(resolve("Vishay SS26", lines), ["line-vishay"])
        self.assertEqual(resolve("SS26 from Rectron", lines), ["line-rectron"])
        self.assertEqual(resolve("SS26", lines), [])

    def test_part_05_one_line_with_several_placements(self):
        placements = [{"board": "main-board", "refdes": "D1"}, {"board": "main-board", "refdes": "D2"}, {"board": "aux-board", "refdes": "D1"}]
        part = line("line-a", "TST-100", "Test Maker", owner="component-a", placements=placements)
        report = validate(make_project(self.root, [part]))
        self.assertIn("(1 lines, 3 declared placements unverified)", report.scope[0])

    def test_synthetic_positive_external_line(self):
        part = line("line-ext", "EXT-9", "Panel Maker", owner="component-ext", mounting="external", supplier="Panel Shop", order_code="PS-9")
        report = validate(make_project(self.root, [part]))
        self.assertEqual(report.lines, 1)
        for broken, message in (({"lcsc": "C123"}, "external identity"), ({"dnp": True}, "external identity"), ({"order_code": ""}, "external order_code")):
            with self.subTest(broken=broken):
                with self.assertRaisesRegex(ContractError, message):
                    ManualProvider({"kind": "manual"}).validate(inventory([{**part, **broken}]), EMPTY_AGGREGATE, CAD_OFF)

    def test_nonblank_lcsc_must_be_a_unique_c_number(self):
        provider = ManualProvider({"kind": "manual"})
        for bad in ("X123", "C12A", "c123"):
            with self.subTest(lcsc=bad):
                with self.assertRaisesRegex(ContractError, r"LCSC must match"):
                    provider.validate(inventory([line("line-a", "TST-100", "Test Maker", lcsc=bad, owner="component-a")]), EMPTY_AGGREGATE, CAD_OFF)
        duplicate = [line("line-a", "TST-100", "Maker A", lcsc="C123", owner="component-a"), line("line-b", "TST-200", "Maker B", lcsc="C123", owner="component-b")]
        with self.assertRaisesRegex(ContractError, "duplicate LCSC ownership"):
            provider.validate(inventory(duplicate), EMPTY_AGGREGATE, CAD_OFF)
        provider.validate(inventory([line("line-a", "TST-100", "Test Maker", lcsc="C123", owner="component-a")]), EMPTY_AGGREGATE, CAD_OFF)

    def test_identity_is_unique_line_and_manufacturer_mpn(self):
        provider = ManualProvider({"kind": "manual"})
        same = [line("line-a", "TST-100", "Test Maker", owner="component-a"), line("line-b", "TST-100", "Test Maker", owner="component-b")]
        with self.assertRaisesRegex(ContractError, r"duplicate \(manufacturer, mpn\)"):
            provider.validate(inventory(same), EMPTY_AGGREGATE, CAD_OFF)

    def test_generator_specs_must_be_empty_and_counts_match(self):
        provider = ManualProvider({"kind": "manual"})
        data = inventory([])
        data["generator_specs"] = ["scripts/spec.py"]
        with self.assertRaisesRegex(ContractError, r"generator_specs must be \[\]"):
            provider.validate(data, EMPTY_AGGREGATE, CAD_OFF)
        data = inventory([line("line-a", "TST-100", "Test Maker", owner="component-a")])
        data["assertions"]["fitted_lines"] = 0
        with self.assertRaisesRegex(ContractError, "fitted line count"):
            provider.validate(data, EMPTY_AGGREGATE, CAD_OFF)

    def test_suppliers_are_display_only(self):
        part = line("line-a", "TST-100", "Test Maker", owner="component-a", suppliers=[{"supplier": "Shop", "order_code": "SHOP-77"}])
        validate(make_project(self.root, [part]))
        self.assertEqual(resolve("SHOP-77", [part]), [])
        with self.assertRaisesRegex(ContractError, "suppliers entries"):
            ManualProvider({"kind": "manual"}).validate(inventory([{**part, "suppliers": [{"supplier": "Shop"}]}]), EMPTY_AGGREGATE, CAD_OFF)

    def test_owner_bundle_parity(self):
        part = line("line-a", "TST-100", "Test Maker", owner="component-a")
        bundle = bundle_for(part, suffix="a")
        bundle["records"][0]["package"] = "OTHER"
        aggregate = {"records": bundle["records"], "sources": bundle["sources"], "facts": bundle["facts"]}
        with self.assertRaisesRegex(ContractError, "package differs from inventory"):
            ManualProvider({"kind": "manual"}).validate(inventory([part]), aggregate, CAD_OFF)

    def test_summary_lag_warns_without_failing(self):
        part = line("line-a", "TST-100", "Test Maker", owner="component-a", source_state="AVAILABLE")
        report = validate(make_project(self.root, [part]))
        self.assertEqual(report.warn, ["inventory summary for line-a lags evidence: source_state AVAILABLE but evidence supports SOURCE UNAVAILABLE"])
        bundle = bundle_for(part, suffix="a")
        bundle["sources"][0].update({"availability": "AVAILABLE", "sha256": "a" * 64})
        aggregate = {"records": bundle["records"], "sources": bundle["sources"], "facts": bundle["facts"]}
        self.assertEqual(evidence_states(part, aggregate), ("UNRESOLVED", "AVAILABLE"))

    def test_unknown_provider_kind_and_options_fail(self):
        with self.assertRaisesRegex(ContractError, "unknown kind"):
            provider_for({"kind": "nope"})
        with self.assertRaisesRegex(ContractError, "unexpected options"):
            provider_for({"kind": "manual", "specs": []})

    def test_malformed_line_shape_fails_as_contract_error(self):
        config = make_project(self.root)
        Path(config["inventory"]["path"]).write_text('{"schema_version":1,"generator_specs":[],"assertions":{"orderable_lines":1,"fitted_lines":1,"dnp_or_hand_fit_lines":0},"exclusions":[],"lines":[{"line_id":"line-a"}]}', encoding="utf-8")
        with self.assertRaisesRegex(ContractError, "missing keys"):
            validate(config)


if __name__ == "__main__":
    unittest.main()
