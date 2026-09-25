"""The generic seeded self-test: golden locks, seeded mutations and invalid contract cases.

The fixtures are package data under ``selftest/``, never project data.
"""

from __future__ import annotations

import copy
from pathlib import Path

from .bundle import validate_bundle, validate_pin_maps
from .errors import ContractError, load, require
from .facts import validate_facts
from .sources import validate_source
from .template import template_bundle

SELFTEST_DIR = Path(__file__).parent / "selftest"


def validate_golden(data, schema, enforce_lock=True):
    for source in data["sources"]: validate_source(source, schema)
    validate_facts(data["facts"], data["sources"], schema)
    validate_pin_maps([data["pin_map"]])
    if enforce_lock:
        facts = {fact["fact_id"]: fact for fact in data["facts"]}
        expected = {
            "fact-golden-pin": ("1", "pin", "symbol-to-footprint mapping", "src-golden: Section 2, Figure 1, pin 1"),
            "fact-golden-limit": (20, "V", "DC, TA=25 degC", "src-golden: Section 2, Table 3, row VIN_MAX"),
            "fact-golden-project": (15, "V", "nominal contracted input", "src-golden: Section 2, Table 3, row VIN_PROJECT"),
            "fact-golden-default": ("LOW", "NONE", "after power-on reset before configuration", "src-golden: Section 2, Table 3, row RESET_DEFAULT"),
        }
        for fact_id, values in expected.items():
            fact = facts[fact_id]
            require((fact["value"], fact["unit"], fact["conditions"], fact["locator"]) == values, f"golden fact changed: {fact_id}")
        require(data["pin_map"]["pins"][0]["footprint_pad"] == "1", "golden pin map changed")


def set_target(data, target, value):
    parts = target.split(".")
    current = data
    for part in parts[:-1]:
        if isinstance(current, list):
            if part.isdigit():
                current = current[int(part)]
            else:
                current = next(item for item in current if item.get("line_id") == part or item.get("fact_id") == part or item.get("source_id") == part or item.get("coverage_id") == part)
        else:
            current = current[part]
    current[parts[-1]] = value


def run_seeded_fixtures(schema, template_dir, *, selftest_dir=SELFTEST_DIR, extra_cases=(), extra_bases=None):
    """Run the seeded self-test.

    ``extra_cases`` appends project invalid cases after the packaged ones; ``extra_bases``
    maps a case ``base`` the package does not know to a callable(case) that applies it.
    """
    selftest_dir = Path(selftest_dir)
    extra_bases = extra_bases or {}
    golden = load(selftest_dir / "golden/critical-facts.json")
    validate_golden(golden, schema)
    mutations = sorted((selftest_dir / "mutations").glob("*.json"))
    require(len(mutations) >= 6, "mutations: expected pin/value/unit/condition/default/locator fixtures")
    for path in mutations:
        mutation = load(path)
        changed = copy.deepcopy(golden)
        set_target(changed, mutation["target"], mutation["to"])
        try:
            validate_golden(changed, schema)
        except ContractError as exc:
            require(mutation["expected_error"] in str(exc), f"{path.name}: failed for unintended reason: {exc}")
        else:
            raise ContractError(f"{path.name}: seeded mutation passed")
    subordinate = load(selftest_dir / "valid/subordinate-record.json")
    validate_bundle(subordinate, schema)
    for case in [*load(selftest_dir / "invalid/contract-cases.json")["cases"], *extra_cases]:
        try:
            if case["base"] in extra_bases:
                extra_bases[case["base"]](case)
            elif case["base"] == "golden":
                changed = copy.deepcopy(golden); set_target(changed, case["target"], case["value"]); validate_golden(changed, schema, False)
            else:
                bundle = template_bundle(template_dir); set_target(bundle, case["target"], case["value"]); validate_bundle(bundle, schema)
        except (ContractError, StopIteration) as exc:
            require(case["expected_error"].casefold() in str(exc).casefold(), f"{case['name']}: failed for unintended reason: {exc}")
        else:
            raise ContractError(f"{case['name']}: invalid fixture passed")
