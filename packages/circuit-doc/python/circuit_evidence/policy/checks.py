"""Data-driven project policy: assertions one project enforces on its own evidence.

A generic project configures no policy and runs none of these. The policy file is::

    {
      "schema_version": 1,
      "checks": [ {"type": "<check type>", ...options}, ... ]
    }

Every path inside a check is relative to the project root (``projectRoot`` in the resolved
config) and must stay inside it. An unknown check type, a missing option or an unknown
option is a FAIL. The check types:

``pin-locks``
    ``locks``: file ``{schema_version, locks: [{record_id, pin_map_id, canonical_sha256,
    evidence_fact_ids, trust_status, critical_pins, reviewer}]}``. Exactly one lock per pin
    map, each locking the canonical pin-map hash, its evidence facts and its critical pins.
    ``assertions``: ``[{recordId, label?, trustStatus?, pin?: {name, symbolPin, footprintPad}}]``;
    ``trustStatus`` pins a lock's trust status, ``pin`` pins one named pin's numbering.

``critical-fact-review``
    ``review``: file ``{schema_version, independent_review_passes, fact_locks, reviews}``.
    ``requiredDomains``: domains that must each have a review. ``minPasses``: minimum number
    of independent passes. ``reviewLogsRoot``: directory every pass's ``review_log`` is
    resolved against and must stay inside; each log is locked by ``review_log_sha256``.

``refresh-evidence``
    ``evidence``: file ``{schema_version, evidence: [{source_id, authoritative_url, sha256,
    checked_at, result, retrieval_profile}]}``. ``requiredAuthorityClasses``: authority classes
    that must each have a refresh example. ``retrievalProfile``: the only accepted profile.

``integration``
    ``exactDomains``: the rule domains, exactly. ``allowedVerdicts``: the rule verdict
    whitelist. ``requireChainRule``: at least one rule carries an ``evidence_chain``.
    ``chainConstraints``: ``{<stage>: <status>, trailingOpen?: N}`` for every chain rule.
    ``requiredFiles``: files that must exist, e.g. the integration skill's artifacts.

``seeded-fixtures``
    ``directRouting``: the direct-routing fixture the config must point at (its per-line
    cases then run in the routing step). ``invalidCases``: ``[{name, base: "inventory",
    target, value, expected_error}]``, each applied to a copy of the inventory and run
    through the configured inventory provider, which must fail with ``expected_error``.
"""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

from ..bundle import canonical_pin_map
from ..errors import ContractError, load, require, required_keys
from ..golden import set_target
from ..integration import EVIDENCE_STAGES, chain_rules
from ..inventory import validate_inventory_shape
from ..sources import HEX64, ZERO_SHA256

LOCK_TRUST_STATUSES = ("TRUSTED", "PROJECT-LOCKED", "NEEDS BENCH", "UNSOURCED")
REVIEW_STATUSES = ("CONFIRMED", "OPEN", "UNSOURCED")


def project_path(context, relative, label):
    require(isinstance(relative, str) and relative.strip(), f"policy {label}: path must be a nonblank string")
    root = Path(context.config["projectRoot"]).resolve()
    path = (root / relative).resolve()
    require(not Path(relative).is_absolute() and path.is_relative_to(root), f"policy {label}: {relative} must be a path inside the project root")
    return path


def project_file(context, relative, label):
    path = project_path(context, relative, label)
    require(path.is_file(), f"policy {label}: configured file is missing: {relative}")
    return path


def check_options(check, required, optional=()):
    kind = check["type"]
    required_keys(check, required, f"policy {kind}")
    unknown = set(check) - {"type", *required, *optional}
    require(not unknown, f"policy {kind}: unknown options {sorted(unknown)}")


def string_list(value, label):
    require(isinstance(value, list) and all(isinstance(item, str) and item.strip() for item in value), f"policy {label}: must be a list of nonblank strings")
    return value


