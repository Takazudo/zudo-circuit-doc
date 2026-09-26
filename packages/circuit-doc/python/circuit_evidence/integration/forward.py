"""Cross-component forward tests: routing, evidence discovery and hash-locked observed runs.

Every check raises ContractError explicitly, so ``python -O`` cannot disable it.
"""

from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from ..errors import ContractError, load, require, required_keys
from ..routing import NO_ROUTING_POLICY, resolve

DEFAULT_INTEGRATION_SKILL = "circuit-spec-integration"
OBSERVED_RUNS_FILE = "observed-runs.json"
OBSERVED_RUN_MUTATIONS = ("gardening", "empty-evidence", "missing-skill", "fake-hash")


@dataclass(frozen=True)
class ForwardResult:
    cases: int
    negative_routes: int


def validate_observed_run(case, run, skill_name):
    case_id = case["case_id"]
    prompt_bytes = case["prompt"].encode()
    response_bytes = json.dumps(run["response"], sort_keys=True, separators=(",", ":")).encode()
    require(run["case_id"] == case_id and run["prompt"] == case["prompt"], f"{case_id}: observed run does not match its case")
    require(run["prompt_sha256"] == hashlib.sha256(prompt_bytes).hexdigest(), f"{case_id}: observed prompt hash changed")
    require(run["response_sha256"] == hashlib.sha256(response_bytes).hexdigest() and run["response_sha256"] != "0" * 64, f"{case_id}: observed response hash changed")
    require(all(isinstance(run[key], str) and run[key].strip() for key in ("runner", "model", "run_date")), f"{case_id}: observed run lacks runner/model/date")
    require(run["invocation"] == {"skill": f"/{skill_name}", "tools": "disabled", "session_persistence": False, "evidence_packet": "frozen"}, f"{case_id}: observed run invocation differs")
    response = run["response"]
    require(response["trigger_skill"] == case["expected_trigger_skill"], f"{case_id}: observed trigger skill differs")
    require(response["loaded_skills"] == case["expected_loaded_skills"] and response["loaded_skills"], f"{case_id}: observed loaded skills differ")
    require(response["source_ids"] == case["required_source_ids"] and response["source_ids"], f"{case_id}: observed source IDs differ")
    require(response["fact_ids"] == case["required_fact_ids"] and response["fact_ids"], f"{case_id}: observed fact IDs differ")
    require(response["conditions"] == case["expected_observed_conditions"] and response["conditions"], f"{case_id}: observed conditions differ")
    require(response["calculation_ids"] == case["required_calculation_ids"], f"{case_id}: observed calculation IDs differ")
    require(response["verdicts"] == case["expected_verdicts"] and response["refused"] is case["must_refuse"], f"{case_id}: observed verdicts/refusal differ")
    require(isinstance(response["refusal"], str) and len(response["refusal"].split()) >= 8, f"{case_id}: observed refusal is too short")


