import tempfile
import unittest
from pathlib import Path
from unittest import mock

from generic_project import line, make_project, run_cli, write_json

from circuit_evidence.errors import ContractError
from circuit_evidence.orchestrator import validate
from circuit_evidence.policy import POLICY_CHECKS
from circuit_evidence.policy import checks as policy_checks

ROUTING = {"schema_version": 1, "contract": "direct-routing-v1", "cases": [{"line_id": "line-a", "negative": "check OTHER-200 pinout"}]}
LED_MARKERS = ("STUSB", "AL8860", "domain", "pin lock", "review", "refresh evidence", "policy")


def policy(*checks):
    return {"schema_version": 1, "checks": list(checks)}


def integration(**overrides):
    return {"type": "integration", "exactDomains": [], "allowedVerdicts": ["NEEDS BENCH"], "requireChainRule": False, "chainConstraints": {}, **overrides}


class GenericIsolationTests(unittest.TestCase):
    def test_empty_project_without_policy_runs_no_led_checks(self):
        with tempfile.TemporaryDirectory() as directory:
            config = make_project(Path(directory))
            spies = {name: mock.Mock() for name in policy_checks.CHECK_TYPES}
            run_checks = mock.Mock()
            with mock.patch.dict(policy_checks.CHECK_TYPES, spies), mock.patch.dict(POLICY_CHECKS, {"checks": run_checks}):
                report = validate(config)
            self.assertEqual(report.lines, 0)
            run_checks.assert_not_called()
            for spy in spies.values():
                spy.assert_not_called()
            result = run_cli("--config", "-", config=config)
            self.assertEqual(result.returncode, 0, result.stderr)
            for marker in LED_MARKERS:
                self.assertNotIn(marker, result.stdout + result.stderr)


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def run_policy(self, data, **project):
        return validate(make_project(self.root, policy=data, **project))

    def assert_policy_fails(self, data, message, **project):
        with self.assertRaisesRegex(ContractError, message):
            self.run_policy(data, **project)

    def test_empty_check_list_passes(self):
        self.assertEqual(self.run_policy(policy()).lines, 0)

    def test_unknown_check_type_and_malformed_checks_fail(self):
        self.assert_policy_fails(policy({"type": "lamp-brightness"}), "unknown check type 'lamp-brightness'")
        self.assert_policy_fails(policy({"kind": "integration"}), "each check needs a string type")
        self.assert_policy_fails({"schema_version": 1, "checks": {}}, "checks must be a list")
        self.assert_policy_fails({"schema_version": 1, "lamp": []}, "unknown check 'lamp'")

    def test_missing_and_unknown_options_fail(self):
        self.assert_policy_fails(policy({"type": "refresh-evidence", "evidence": "e.json"}), r"policy refresh-evidence: missing keys \['requiredAuthorityClasses', 'retrievalProfile'\]")
        self.assert_policy_fails(policy(integration(extra=1)), r"policy integration: unknown options \['extra'\]")

    def test_policy_paths_stay_inside_the_project_root(self):
        outside = write_json(self.root.parent / f"{self.root.name}-outside.json", {"evidence": []})
        self.addCleanup(outside.unlink)
        base = {"type": "refresh-evidence", "requiredAuthorityClasses": [], "retrievalProfile": "browser-like-v1"}
        for evidence in (f"../{self.root.name}-outside.json", str(self.root / "evidence.json")):
            with self.subTest(evidence=evidence):
                self.assert_policy_fails(policy({**base, "evidence": evidence}), "must be a path inside the project root")
        self.assert_policy_fails(policy({**base, "evidence": "circuit/missing.json"}), "configured file is missing: circuit/missing.json")

    def test_empty_evidence_files_fail_their_checks(self):
        write_json(self.root / "circuit/refresh.json", {"schema_version": 1, "evidence": []})
        self.assert_policy_fails(policy({"type": "refresh-evidence", "evidence": "circuit/refresh.json", "requiredAuthorityClasses": [], "retrievalProfile": "browser-like-v1"}), "refresh evidence: empty")
        write_json(self.root / "circuit/review.json", {"schema_version": 1, "independent_review_passes": [], "fact_locks": [], "reviews": []})
        review = {"type": "critical-fact-review", "review": "circuit/review.json", "requiredDomains": [], "minPasses": 2, "reviewLogsRoot": "circuit"}
        self.assert_policy_fails(policy(review), "critical fact review: empty")
        self.assert_policy_fails(policy({**review, "minPasses": 0}), "minPasses must be a positive integer")

    def test_pin_lock_assertion_for_an_absent_record_fails_cleanly(self):
        write_json(self.root / "circuit/locks.json", {"schema_version": 1, "locks": []})
        check = {"type": "pin-locks", "locks": "circuit/locks.json", "assertions": [{"recordId": "rec-missing", "label": "Part", "trustStatus": "UNSOURCED"}]}
        self.assert_policy_fails(policy(check), "Part: pin lock for rec-missing is missing")
        self.assertEqual(self.run_policy(policy({**check, "assertions": []})).lines, 0)

    def test_integration_check(self):
        self.assertEqual(self.run_policy(policy(integration())).lines, 0)
        self.assert_policy_fails(policy(integration(requireChainRule=True)), "an evidence-chain rule is required")
        self.assert_policy_fails(policy(integration(exactDomains=["rail-envelope"])), "exact required domains")
        self.assert_policy_fails(policy(integration(chainConstraints={"layout": "MIXED"})), r"unknown chain stages \['layout'\]")
        self.assert_policy_fails(policy(integration(chainConstraints={"trailingOpen": 10})), "trailingOpen must be an integer within the stage count")
        self.assert_policy_fails(policy(integration(requiredFiles=["circuit/agents.yaml"])), "missing required file circuit/agents.yaml")
        config = make_project(self.root, policy=policy(integration()))
        config["integration"]["rulesPath"] = None
        with self.assertRaisesRegex(ContractError, "integration.rulesPath must be configured"):
            validate(config)

    def test_seeded_fixtures_run_through_the_configured_provider(self):
        part = line("line-a", "TST-100", "Test Maker", owner="component-a")
        routing_path = ".claude/skills/component-spec-audit/references/direct-routing.json"
        case = {"name": "duplicate-mpn", "base": "inventory", "target": "lines.line-a.manufacturer", "value": "Test Maker", "expected_error": "x"}
        seeded = {"type": "seeded-fixtures", "directRouting": routing_path, "invalidCases": [case]}
        self.assert_policy_fails(policy(seeded), "duplicate-mpn: invalid fixture passed", lines=[part], direct_routing=ROUTING)
        blank = {**case, "name": "blank-mpn", "target": "lines.line-a.mpn", "value": " ", "expected_error": "blank identity field"}
        self.assertEqual(self.run_policy(policy({**seeded, "invalidCases": [blank]}), lines=[part], direct_routing=ROUTING).lines, 1)
        self.assert_policy_fails(policy({**seeded, "invalidCases": [{**blank, "expected_error": "LCSC"}]}), "blank-mpn: failed for unintended reason", lines=[part], direct_routing=ROUTING)
        self.assert_policy_fails(policy({**seeded, "invalidCases": [{**blank, "base": "golden"}]}), "unsupported invalid-case base 'golden'", lines=[part], direct_routing=ROUTING)
        self.assert_policy_fails(policy({**seeded, "invalidCases": [blank]}), "routing.directRouting must be", lines=[part])

    def test_seeded_fixtures_direct_routing_option_is_optional_and_defaults_to_the_resolved_config(self):
        part = line("line-a", "TST-100", "Test Maker", owner="component-a")
        case = {"name": "duplicate-mpn", "base": "inventory", "target": "lines.line-a.manufacturer", "value": "Test Maker", "expected_error": "x"}
        bare = {"type": "seeded-fixtures", "invalidCases": [case]}
        # A present routing.directRouting is used as-is, with no need to also name it in the check.
        self.assert_policy_fails(policy(bare), "duplicate-mpn: invalid fixture passed", lines=[part], direct_routing=ROUTING)
        blank = {**case, "name": "blank-mpn", "target": "lines.line-a.mpn", "value": " ", "expected_error": "blank identity field"}
        self.assertEqual(self.run_policy(policy({**bare, "invalidCases": [blank]}), lines=[part], direct_routing=ROUTING).lines, 1)
        # With no directRouting in the check and none configured, the default has nothing to fall back to.
        self.assert_policy_fails(policy({**bare, "invalidCases": [blank]}), "routing.directRouting must be configured", lines=[part])


if __name__ == "__main__":
    unittest.main()
