import copy
import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from generic_project import bundle_for, line, make_project, schema, write_json

from circuit_evidence.errors import ContractError, load
from circuit_evidence.golden import SELFTEST_DIR
from circuit_evidence.integration import EVIDENCE_STAGES, check_forward_tests, validate_rules
from circuit_evidence.orchestrator import POLICY_CHECKS, validate


def golden_aggregate(available=False):
    data = load(SELFTEST_DIR / "golden/critical-facts.json")
    if available:
        data["sources"][0]["availability"] = "AVAILABLE"
    return {"records": [{"record_id": "rec-golden", "kind": "standalone"}], "facts": data["facts"], "sources": data["sources"]}


def margin_rule(**overrides):
    rule = {
        "rule_id": "rule-margin", "domain": "rail-envelope", "record_ids": ["rec-golden"],
        "fact_ids": ["fact-golden-limit", "fact-golden-project"], "conditions": "nominal input",
        "verdict": "NEEDS BENCH", "refusal": "Refuse to claim margin until the bench confirms it.",
        "conditioned_calculations": [{
            "calculation_id": "calc-margin", "fact_ids": ["fact-golden-limit", "fact-golden-project"],
            "expression": "fact_golden_limit - fact_golden_project", "result_key": "margin_v", "margin_v": 5,
            "conditions": "DC, TA=25 degC",
        }],
    }
    rule.update(overrides)
    return rule


def chain_rule(statuses, stage_facts=None):
    stage_facts = stage_facts or {}
    return {
        "rule_id": "rule-chain", "domain": "source-to-bench-chain", "record_ids": ["rec-golden"],
        "fact_ids": ["fact-golden-limit", "fact-golden-project"], "conditions": "whole chain",
        "verdict": "UNSOURCED", "refusal": "Refuse to claim the chain is proven end to end.",
        "evidence_chain": [{"stage": stage, "status": statuses.get(stage, "OPEN"), "fact_ids": stage_facts.get(stage, [])} for stage in EVIDENCE_STAGES],
    }


class IntegrationRuleTests(unittest.TestCase):
    def setUp(self):
        self.schema = schema()

    def test_empty_rules_file_passes(self):
        validate_rules([], {"records": [], "facts": [], "sources": []}, self.schema)
        with tempfile.TemporaryDirectory() as directory:
            report = validate(make_project(directory))
            self.assertEqual(report.lines, 0)

    def test_calculation_recomputes_and_mismatch_fails(self):
        validate_rules([margin_rule()], golden_aggregate(), self.schema)
        stale = margin_rule()
        stale["conditioned_calculations"][0]["margin_v"] = 4
        with self.assertRaisesRegex(ContractError, "calc-margin: result is stale"):
            validate_rules([stale], golden_aggregate(), self.schema)
        scenario = margin_rule()
        calculation = scenario["conditioned_calculations"][0]
        calculation.pop("margin_v")
        calculation.update({"expression": "fact_golden_limit - fact_golden_project - drop_v", "results": [{"drop_v": 1, "margin_v": 4}]})
        validate_rules([scenario], golden_aggregate(), self.schema)
        calculation["results"][0]["margin_v"] = 5
        with self.assertRaisesRegex(ContractError, "scenario result is stale"):
            validate_rules([scenario], golden_aggregate(), self.schema)
        calculation["results"][0] = {"drop_v": 1, "extra_v": 2, "margin_v": 4}
        with self.assertRaisesRegex(ContractError, "scenario variables must be explicit and exact"):
            validate_rules([scenario], golden_aggregate(), self.schema)

    def test_rule_shape_ids_and_fact_ownership(self):
        with self.assertRaisesRegex(ContractError, "duplicate rule ID"):
            validate_rules([margin_rule(), margin_rule()], golden_aggregate(), self.schema)
        with self.assertRaisesRegex(ContractError, "unknown record/fact ID"):
            validate_rules([margin_rule(fact_ids=["fact-missing"])], golden_aggregate(), self.schema)
        aggregate = golden_aggregate()
        aggregate["records"].append({"record_id": "rec-other", "kind": "standalone"})
        with self.assertRaisesRegex(ContractError, "fact owner missing from record_ids"):
            validate_rules([margin_rule(record_ids=["rec-other"])], aggregate, self.schema)
        with self.assertRaisesRegex(ContractError, "incomplete conditioned refusal"):
            validate_rules([margin_rule(refusal=" ")], golden_aggregate(), self.schema)
        with self.assertRaisesRegex(ContractError, "missing keys"):
            validate_rules([{"rule_id": "rule-x"}], golden_aggregate(), self.schema)
        with self.assertRaisesRegex(ContractError, "unknown integration verdict"):
            validate_rules([margin_rule(verdict="SAFE")], golden_aggregate(), self.schema)

    def test_evidence_chain_structure(self):
        validate_rules([chain_rule({})], golden_aggregate(), self.schema)
        validate_rules([chain_rule({"official-source": "CONFIRMED"}, {"official-source": ["fact-golden-project"]})], golden_aggregate(available=True), self.schema)
        with self.assertRaisesRegex(ContractError, "generator prose cannot CONFIRM an exported netlist"):
            validate_rules([chain_rule({"generated-netlist": "CONFIRMED"}, {"generated-netlist": ["fact-golden-project"]})], golden_aggregate(available=True), self.schema)
        with self.assertRaisesRegex(ContractError, "CONFIRMED stage lacks available evidence"):
            validate_rules([chain_rule({"official-source": "CONFIRMED"}, {"official-source": ["fact-golden-project"]})], golden_aggregate(), self.schema)
        with self.assertRaisesRegex(ContractError, "OPEN stage must not claim proof"):
            validate_rules([chain_rule({}, {"bench": ["fact-golden-limit"]})], golden_aggregate(), self.schema)
        reordered = chain_rule({})
        reordered["evidence_chain"].reverse()
        with self.assertRaisesRegex(ContractError, "stage order changed"):
            validate_rules([reordered], golden_aggregate(), self.schema)

    def test_missing_configured_rules_file_fails_naming_the_path(self):
        with tempfile.TemporaryDirectory() as directory:
            config = make_project(directory)
            Path(config["integration"]["rulesPath"]).unlink()
            with self.assertRaisesRegex(ContractError, f"configured file is missing: {config['integration']['rulesPath']}"):
                validate(config)