def check_pin_locks(check, context):
    check_options(check, ("locks", "assertions"))
    aggregate = context.aggregate
    locks = load(project_file(context, check["locks"], "pin-locks locks"))["locks"]
    records = {record["record_id"]: record for record in aggregate["records"]}
    maps = {mapping["pin_map_id"]: mapping for mapping in aggregate["pin_maps"]}
    facts = {fact["fact_id"]: fact for fact in aggregate["facts"]}
    require(len(maps) == len(aggregate["pin_maps"]) and {mapping["record_id"] for mapping in maps.values()} == set(records), "real pin maps: exact record/pin-map parity required")
    require(len(locks) == len(maps) and {lock["pin_map_id"] for lock in locks} == set(maps), "real pin locks: exact pin-map parity required")
    for lock in locks:
        required_keys(lock, ("record_id", "pin_map_id", "canonical_sha256", "evidence_fact_ids", "trust_status", "critical_pins", "reviewer"), "real pin lock")
        mapping = maps[lock["pin_map_id"]]
        require(lock["record_id"] == mapping["record_id"], f"{lock['record_id']}: pin-map record lock changed")
        require(lock["canonical_sha256"] == canonical_pin_map(mapping), f"{lock['record_id']}: canonical pin map changed")
        require(lock["trust_status"] in LOCK_TRUST_STATUSES, f"{lock['record_id']}: pin trust status")
        require(lock["evidence_fact_ids"] and set(lock["evidence_fact_ids"]) <= set(facts), f"{lock['record_id']}: pin evidence fact IDs")
        require(all(facts[fact_id]["record_id"] == lock["record_id"] for fact_id in lock["evidence_fact_ids"]), f"{lock['record_id']}: pin evidence belongs to another record")
        pins = {(pin["symbol_pin"], pin["name"], pin["footprint_pad"], pin["function"]) for pin in mapping["pins"]}
        locked = {(pin["symbol_pin"], pin["name"], pin["footprint_pad"], pin["function"]) for pin in lock["critical_pins"]}
        require(locked <= pins, f"{lock['record_id']}: critical pin lock changed")
    locks_by_record = {lock["record_id"]: lock for lock in locks}
    maps_by_record = {mapping["record_id"]: mapping for mapping in maps.values()}
    require(isinstance(check["assertions"], list), "policy pin-locks: assertions must be a list")
    for assertion in check["assertions"]:
        require(isinstance(assertion, dict) and "recordId" in assertion and set(assertion) <= {"recordId", "label", "trustStatus", "pin"}, f"policy pin-locks: invalid assertion {assertion!r}")
        record_id = assertion["recordId"]
        label = assertion.get("label", record_id)
        require(record_id in locks_by_record, f"{label}: pin lock for {record_id} is missing")
        if "trustStatus" in assertion:
            require(locks_by_record[record_id]["trust_status"] == assertion["trustStatus"], f"{label} pin lock must stay {assertion['trustStatus']}")
        if "pin" in assertion:
            want = assertion["pin"]
            require(isinstance(want, dict) and set(want) == {"name", "symbolPin", "footprintPad"}, f"policy pin-locks: pin assertion needs exactly name, symbolPin, footprintPad for {record_id}")
            pin = next((item for item in maps_by_record[record_id]["pins"] if item["name"] == want["name"]), None)
            require(
                pin is not None and pin["symbol_pin"] == want["symbolPin"] and pin["footprint_pad"] == want["footprintPad"],
                f"{label} {want['name']} must independently map symbol pin {want['symbolPin']} to footprint pad {want['footprintPad']}",
            )


