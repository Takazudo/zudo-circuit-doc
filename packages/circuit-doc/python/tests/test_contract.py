import copy
import hashlib
import io
import json
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parent.parent
PACKAGE_DIR = PYTHON_DIR.parent
sys.path.insert(0, str(PYTHON_DIR))

import circuit_evidence as validator  # noqa: E402

TEMPLATE = PACKAGE_DIR / "templates/component-skill-template"
SCHEMA = PACKAGE_DIR / "contract/schema.json"
SELFTEST = validator.SELFTEST_DIR
USER_AGENT = "zudo-circuit-doc-component-spec/1.0"


def golden():
    return validator.load(SELFTEST / "golden/critical-facts.json")


def template_bundle():
    return validator.template_bundle(TEMPLATE)


def clean_bundle(suffix="tst", mpn="TST-100", manufacturer="Test Maker", lcsc="C123"):
    """The template with every demo value replaced, as a real owner bundle would be."""
    text = json.dumps(template_bundle())
    for old, new in (
        ("Example Manufacturer", manufacturer),
        ("EXAMPLE-MPN", mpn),
        ("example.invalid", "vendor.test"),
        ("C000000", lcsc),
        ("independent-reviewer-placeholder", "reviewer-a"),
        ("-example", f"-{suffix}"),
    ):
        text = text.replace(old, new)
    return json.loads(text)


def skill_md(name):
    return (
        f"---\nname: {name}\n"
        "description: Resolve exact component limits and constraints for this synthetic test part. Use whenever it is relevant.\n"
        "---\n\n# Test component\n"
    )


def write_bundle(skill_dir, bundle):
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(skill_md(skill_dir.name), encoding="utf-8")
    for key, (filename, field) in validator.BUNDLE_FILES.items():
        (skill_dir / filename).write_text(json.dumps({"schema_version": 1, field: bundle[key]}), encoding="utf-8")


def line(line_id, mpn, manufacturer, lcsc="", function="schottky diode", owner="component-x"):
    return {"line_id": line_id, "mpn": mpn, "manufacturer": manufacturer, "lcsc": lcsc, "package": "SMB", "function": function, "owner_skill": owner}