def check_forward_tests(path, *, rules, aggregate, lines, routing=NO_ROUTING_POLICY, skill_name=DEFAULT_INTEGRATION_SKILL):
    """Run the configured forward tests. Observed runs live beside the file as ``observed-runs.json``."""
    path = Path(path)
    require(path.is_file(), f"forward tests: configured file is missing: {path}")
    tests = load(path)
    require(isinstance(tests, dict), "forward tests: top level must be an object")
    required_keys(tests, ("schema_version", "cases"), "forward tests")
    cases, negative_routes = tests["cases"], tests.get("negative_routes", [])
    require(isinstance(cases, list) and isinstance(negative_routes, list), "forward tests: cases and negative_routes must be lists")
    facts = {fact["fact_id"]: fact for fact in aggregate["facts"]}
    sources = {source["source_id"] for source in aggregate["sources"]}
    records = {record["record_id"]: record for record in aggregate["records"]}
    rules_by_id = {rule["rule_id"]: rule for rule in rules}
    observed_runs = {}
    if cases:
        observed_path = path.parent / OBSERVED_RUNS_FILE
        require(observed_path.is_file(), f"forward tests: observed runs file is missing: {observed_path}")
        observed_data = load(observed_path)
        observed_runs = {run["run_id"]: run for run in observed_data["runs"]}
        require(len(observed_runs) == len(observed_data["runs"]) == len(cases), "forward tests: observed-run exact case parity")
    for case in cases:
        case_id = case["case_id"]
        require(set(case["rule_ids"]) <= set(rules_by_id), f"{case_id}: unknown rule ID")
        require(case["observed_run_id"] in observed_runs, f"{case_id}: unknown observed run")
        selected = [rules_by_id[rule_id] for rule_id in case["rule_ids"]]
        require(selected, f"{case_id}: no rule selected")
        run = observed_runs[case["observed_run_id"]]
        selected_record_ids = set().union(*(set(rule["record_ids"]) for rule in selected))
        selected_fact_ids = set().union(*(set(rule["fact_ids"]) for rule in selected))
        selected_calculation_ids = {item["calculation_id"] for rule in selected for item in rule.get("conditioned_calculations", [])}
        require(len(case["prompt"].split()) >= 18, f"{case_id}: prompt is too short")
        validate_observed_run(case, run, skill_name)
        require(case["expected_trigger_skill"] == skill_name, f"{case_id}: expected trigger skill must be {skill_name}")
        require([rule["verdict"] for rule in selected] == case["expected_verdicts"], f"{case_id}: expected verdicts differ from rules")
        require(set(case["direct_record_ids"]) == selected_record_ids, f"{case_id}: direct record IDs differ from rules")
        require(set(case["subordinate_record_ids"]) <= set(case["direct_record_ids"]), f"{case_id}: subordinate record not direct")
        require(all(record_id in records and records[record_id]["kind"] == "subordinate" for record_id in case["subordinate_record_ids"]), f"{case_id}: subordinate record kind")
        require(set(case["required_source_ids"]) <= sources, f"{case_id}: unknown source ID")
        require(set(case["required_fact_ids"]) <= selected_fact_ids <= set(facts), f"{case_id}: required fact IDs outside rules")
        require(all(facts[fact_id]["source_id"] in case["required_source_ids"] for fact_id in case["required_fact_ids"]), f"{case_id}: fact source not required")
        require(all(facts[fact_id]["conditions"].strip() and facts[fact_id]["locator"].strip() for fact_id in case["required_fact_ids"]), f"{case_id}: fact lacks conditions/locator")
        require(set(case["required_calculation_ids"]) <= selected_calculation_ids, f"{case_id}: unknown calculation ID")
        require(all(bool(rule["refusal"].strip()) == case["must_refuse"] for rule in selected), f"{case_id}: refusal policy differs")
        for query in case["routing_queries"]:
            require(resolve(query["query"], lines, routing) == query["expected_line_ids"], f"{case_id}: routing query differs: {query['query']}")
    for route in negative_routes:
        require(resolve(route["query"], lines, routing) == route["expected_line_ids"], f"forward tests: negative route differs: {route['query']}")
    if cases:
        first_case = cases[0]
        first_run = observed_runs[first_case["observed_run_id"]]
        for mutation in OBSERVED_RUN_MUTATIONS:
            changed_case, changed_run = copy.deepcopy(first_case), copy.deepcopy(first_run)
            if mutation == "gardening": changed_case["prompt"] = "Please water the garden and prune the roses before lunch today."
            elif mutation == "empty-evidence": changed_run["response"]["source_ids"] = []
            elif mutation == "missing-skill": changed_run["response"]["loaded_skills"] = []
            else: changed_run["response_sha256"] = "f" * 64
            try:
                validate_observed_run(changed_case, changed_run, skill_name)
            except ContractError:
                continue
            raise ContractError(f"forward tests: observed-run mutation unexpectedly passed: {mutation}")
    return ForwardResult(len(cases), len(negative_routes))