def check_critical_fact_review(check, context):
    check_options(check, ("review", "requiredDomains", "minPasses", "reviewLogsRoot"))
    aggregate = context.aggregate
    data = load(project_file(context, check["review"], "critical-fact-review review"))
    required_domains = set(string_list(check["requiredDomains"], "critical-fact-review requiredDomains"))
    min_passes = check["minPasses"]
    require(isinstance(min_passes, int) and not isinstance(min_passes, bool) and min_passes >= 1, "policy critical-fact-review: minPasses must be a positive integer")
    logs_root = project_path(context, check["reviewLogsRoot"], "critical-fact-review reviewLogsRoot")
    require(logs_root.is_dir(), f"policy critical-fact-review: reviewLogsRoot is missing: {check['reviewLogsRoot']}")
    facts = {fact["fact_id"]: fact for fact in aggregate["facts"]}
    sources = {source["source_id"]: source for source in aggregate["sources"]}
    reviews = data["reviews"]
    require(reviews, "critical fact review: empty")
    require(len({review["review_id"] for review in reviews}) == len(reviews), "critical fact review: duplicate review ID")
    missing_domains = required_domains - {review["domain"] for review in reviews}
    require(not missing_domains, f"critical fact review: required destructive-risk domains missing {sorted(missing_domains)}")
    passes = data.get("independent_review_passes", [])
    require(len(passes) >= min_passes, f"critical fact review: {min_passes} independent review passes required")
    pass_ids = []
    for review_pass in passes:
        required_keys(review_pass, ("reviewer", "review_log", "review_log_sha256", "review_ids"), "critical fact independent pass")
        require(review_pass["reviewer"].strip() and review_pass["review_log"].strip() and review_pass["review_ids"], "critical fact review: incomplete independent pass")
        require(HEX64.fullmatch(review_pass["review_log_sha256"]) and review_pass["review_log_sha256"] != ZERO_SHA256, "critical fact review: independent pass needs a concrete review-log hash")
        review_log_path = logs_root / review_pass["review_log"]
        require(review_log_path.is_file() and review_log_path.resolve().is_relative_to(logs_root), "critical fact review: committed review-log file is missing or outside the review-logs root")
        require(hashlib.sha256(review_log_path.read_bytes()).hexdigest() == review_pass["review_log_sha256"], "critical fact review: review-log hash changed")
        pass_ids.extend(review_pass["review_ids"])
    require(len({review_pass["reviewer"] for review_pass in passes}) == len(passes), "critical fact review: independent pass reviewers must be distinct")
    require(len(pass_ids) == len(set(pass_ids)) and set(pass_ids) == {review["review_id"] for review in reviews}, "critical fact review: every fact needs exactly one independent family pass in addition to integration review")
    locks = {lock["review_id"]: lock["sha256"] for lock in data.get("fact_locks", [])}
    require(len(locks) == len(reviews) and set(locks) == {review["review_id"] for review in reviews}, "critical fact review: exact value/unit/evidence lock parity required")
    for review in reviews:
        required_keys(review, ("review_id", "domain", "fact_id", "source_id", "physical_pdf_page_index", "printed_page_label", "locator", "evidence_extract", "conditions", "reviewer", "status"), "critical fact review")
        pass_reviewer = next(review_pass["reviewer"] for review_pass in passes if review["review_id"] in review_pass["review_ids"])
        require(review["reviewer"] != pass_reviewer, f"{review['review_id']}: foreground and independent reviewers must differ")
        require(review["fact_id"] in facts and review["source_id"] in sources, f"{review['review_id']}: unknown fact/source")
        fact, source = facts[review["fact_id"]], sources[review["source_id"]]
        require(fact["source_id"] == review["source_id"], f"{review['review_id']}: fact/source mismatch")
        require(review["physical_pdf_page_index"] == source["physical_pdf_page_index"], f"{review['review_id']}: physical page index changed")
        require(review["printed_page_label"] == source["printed_page_label"], f"{review['review_id']}: printed page label changed")
        require(review["locator"] == fact["locator"] and review["conditions"] == fact["conditions"], f"{review['review_id']}: locator/conditions changed")
        require(isinstance(review["evidence_extract"], str) and review["evidence_extract"].strip(), f"{review['review_id']}: minimal extract required")
        lock_payload = {
            "value": fact["value"], "unit": fact["unit"], "locator": fact["locator"], "conditions": fact["conditions"],
            "source_evidence_extract": source["evidence_extract"], "review_evidence_extract": review["evidence_extract"],
        }
        actual_lock = hashlib.sha256(json.dumps(lock_payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        require(locks[review["review_id"]] == actual_lock, f"{review['review_id']}: value/unit/evidence lock changed")
        require(review["status"] in REVIEW_STATUSES, f"{review['review_id']}: review status")
        if source["availability"] == "SOURCE UNAVAILABLE" or fact["verdict"] == "UNSOURCED":
            require(review["status"] in ("OPEN", "UNSOURCED"), f"{review['review_id']}: unavailable/UNSOURCED fact cannot be confirmed")


def check_refresh_evidence(check, context):
    check_options(check, ("evidence", "requiredAuthorityClasses", "retrievalProfile"))
    required_classes = set(string_list(check["requiredAuthorityClasses"], "refresh-evidence requiredAuthorityClasses"))
    profile = check["retrievalProfile"]
    require(isinstance(profile, str) and profile.strip(), "policy refresh-evidence: retrievalProfile must be a nonblank string")
    sources = {source["source_id"]: source for source in context.aggregate["sources"]}
    evidence = load(project_file(context, check["evidence"], "refresh-evidence evidence"))["evidence"]
    require(evidence, "refresh evidence: empty")
    classes = set()
    for item in evidence:
        required_keys(item, ("source_id", "authoritative_url", "sha256", "checked_at", "result", "retrieval_profile"), "refresh evidence")
        require(item["source_id"] in sources, f"refresh evidence: unknown source {item['source_id']}")
        source = sources[item["source_id"]]
        require(source["availability"] == "AVAILABLE", f"{item['source_id']}: refresh evidence source unavailable")
        require((item["authoritative_url"], item["sha256"]) == (source["authoritative_url"], source["sha256"]), f"{item['source_id']}: stale refresh evidence")
        require(item["result"] == "MATCH" and item["retrieval_profile"] == profile, f"{item['source_id']}: invalid refresh result/profile")
        classes.add(source["authority_class"])
    missing = required_classes - classes
    require(not missing, f"refresh evidence requires examples of authority classes {sorted(missing)}")


def check_integration(check, context):
    check_options(check, ("exactDomains", "allowedVerdicts", "requireChainRule", "chainConstraints"), ("requiredFiles",))
    exact_domains = set(string_list(check["exactDomains"], "integration exactDomains"))
    allowed_verdicts = set(string_list(check["allowedVerdicts"], "integration allowedVerdicts"))
    require(isinstance(check["requireChainRule"], bool), "policy integration: requireChainRule must be a boolean")
    constraints = check["chainConstraints"]
    require(isinstance(constraints, dict), "policy integration: chainConstraints must be an object")
    trailing_open = constraints.get("trailingOpen", 0)
    require(isinstance(trailing_open, int) and not isinstance(trailing_open, bool) and 0 <= trailing_open <= len(EVIDENCE_STAGES), "policy integration: chainConstraints.trailingOpen must be an integer within the stage count")
    stage_status = {stage: status for stage, status in constraints.items() if stage != "trailingOpen"}
    require(set(stage_status) <= set(EVIDENCE_STAGES), f"policy integration: unknown chain stages {sorted(set(stage_status) - set(EVIDENCE_STAGES))}")
    for relative in string_list(check.get("requiredFiles", []), "integration requiredFiles"):
        require(project_path(context, relative, "integration requiredFiles").is_file(), f"integration: missing required file {relative}")
    require(context.config["integration"]["rulesPath"] is not None, "policy integration: integration.rulesPath must be configured")
    rules = context.rules
    require({rule["domain"] for rule in rules} == exact_domains, "integration rules: exact required domains")
    for rule in rules:
        require(rule["verdict"] in allowed_verdicts, f"{rule['rule_id']}: unsafe integration verdict")
    chains = chain_rules(rules)
    if check["requireChainRule"]:
        require(chains, "integration rules: an evidence-chain rule is required")
    for chain in chains:
        stages = chain["evidence_chain"]
        for stage in stages:
            if stage["stage"] in stage_status:
                require(stage["status"] == stage_status[stage["stage"]], f"integration evidence chain: {stage['stage']} stage must be {stage_status[stage['stage']]}")
        if trailing_open:
            require(all(stage["status"] == "OPEN" for stage in stages[-trailing_open:]), "integration evidence chain: downstream proof must remain OPEN")


def check_seeded_fixtures(check, context):
    check_options(check, ("directRouting", "invalidCases"))
    fixture = project_file(context, check["directRouting"], "seeded-fixtures directRouting")
    configured = context.config["routing"]["directRouting"]
    require(configured is not None and Path(configured).resolve() == fixture, f"policy seeded-fixtures: routing.directRouting must be {check['directRouting']}")
    cases = check["invalidCases"]
    require(isinstance(cases, list) and cases, "policy seeded-fixtures: invalidCases must be a non-empty list")
    for case in cases:
        require(isinstance(case, dict), "policy seeded-fixtures: invalid case must be an object")
        required_keys(case, ("name", "base", "target", "value", "expected_error"), "policy seeded-fixtures invalid case")
        require(case["base"] == "inventory", f"{case['name']}: unsupported invalid-case base {case['base']!r}")
        changed = copy.deepcopy(context.inventory)
        try:
            set_target(changed, case["target"], case["value"])
            validate_inventory_shape(changed)
            context.provider.validate(changed, context.aggregate, context.config)
        except (ContractError, StopIteration) as exc:
            require(case["expected_error"].casefold() in str(exc).casefold(), f"{case['name']}: failed for unintended reason: {exc}")
        else:
            raise ContractError(f"{case['name']}: invalid fixture passed")


CHECK_TYPES = {
    "pin-locks": check_pin_locks,
    "critical-fact-review": check_critical_fact_review,
    "refresh-evidence": check_refresh_evidence,
    "integration": check_integration,
    "seeded-fixtures": check_seeded_fixtures,
}


def run_checks(checks, context):
    """The ``checks`` policy key: run each typed check in file order."""
    require(isinstance(checks, list), "policy: checks must be a list")
    for check in checks:
        require(isinstance(check, dict) and isinstance(check.get("type"), str), "policy: each check needs a string type")
        require(check["type"] in CHECK_TYPES, f"policy: unknown check type {check['type']!r}; known: {sorted(CHECK_TYPES)}")
        CHECK_TYPES[check["type"]](check, context)