class Response:
    def __init__(self, payload):
        self.payload = payload
    def __enter__(self): return self
    def __exit__(self, *_args): return False
    def read(self): return self.payload


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.schema = validator.load(SCHEMA)

    def test_template_has_human_component_reference(self):
        validator.validate_template_skill(TEMPLATE)

    def test_template_bundle_and_seeded_self_test_pass(self):
        validator.validate_bundle(template_bundle(), self.schema)
        validator.run_seeded_fixtures(self.schema, TEMPLATE)

    def test_seeded_self_test_rejects_a_case_failing_for_the_wrong_reason(self):
        case = {"name": "wrong-reason", "base": "template", "target": "sources.src-example.sha256", "value": "xyz", "expected_error": "coverage"}
        with self.assertRaisesRegex(validator.ContractError, "failed for unintended reason"):
            validator.run_seeded_fixtures(self.schema, TEMPLATE, extra_cases=[case])
        passing = {"name": "not-invalid", "base": "template", "target": "sources.src-example.revision", "value": "B", "expected_error": "x"}
        with self.assertRaisesRegex(validator.ContractError, "invalid fixture passed"):
            validator.run_seeded_fixtures(self.schema, TEMPLATE, extra_cases=[passing])
        seen = []
        project_case = {"name": "project", "base": "project", "expected_error": "project gate"}
        def project_base(case):
            seen.append(case["name"])
            validator.require(False, "project gate refused")
        validator.run_seeded_fixtures(self.schema, TEMPLATE, extra_cases=[project_case], extra_bases={"project": project_base})
        self.assertEqual(seen, ["project"])

    def test_every_seeded_mutation_fails_for_expected_reason(self):
        seen = set()
        for path in sorted((SELFTEST / "mutations").glob("*.json")):
            mutation = validator.load(path)
            seen.add(mutation["mutation"])
            changed = golden()
            validator.set_target(changed, mutation["target"], mutation["to"])
            with self.assertRaisesRegex(validator.ContractError, mutation["expected_error"]):
                validator.validate_golden(changed, self.schema)
        self.assertTrue({"pin", "value", "unit", "condition", "default state", "locator"} <= seen)

    def test_derived_margin_recomputes_and_cycles_fail(self):
        changed = golden()
        next(f for f in changed["facts"] if f["fact_id"] == "fact-golden-margin")["value"] = 4
        with self.assertRaisesRegex(validator.ContractError, "derived value is stale"):
            validator.validate_golden(changed, self.schema, False)
        changed = golden()
        project = next(f for f in changed["facts"] if f["fact_id"] == "fact-golden-project")
        project.update({"provenance": "CALCULATED", "depends_on": ["fact-golden-margin"], "expression": "fact_golden_margin"})
        with self.assertRaisesRegex(validator.ContractError, "cycle"):
            validator.validate_golden(changed, self.schema, False)

    def test_golden_lock_detects_changed_fact(self):
        changed = golden()
        next(f for f in changed["facts"] if f["fact_id"] == "fact-golden-pin")["conditions"] = "changed"
        with self.assertRaisesRegex(validator.ContractError, "golden fact changed"):
            validator.validate_golden(changed, self.schema)

    def test_calculated_expression_dependency_identity_is_exact(self):
        data = golden()
        margin = next(f for f in data["facts"] if f["fact_id"] == "fact-golden-margin")
        margin["expression"] = "fact_golden_limit"
        with self.assertRaisesRegex(validator.ContractError, "exactly match depends_on"):
            validator.validate_golden(data, self.schema, False)
        data = golden()
        margin = next(f for f in data["facts"] if f["fact_id"] == "fact-golden-margin")
        margin["depends_on"] = ["fact-golden-margin"]
        margin["expression"] = "fact_golden_margin"
        with self.assertRaisesRegex(validator.ContractError, "depends on itself"):
            validator.validate_golden(data, self.schema, False)

    def test_source_unavailable_requires_explicit_state(self):
        bundle = template_bundle()
        bundle["sources"][0]["availability"] = ""
        with self.assertRaisesRegex(validator.ContractError, "availability"):
            validator.validate_bundle(bundle, self.schema)

    def test_primary_and_calculated_pass_require_available_primary_leaves(self):
        bundle = template_bundle()
        primary = bundle["facts"][1]
        primary.update({"provenance": "PRIMARY-SPEC", "verdict": "PASS - primary-source confirmed"})
        with self.assertRaisesRegex(validator.ContractError, "AVAILABLE MANUFACTURER_PRIMARY"):
            validator.validate_bundle(bundle, self.schema)
        data = golden()
        next(f for f in data["facts"] if f["fact_id"] == "fact-golden-margin")["verdict"] = "PASS - primary-source confirmed"
        with self.assertRaisesRegex(validator.ContractError, "dependency closure"):
            validator.validate_pass_trust(data["facts"], data["sources"])
        trusted = golden()
        trusted["sources"][0].update({"availability": "AVAILABLE", "authority_class": "MANUFACTURER_PRIMARY"})
        for fact_id in ("fact-golden-limit", "fact-golden-project"):
            next(f for f in trusted["facts"] if f["fact_id"] == fact_id).update({"provenance": "PRIMARY-SPEC", "verdict": "PASS - primary-source confirmed"})
        next(f for f in trusted["facts"] if f["fact_id"] == "fact-golden-margin")["verdict"] = "PASS - primary-source confirmed"
        validator.validate_pass_trust(trusted["facts"], trusted["sources"])

    def test_stale_online_hash_fails_and_removes_download(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "source.pdf"
            with self.assertRaisesRegex(validator.ContractError, "stale online hash"):
                validator.store_and_verify(b"fixture", target, "0" * 64, "src-test")
            self.assertFalse(target.exists())

    def test_subordinate_uses_full_contract(self):
        bundle = validator.load(SELFTEST / "valid/subordinate-record.json")
        validator.validate_bundle(bundle, self.schema)
        next(f for f in bundle["facts"] if f["fact_id"] == "fact-child-pin")["locator"] = ""
        with self.assertRaisesRegex(validator.ContractError, "locator"):
            validator.validate_bundle(bundle, self.schema)

    def test_subordinate_parent_must_be_local_standalone(self):
        bundle = validator.load(SELFTEST / "valid/subordinate-record.json")
        next(r for r in bundle["records"] if r["record_id"] == "rec-child")["parent_record_id"] = "rec-missing"
        with self.assertRaisesRegex(validator.ContractError, "parent must resolve"):
            validator.validate_bundle(bundle, self.schema)
        bundle = validator.load(SELFTEST / "valid/subordinate-record.json")
        next(r for r in bundle["records"] if r["record_id"] == "rec-parent")["kind"] = "subordinate"
        next(r for r in bundle["records"] if r["record_id"] == "rec-parent")["parent_record_id"] = "rec-child"
        with self.assertRaisesRegex(validator.ContractError, "parent must resolve"):
            validator.validate_bundle(bundle, self.schema)

    def test_bundle_exact_parity_and_record_artifacts(self):
        for manifest_key, message in (("source_ids", "source ID parity"), ("fact_ids", "fact ID parity"), ("interaction_ids", "interaction ID parity")):
            bundle = template_bundle()
            bundle["records"][0][manifest_key].pop()
            with self.assertRaisesRegex(validator.ContractError, message):
                validator.validate_bundle(bundle, self.schema)
        bundle = template_bundle()
        bundle["records"][0]["fact_ids"].append(bundle["records"][0]["fact_ids"][0])
        with self.assertRaisesRegex(validator.ContractError, "duplicate fact_ids"):
            validator.validate_bundle(bundle, self.schema)
        for key, message in (("routes", "requires routing"), ("coverage", "requires coverage"), ("pin_maps", "requires pin map")):
            bundle = template_bundle()
            bundle[key] = []
            with self.assertRaisesRegex(validator.ContractError, message):
                validator.validate_bundle(bundle, self.schema)

    def test_local_routing_fixtures_are_executed(self):
        bundle = template_bundle()
        bundle["routes"][0]["positive"] = ["NOT-A-ROUTE"]
        with self.assertRaisesRegex(validator.ContractError, "positive query"):
            validator.validate_bundle(bundle, self.schema)
        bundle = template_bundle()
        bundle["routes"][0]["negative"] = ["EXAMPLE-MPN"]
        with self.assertRaisesRegex(validator.ContractError, "negative query"):
            validator.validate_bundle(bundle, self.schema)

    def test_open_domains_and_open_coverage_match(self):
        bundle = template_bundle()
        bundle["records"][0]["open_domains"] = ["harness"]
        with self.assertRaisesRegex(validator.ContractError, "open domains"):
            validator.validate_bundle(bundle, self.schema)
        bundle = template_bundle()
        bundle["coverage"][0]["status"] = "COVERED"
        with self.assertRaisesRegex(validator.ContractError, "open domains"):
            validator.validate_bundle(bundle, self.schema)

    def test_open_coverage_blocking_fact_ids_lint_rejects_old_defective_shape(self):
        migrated = template_bundle()
        validator.validate_bundle(migrated, self.schema)

        missing_field = copy.deepcopy(migrated)
        del missing_field["coverage"][0]["blocking_fact_ids"]
        with self.assertRaisesRegex(validator.ContractError, "missing keys"):
            validator.validate_bundle(missing_field, self.schema)

        unverifiable_claim = copy.deepcopy(migrated)
        unverifiable_claim["coverage"][0]["reason"] = (
            "Domain remains open because retained evidence is unavailable, lower-authority, or UNSOURCED."
        )
        unverifiable_claim["coverage"][0]["blocking_fact_ids"] = []
        with self.assertRaisesRegex(validator.ContractError, "blocking_fact_ids is empty"):
            validator.validate_bundle(unverifiable_claim, self.schema)

        non_blocking_member = copy.deepcopy(migrated)
        non_blocking_member["sources"][0]["availability"] = "AVAILABLE"
        non_blocking_member["sources"][0]["sha256"] = hashlib.sha256(b"non-blocking-fixture").hexdigest()
        next(f for f in non_blocking_member["facts"] if f["fact_id"] == "fact-example-pin")["verdict"] = "NOT APPLICABLE"
        with self.assertRaisesRegex(validator.ContractError, "does not carry a blocking verdict"):
            validator.validate_bundle(non_blocking_member, self.schema)

        reworded_bypass = copy.deepcopy(migrated)
        reworded_bypass["coverage"][0]["reason"] = "Domain stays open pending inspection of the assembled board."
        reworded_bypass["coverage"][0]["blocking_fact_ids"] = []
        self.assertFalse(validator.OPEN_UNAVAILABLE_CLAIM.search(reworded_bypass["coverage"][0]["reason"]))
        with self.assertRaisesRegex(validator.ContractError, "blocking-verdict facts"):
            validator.validate_bundle(reworded_bypass, self.schema)

        not_applicable_only = copy.deepcopy(reworded_bypass)
        not_applicable_only["sources"][0]["availability"] = "AVAILABLE"
        not_applicable_only["sources"][0]["sha256"] = hashlib.sha256(b"not-applicable-fixture").hexdigest()
        next(f for f in not_applicable_only["facts"] if f["fact_id"] == "fact-example-pin")["verdict"] = "NOT APPLICABLE"
        validator.validate_bundle(not_applicable_only, self.schema)

    def test_not_applicable_on_unavailable_source_never_blocks(self):
        # ADR-008: contract.md:9 — a NOT APPLICABLE fact never blocks, even on a SOURCE UNAVAILABLE source.
        bundle = template_bundle()
        self.assertEqual(bundle["sources"][0]["availability"], "SOURCE UNAVAILABLE")
        next(f for f in bundle["facts"] if f["fact_id"] == "fact-example-pin")["verdict"] = "NOT APPLICABLE"
        bundle["coverage"][0]["reason"] = "Domain stays open pending inspection of the assembled board."
        bundle["coverage"][0]["blocking_fact_ids"] = []
        validator.validate_bundle(bundle, self.schema)

        named = copy.deepcopy(bundle)
        named["coverage"][0]["blocking_fact_ids"] = ["fact-example-pin"]
        with self.assertRaisesRegex(validator.ContractError, "does not carry a blocking verdict"):
            validator.validate_bundle(named, self.schema)

    def test_unsourced_fact_on_unavailable_source_still_requires_a_blocker(self):
        bundle = template_bundle()
        bundle["coverage"][0]["reason"] = "Domain stays open pending inspection of the assembled board."
        bundle["coverage"][0]["blocking_fact_ids"] = []
        with self.assertRaisesRegex(validator.ContractError, "blocking_fact_ids is empty"):
            validator.validate_bundle(bundle, self.schema)
        for verdict in ("NEEDS BENCH", "BLOCKER - deterministic spec violation"):
            facts_by_id = {fact["fact_id"]: dict(fact, verdict=verdict) for fact in template_bundle()["facts"]}
            sources_by_id = {source["source_id"]: source for source in template_bundle()["sources"]}
            with self.subTest(verdict=verdict):
                self.assertTrue(validator.fact_blocks_domain("fact-example-pin", facts_by_id, sources_by_id))

    def test_every_owner_directory_and_artifact_is_required(self):
        lines = [
            dict(line("line-tst", "TST-100", "Test Maker", "C123", owner="component-tst"), package="EXAMPLE"),
            dict(line("line-oth", "OTH-200", "Other Maker", "C456", owner="component-oth"), package="EXAMPLE"),
        ]
        bundles = {
            "component-tst": clean_bundle(),
            "component-oth": clean_bundle("oth", "OTH-200", "Other Maker", "C456"),
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for owner, bundle in bundles.items():
                write_bundle(root / owner, bundle)
            (root / "component-spec-audit").mkdir()
            aggregate, by_owner = validator.validate_owner_bundles(self.schema, lines, root, reserved_dirs=("component-spec-audit",))
            self.assertEqual(sorted(by_owner), ["component-oth", "component-tst"])
            self.assertEqual(len(aggregate["records"]), 2)
            with self.assertRaisesRegex(validator.ContractError, "expected exact directories"):
                validator.validate_local_skills(self.schema, lines, root)
            (root / "component-oth" / "facts.json").unlink()
            with self.assertRaisesRegex(validator.ContractError, "missing local manifest files"):
                validator.validate_local_skills(self.schema, lines, root, reserved_dirs=("component-spec-audit",))

    def test_owner_prefix_and_inventory_parity_are_configurable(self):
        lines = [dict(line("line-tst", "TST-100", "Test Maker", "C123", owner="part-tst"), package="EXAMPLE")]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_bundle(root / "part-tst", clean_bundle())
            validator.validate_local_skills(self.schema, lines, root, owner_prefix="part-")
            wrong = [dict(lines[0], mpn="TST-999")]
            with self.assertRaisesRegex(validator.ContractError, "mpn differs from inventory"):
                validator.validate_local_skills(self.schema, wrong, root, owner_prefix="part-")

    def test_empty_aggregate_passes(self):
        empty = {key: [] for key in validator.BUNDLE_FILES}
        validator.validate_bundle(empty, self.schema)
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(validator.validate_local_skills(self.schema, [], Path(directory) / "missing"), empty)
        validator.validate_routing([], {"schema_version": 1, "cases": []})
        validator.check_placeholder_leak({})

    def test_available_source_rejects_zero_hash_sentinel(self):
        source = template_bundle()["sources"][0]
        source["availability"] = "AVAILABLE"
        source["sha256"] = validator.ZERO_SHA256
        with self.assertRaisesRegex(validator.ContractError, "all-zero"):
            validator.validate_source(source, self.schema)
        source["availability"] = "SOURCE UNAVAILABLE"
        validator.validate_source(source, self.schema)

    def test_unavailable_source_requires_zero_hash(self):
        source = copy.deepcopy(template_bundle()["sources"][0])
        source["sha256"] = "f" * 64
        with self.assertRaisesRegex(validator.ContractError, "SOURCE UNAVAILABLE must use all-zero"):
            validator.validate_source(source, self.schema)

    def test_source_record_id_is_a_required_key(self):
        self.assertIn("record_id", self.schema["source_required"])
        source = copy.deepcopy(template_bundle()["sources"][0])
        del source["record_id"]
        with self.assertRaisesRegex(validator.ContractError, r"missing keys \['record_id'\]"):
            validator.validate_source(source, self.schema)

    def test_calculated_exponent_is_bounded(self):
        self.assertAlmostEqual(validator.arithmetic("value ** 0.5", {"value": 33}), 33 ** 0.5)
        with self.assertRaisesRegex(validator.ContractError, "safety bound"):
            validator.arithmetic("value ** 1000000", {"value": 33})

    def test_external_vendor_qualifier_artifact_is_required(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing.json"
            with self.assertRaisesRegex(validator.ContractError, "is required"):
                validator.external_vendor_tokens(missing)
            with self.assertRaisesRegex(validator.ContractError, "is required"):
                validator.RoutingPolicy.load(missing)

    def test_external_vendor_qualifiers_may_be_empty(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "external-vendor-qualifiers.json"
            path.write_text(json.dumps({"schema_version": 1, "vendor_names": []}), encoding="utf-8")
            self.assertEqual(validator.external_vendor_tokens(path), set())
            path.write_text(json.dumps({"schema_version": 1, "vendor_names": ["Acme Parts", " "]}), encoding="utf-8")
            with self.assertRaisesRegex(validator.ContractError, "must be nonblank"):
                validator.external_vendor_tokens(path)
            path.write_text(json.dumps({"schema_version": 1, "vendor_names": ["Acme Parts"]}), encoding="utf-8")
            self.assertEqual(validator.RoutingPolicy.load(path).vendor_tokens, frozenset({"acme", "parts"}))

    def test_same_mpn_resolves_only_with_its_manufacturer(self):
        # ADR-009: manufacturer narrowing happens before multi-candidate rejection.
        a = line("line-a", "SS26", "Vishay")
        b = line("line-b", "SS26", "Rectron")
        lines = [a, b]
        cases = {
            "SS26": [],
            "Vishay SS26": ["line-a"],
            "SS26 by Vishay": ["line-a"],
            "Rectron SS26": ["line-b"],
            "Toshiba SS26": [],
            "Vishay Rectron SS26": [],
        }
        for query, expected in cases.items():
            with self.subTest(query=query):
                self.assertEqual(validator.resolve(query, lines), expected)
        validator.validate_routing(lines, {"schema_version": 1, "cases": [
            {"line_id": "line-a", "negative": "Toshiba SS26"},
            {"line_id": "line-b", "negative": "SS26"},
        ]})
        validator.validate_routing(lines, None)

    def test_routing_fails_closed_on_conflicts_and_vendor_hints(self):
        lines = [
            line("line-c1", "AO3401A", "Alpha & Omega Semiconductor", "C347476", "P-channel MOSFET"),
            line("line-c2", "0603WAF1003T5E", "UNI-ROYAL", "C25803", "100 kOhm resistor"),
        ]
        routing = validator.RoutingPolicy(frozenset({"vishay", "toshiba"}), frozenset({"board-p"}))
        cases = {
            "AO3401A": ["line-c1"],
            "C25803": ["line-c2"],
            "UNI-ROYAL 0603WAF1003T5E": ["line-c2"],
            "100 kOhm resistor 0603WAF1003T5E": ["line-c2"],
            "AO3401A C25803": [],
            "AO3401A C999999": [],
            "C347476 C25803": [],
            "Vishay AO3401A": [],
            "vishay AO3401A": [],
            "FakeCorp AO3401A": [],
            "AO3401A from Vishay": [],
            "Toshiba AO3401A C347476": [],
            "Board-P AO3401A": ["line-c1"],
            "review AO3401A gate": ["line-c1"],
            "UNI-ROYAL": [],
            "100 kOhm resistor": [],
        }
        for query, expected in cases.items():
            with self.subTest(query=query):
                self.assertEqual(validator.resolve(query, lines, routing), expected)
        self.assertEqual(validator.resolve("Board-P AO3401A", lines), [])
        validator.validate_routing(lines, {"cases": [{"line_id": "line-c1", "negative": "AO3401B"}, {"line_id": "line-c2", "negative": "Vishay 0603WAF1003T5E"}]}, routing)
        with self.assertRaisesRegex(validator.ContractError, "every inventory line needs one fixture"):
            validator.validate_routing(lines, {"cases": [{"line_id": "line-c1", "negative": "AO3401B"}]}, routing)
        with self.assertRaisesRegex(validator.ContractError, "negative query unexpectedly resolves"):
            validator.validate_routing(lines, {"cases": [{"line_id": "line-c1", "negative": "AO3401A"}, {"line_id": "line-c2", "negative": "x"}]}, routing)

    def test_placeholder_values_never_leak_into_active_bundles(self):
        validator.check_placeholder_leak({"component-tst": clean_bundle()})
        with self.assertRaisesRegex(validator.ContractError, "template placeholder leaked"):
            validator.check_placeholder_leak({"component-copy": template_bundle()})
        leaks = {
            "EXAMPLE-MPN": ("records", 0, "mpn"),
            "C000000": ("records", 0, "lcsc"),
            "https://example.invalid/EX-001.pdf": ("sources", 0, "authoritative_url"),
            "Example Manufacturer": ("records", 0, "manufacturer"),
            "independent-reviewer-placeholder": ("pin_maps", 0, "reviewed_by"),
            "rec-example": ("records", 0, "record_id"),
            "src-example": ("sources", 0, "source_id"),
            "line-example": ("records", 0, "line_id"),
        }
        for value, (key, index, field) in leaks.items():
            bundle = clean_bundle()
            bundle[key][index][field] = value
            with self.subTest(value=value), self.assertRaisesRegex(validator.ContractError, "template placeholder leaked"):
                validator.check_placeholder_leak({"component-tst": bundle})
        benign = clean_bundle()
        benign["records"][0]["lcsc"] = "C0000001"
        benign["sources"][0]["evidence_extract"] = "See the example application circuit and prec-example-free text."
        validator.check_placeholder_leak({"component-tst": benign})

    def test_browser_headers_success_and_403_are_explicit(self):
        source = copy.deepcopy(template_bundle()["sources"][0])
        source.update({"availability": "AVAILABLE", "sha256": hashlib.sha256(b"ok").hexdigest()})

        def success(request, timeout):
            self.assertEqual(timeout, validator.HTTP_TIMEOUT_SECONDS)
            self.assertIn("Mozilla/5.0", request.get_header("User-agent"))
            self.assertIn(USER_AGENT, request.get_header("User-agent"))
            self.assertIn("application/pdf", request.get_header("Accept"))
            return Response(b"ok")

        self.assertEqual(validator.fetch_source(source, success, user_agent=USER_AGENT), b"ok")

        source["request_headers"] = {"Referer": "https://manufacturer.example/product"}
        def referer_success(request, timeout):
            self.assertEqual(timeout, validator.HTTP_TIMEOUT_SECONDS)
            self.assertEqual(request.get_header("Referer"), source["request_headers"]["Referer"])
            return Response(b"ok")
        self.assertEqual(validator.fetch_source(source, referer_success, user_agent=USER_AGENT), b"ok")

        error = urllib.error.HTTPError(source["authoritative_url"], 403, "Forbidden", {}, io.BytesIO(b"forbidden"))

        def forbidden(_request, timeout):
            self.assertEqual(timeout, validator.HTTP_TIMEOUT_SECONDS)
            raise error

        try:
            with self.assertRaises(urllib.error.HTTPError):
                validator.fetch_source(source, forbidden, user_agent=USER_AGENT)
        finally:
            error.close()
        source["refresh_policy"] = "VOLATILE-HTML"
        source["refresh_note"] = "live response hash is not deterministic"
        source["authority_class"] = "DISTRIBUTOR_IDENTITY"
        source["identity_extract_sha256"] = "1" * 64
        validator.validate_source(source, self.schema)
        source["authority_class"] = "MANUFACTURER_PRIMARY"
        with self.assertRaisesRegex(validator.ContractError, "limited to canonical distributor identity"):
            validator.validate_source(source, self.schema)

    def test_online_refresh_uses_process_unique_temp_directory(self):
        source = copy.deepcopy(template_bundle()["sources"][0])
        payload = b"stable-refresh-bytes"
        source.update({"availability": "AVAILABLE", "sha256": hashlib.sha256(payload).hexdigest()})

        with tempfile.TemporaryDirectory() as directory:
            temp_root = Path(directory) / "cache" / "sources"
            nested = False
            def outer_opener(_request, timeout):
                nonlocal nested
                self.assertEqual(timeout, validator.HTTP_TIMEOUT_SECONDS)
                if not nested:
                    nested = True
                    validator.online_sources(self.schema, [source], [source["source_id"]], opener=lambda _request, timeout: Response(payload), temp_root=temp_root, user_agent=USER_AGENT)
                return Response(payload)

            validator.online_sources(self.schema, [source], [source["source_id"]], opener=outer_opener, temp_root=temp_root, user_agent=USER_AGENT)
            self.assertTrue(nested)
            self.assertEqual(list(temp_root.iterdir()), [])

    def test_online_refresh_all_can_skip_volatile_sources(self):
        stable = copy.deepcopy(template_bundle()["sources"][0])
        stable.update({"availability": "AVAILABLE", "sha256": hashlib.sha256(b"stable").hexdigest()})
        volatile = copy.deepcopy(stable)
        volatile.update({
            "source_id": "src-volatile", "refresh_policy": "VOLATILE-HTML", "refresh_note": "live response hash is not deterministic",
            "authority_class": "DISTRIBUTOR_IDENTITY", "identity_extract_sha256": "1" * 64,
        })
        opener = lambda _request, timeout: Response(b"stable")
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(validator.ContractError, "volatile source cannot claim deterministic selective refresh"):
                validator.online_sources(self.schema, [stable, volatile], opener=opener, temp_root=directory, user_agent=USER_AGENT)
            skipped = validator.online_sources(self.schema, [stable, volatile], opener=opener, temp_root=directory, user_agent=USER_AGENT, skip_volatile=True)
            self.assertEqual(skipped, ["src-volatile"])
            with self.assertRaisesRegex(validator.ContractError, "volatile source cannot claim"):
                validator.online_sources(self.schema, [stable, volatile], ["src-volatile"], opener=opener, temp_root=directory, user_agent=USER_AGENT, skip_volatile=True)

    def test_coverage_and_interaction_trust_fail_closed(self):
        bundle = template_bundle()
        bundle["coverage"][0]["status"] = "COVERED"
        bundle["records"][0]["open_domains"] = []
        with self.assertRaisesRegex(validator.ContractError, "unavailable or UNSOURCED"):
            validator.validate_bundle(bundle, self.schema)
        bundle = template_bundle()
        bundle["interactions"][0]["verdict"] = "PASS - primary-source confirmed"
        with self.assertRaisesRegex(validator.ContractError, "not trust-closed"):
            validator.validate_bundle(bundle, self.schema)
        bundle = template_bundle()
        bundle["interactions"][0]["verdict"] = "BLOCKER - deterministic spec violation"
        with self.assertRaisesRegex(validator.ContractError, "not trust-closed"):
            validator.validate_bundle(bundle, self.schema)
        bundle = template_bundle()
        bundle["facts"][0]["verdict"] = "BLOCKER - deterministic spec violation"
        with self.assertRaisesRegex(validator.ContractError, "deterministic BLOCKER"):
            validator.validate_bundle(bundle, self.schema)

    def test_canonical_pin_map_hash_is_order_independent(self):
        mapping = golden()["pin_map"]
        reordered = copy.deepcopy(mapping)
        reordered["pins"].reverse()
        self.assertEqual(validator.canonical_pin_map(mapping), validator.canonical_pin_map(reordered))
        renamed = copy.deepcopy(mapping)
        renamed["pins"][0]["name"] = "VIN"
        self.assertNotEqual(validator.canonical_pin_map(mapping), validator.canonical_pin_map(renamed))


if __name__ == "__main__":
    unittest.main()
