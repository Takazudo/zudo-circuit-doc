"""Generic cross-component integration rules: shape, fact ownership, recomputed calculations
and evidence-chain structure. Project-fixed domains, verdict lists and a mandatory chain
rule belong to project policy, not here.
"""

from __future__ import annotations

import math
from pathlib import Path

from ..errors import load, require, required_keys
from ..facts import arithmetic, expression_names, fact_evidence_available

RULE_KEYS = ("rule_id", "domain", "record_ids", "fact_ids", "conditions", "verdict", "refusal")
EVIDENCE_STAGES = ["official-source", "conditioned-requirement", "generated-netlist", "symbol-footprint", "pcb-orientation", "bom-cpl", "as-built", "programmed", "bench"]
EVIDENCE_STATUSES = ("CONFIRMED", "MIXED", "OPEN")


def load_rules(path):
    path = Path(path)
    require(path.is_file(), f"integration rules: configured file is missing: {path}")
    data = load(path)
    require(isinstance(data, dict), "integration rules: top level must be an object")
    required_keys(data, ("schema_version", "rules"), "integration rules")
    require(isinstance(data["rules"], list), "integration rules: rules must be a list")
    return data["rules"]


def chain_rules(rules):
    return [rule for rule in rules if "evidence_chain" in rule]


def validate_evidence_chain(chain, aggregate):
    facts = {fact["fact_id"]: fact for fact in aggregate["facts"]}
    sources = {source["source_id"]: source for source in aggregate["sources"]}
    stages = chain["evidence_chain"]
    require(isinstance(stages, list) and all(isinstance(stage, dict) for stage in stages), "integration evidence chain: stages must be objects")
    for stage in stages:
        required_keys(stage, ("stage", "status", "fact_ids"), "integration evidence stage")
    require([stage["stage"] for stage in stages] == EVIDENCE_STAGES, "integration evidence chain: stage order changed")
    for stage in stages:
        require(stage["status"] in EVIDENCE_STATUSES, f"integration evidence chain: invalid status {stage['status']}")
        require(set(stage["fact_ids"]) <= set(chain["fact_ids"]), "integration evidence chain: unknown stage fact")
        if stage["status"] == "CONFIRMED":
            require(stage["fact_ids"] and all(fact_evidence_available(fact_id, facts, sources) for fact_id in stage["fact_ids"]), "integration evidence chain: CONFIRMED stage lacks available evidence")
        if stage["stage"] == "generated-netlist":
            require(stage["status"] != "CONFIRMED", "integration evidence chain: generator prose cannot CONFIRM an exported netlist")
        if stage["status"] == "OPEN":
            require(not stage["fact_ids"], "integration evidence chain: OPEN stage must not claim proof")


def validate_calculation(item, rule, facts):
    require(set(item["fact_ids"]) <= set(rule["fact_ids"]) and item["expression"].strip() and item["conditions"].strip(), f"{item['calculation_id']}: incomplete calculation evidence")
    require(item["result_key"] in item or item.get("results"), f"{item['calculation_id']}: calculation result missing")
    fact_values = {fact_id.replace("-", "_"): facts[fact_id]["value"] for fact_id in item["fact_ids"] if isinstance(facts[fact_id]["value"], (int, float))}
    names = expression_names(item["expression"])
    require(set(fact_values) <= names, f"{item['calculation_id']}: declared numeric fact is unused")
    require({name for name in names if name.startswith("fact_")} <= {fact_id.replace("-", "_") for fact_id in item["fact_ids"]}, f"{item['calculation_id']}: expression uses an undeclared fact")
    if item.get("results"):
        for scenario in item["results"]:
            require(item["result_key"] in scenario, f"{item['calculation_id']}: scenario output missing")
            inputs = {key: value for key, value in scenario.items() if key != item["result_key"] and isinstance(value, (int, float))}
            require(names - set(fact_values) == set(inputs), f"{item['calculation_id']}: scenario variables must be explicit and exact")
            require(math.isclose(arithmetic(item["expression"], {**fact_values, **inputs}), scenario[item["result_key"]], rel_tol=1e-12, abs_tol=1e-12), f"{item['calculation_id']}: scenario result is stale")
    else:
        require(math.isclose(arithmetic(item["expression"], fact_values), item[item["result_key"]], rel_tol=1e-12, abs_tol=1e-12), f"{item['calculation_id']}: result is stale")


def validate_rules(rules, aggregate, schema, *, candidate_record_ids=(), candidate_fact_ids=()):
    """An empty rule list is valid; so is a list without an evidence-chain rule."""
    facts = {fact["fact_id"]: fact for fact in aggregate["facts"]}
    fact_owners = {fact["fact_id"]: fact["record_id"] for fact in aggregate["facts"]}
    records = {record["record_id"] for record in aggregate["records"]}
    candidate_record_ids = set(candidate_record_ids)
    candidate_fact_ids = set(candidate_fact_ids)
    for rule in rules:
        require(isinstance(rule, dict), "integration rule: must be an object")
        required_keys(rule, RULE_KEYS, rule.get("rule_id", "integration rule"))
    require(len({rule["rule_id"] for rule in rules}) == len(rules), "integration rules: duplicate rule ID")
    for rule in rules:
        require(
            not (set(rule["record_ids"]) & candidate_record_ids or set(rule["fact_ids"]) & candidate_fact_ids),
            "integration rule references an audited candidate record",
        )
        require(set(rule["record_ids"]) <= records and set(rule["fact_ids"]) <= set(facts), f"{rule['rule_id']}: unknown record/fact ID")
        require({fact_owners[fact_id] for fact_id in rule["fact_ids"]} <= set(rule["record_ids"]), f"{rule['rule_id']}: fact owner missing from record_ids")
        require(rule["record_ids"] and rule["fact_ids"] and rule["conditions"].strip() and rule["refusal"].strip(), f"{rule['rule_id']}: incomplete conditioned refusal")
        require(rule["verdict"] in schema["verdicts"], f"{rule['rule_id']}: unknown integration verdict")
        calculations = rule.get("conditioned_calculations", [])
        for item in calculations:
            required_keys(item, ("calculation_id", "fact_ids", "expression", "result_key", "conditions"), "conditioned calculation")
        require(len({item["calculation_id"] for item in calculations}) == len(calculations), f"{rule['rule_id']}: duplicate conditioned calculation")
        for item in calculations:
            validate_calculation(item, rule, facts)
    for chain in chain_rules(rules):
        validate_evidence_chain(chain, aggregate)