def forward_fixture(part, bundle):
    fact = bundle["facts"][1]
    rule = {
        "rule_id": "rule-pin", "domain": "pinout", "record_ids": [bundle["records"][0]["record_id"]],
        "fact_ids": [fact["fact_id"]], "conditions": "reset state", "verdict": "UNSOURCED",
        "refusal": "Refuse to claim the pin state until the datasheet is available.",
    }
    prompt = f"Check whether the {part['manufacturer']} {part['mpn']} input pin stays safely low through reset and first configuration on the main board please."
    response = {
        "trigger_skill": "circuit-spec-integration", "loaded_skills": ["circuit-spec-integration", part["owner_skill"]],
        "source_ids": [fact["source_id"]], "fact_ids": [fact["fact_id"]], "conditions": ["reset state"],
        "calculation_ids": [], "verdicts": ["UNSOURCED"], "refused": True,
        "refusal": "The pin state is UNSOURCED, so I refuse to claim it is safe.",
    }
    case = {
        "case_id": "pin-reset", "observed_run_id": "observed-pin-reset", "prompt": prompt,
        "expected_trigger_skill": "circuit-spec-integration", "expected_loaded_skills": response["loaded_skills"],
        "routing_queries": [{"query": f"{part['manufacturer']} {part['mpn']}", "expected_line_ids": [part["line_id"]]}],
        "direct_record_ids": rule["record_ids"], "subordinate_record_ids": [], "required_source_ids": [fact["source_id"]],
        "rule_ids": ["rule-pin"], "required_fact_ids": [fact["fact_id"]], "expected_observed_conditions": ["reset state"],
        "required_calculation_ids": [], "expected_verdicts": ["UNSOURCED"], "must_refuse": True,
    }
    run = {
        "run_id": "observed-pin-reset", "case_id": "pin-reset", "runner": "test runner", "model": "test-model", "run_date": "2026-09-26",
        "invocation": {"skill": "/circuit-spec-integration", "tools": "disabled", "session_persistence": False, "evidence_packet": "frozen"},
        "prompt": prompt, "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
        "response_sha256": hashlib.sha256(json.dumps(response, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
        "response": response,
    }
    tests = {"schema_version": 1, "cases": [case], "negative_routes": [{"query": "check OTHER-1 pinout", "expected_line_ids": []}]}
    return rule, tests, {"schema_version": 1, "runs": [run]}


class ForwardTestTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.part = line("line-a", "TST-100", "Test Maker", owner="component-a")
        self.bundle = bundle_for(self.part, suffix="a")
        self.aggregate = {key: self.bundle[key] for key in ("records", "sources", "facts")}

    def tearDown(self):
        self.directory.cleanup()

    def test_zero_forward_cases_is_a_skip(self):
        config = make_project(self.root, forward_tests={"schema_version": 1, "cases": [], "negative_routes": []})
        report = validate(config)
        self.assertEqual(report.skip, ["pin-asset check not performed: cad disabled", "forward tests: 0 cases (0 negative routes checked)"])

    def test_missing_configured_forward_tests_fail(self):
        config = make_project(self.root, forward_tests={"schema_version": 1, "cases": []})
        Path(config["integration"]["forwardTests"]).unlink()
        with self.assertRaisesRegex(ContractError, "forward tests: configured file is missing"):
            validate(config)

    def test_forward_case_and_observed_run_pass_and_mutations_fail(self):
        rule, tests, observed = forward_fixture(self.part, self.bundle)
        path = write_json(self.root / "refs/forward-tests.json", tests)
        write_json(self.root / "refs/observed-runs.json", observed)
        result = check_forward_tests(path, rules=[rule], aggregate=self.aggregate, lines=[self.part])
        self.assertEqual((result.cases, result.negative_routes), (1, 1))
        for mutate, message in (
            (lambda t, o: o["runs"][0].update(response_sha256="f" * 64), "observed response hash changed"),
            (lambda t, o: t["cases"][0].update(expected_verdicts=["NEEDS BENCH"]), "observed verdicts/refusal differ"),
            (lambda t, o: t["cases"][0]["routing_queries"][0].update(expected_line_ids=[]), "routing query differs"),
            (lambda t, o: o["runs"][0]["invocation"].update(skill="/other-skill"), "invocation differs"),
        ):
            changed_tests, changed_observed = copy.deepcopy(tests), copy.deepcopy(observed)
            mutate(changed_tests, changed_observed)
            write_json(path, changed_tests)
            write_json(self.root / "refs/observed-runs.json", changed_observed)
            with self.subTest(message=message):
                with self.assertRaisesRegex(ContractError, message):
                    check_forward_tests(path, rules=[rule], aggregate=self.aggregate, lines=[self.part])

    def test_skill_name_comes_from_config(self):
        rule, tests, observed = forward_fixture(self.part, self.bundle)
        path = write_json(self.root / "refs/forward-tests.json", tests)
        write_json(self.root / "refs/observed-runs.json", observed)
        with self.assertRaisesRegex(ContractError, "invocation differs"):
            check_forward_tests(path, rules=[rule], aggregate=self.aggregate, lines=[self.part], skill_name="project-integration")


class SelfTestAndPolicyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def corrupted_selftest(self, name, **changes):
        selftest = self.root / f"selftest-{name}"
        shutil.copytree(SELFTEST_DIR, selftest)
        path = selftest / "mutations" / name
        mutation = load(path)
        mutation.update(changes)
        write_json(path, mutation)
        return selftest

    def test_corrupted_selftest_mutation_fails(self):
        config = make_project(self.root / "project")
        with self.assertRaisesRegex(ContractError, "pin.json: failed for unintended reason"):
            validate(config, selftest_dir=self.corrupted_selftest("pin.json", expected_error="golden unit changed"))
        with self.assertRaisesRegex(ContractError, "value.json: seeded mutation passed"):
            validate(config, selftest_dir=self.corrupted_selftest("value.json", to=20))

    def test_policy_file_fails_without_registered_checks(self):
        config = make_project(self.root, policy={"schema_version": 1})
        self.assertEqual(POLICY_CHECKS, {})
        with self.assertRaisesRegex(ContractError, "no policy checks are registered"):
            validate(config)

    def test_policy_dispatches_to_registered_checks(self):
        seen = []
        config = make_project(self.root, policy={"schema_version": 1, "requireChain": {"domain": "source-to-bench-chain"}})
        POLICY_CHECKS["requireChain"] = lambda value, context: seen.append((value, context.rules))
        try:
            validate(config)
            config = make_project(self.root / "other", policy={"schema_version": 1, "unknown": {}})
            with self.assertRaisesRegex(ContractError, "unknown check 'unknown'"):
                validate(config)
        finally:
            POLICY_CHECKS.clear()
        self.assertEqual(seen, [({"domain": "source-to-bench-chain"}, [])])


if __name__ == "__main__":
    unittest.main()
