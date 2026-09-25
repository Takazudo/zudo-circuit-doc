"""LED regression: the new CLI (led-generator-v1 + fixtures/led/circuit/policy.json) against the
pinned upstream validator (the oracle), both run on the same temp copy of fixtures/led.

Offline only. fixtures/led bytes are hashed before and after the module and must not change.
"""

import copy
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from generic_project import PACKAGE_DIR, run_cli

from circuit_evidence import OPEN_UNAVAILABLE_CLAIM, canonical_pin_map, load, load_skill_bundle, resolve, resolve_bundle_route, validate_bundle
from circuit_evidence.aggregate import validate_owner_bundles
from circuit_evidence.cad import validate_pin_assets
from circuit_evidence.errors import ContractError
from circuit_evidence.integration import load_rules, validate_evidence_chain, validate_rules
from circuit_evidence.inventory import load_inventory, provider_for
from circuit_evidence.orchestrator import SCHEMA_PATH, validate
from circuit_evidence.policy.checks import check_critical_fact_review, check_pin_locks
from circuit_evidence.routing import RoutingPolicy, validate_routing

REPO_ROOT = PACKAGE_DIR.parents[1]
FIXTURE = REPO_ROOT / "fixtures/led"
AUDIT = ".claude/skills/component-spec-audit"
INTEGRATION = ".claude/skills/circuit-spec-integration"
ORACLE = f"{AUDIT}/scripts/validate.py"
PASS_LINE = "PASS: component-spec contract; 35 lines; offline=True; refreshed=none"
CONFIG_PATHS = (
    ("projectRoot",), ("bundles", "root"), ("bundles", "auditSkillDir"), ("inventory", "path"),
    ("routing", "directRouting"), ("routing", "vendorQualifiers"), ("template", "dir"),
    ("integration", "rulesPath"), ("integration", "forwardTests"), ("integration", "integrationSkillDir"),
    ("policy", "path"), ("online", "tempRoot"),
)


def tree_digest(root):
    """sha256 over every committed-kind file under ``root`` (materialized STEP excluded)."""
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix.lower() != ".step":
            digest.update(path.relative_to(root).as_posix().encode() + b"\0" + hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def stray_artifacts(root):
    return sorted(str(path) for path in root.rglob("*") if path.name == "__pycache__" or path.match("upstream/tmp/pdfs"))


FIXTURE_DIGEST = None


def setUpModule():
    global FIXTURE_DIGEST
    FIXTURE_DIGEST = tree_digest(FIXTURE)


def tearDownModule():
    if tree_digest(FIXTURE) != FIXTURE_DIGEST:
        raise AssertionError("fixtures/led bytes changed during the LED regression")
    if stray_artifacts(FIXTURE):
        raise AssertionError(f"stray artifacts left under fixtures/led: {stray_artifacts(FIXTURE)}")


def resolved_config(base):
    """Turn fixtures/led/circuit/validator-input.json into an absolute config for the copy at ``base``."""
    config = load(base / "circuit/validator-input.json")
    config.pop("comment")

    def absolute(value):
        return str(PACKAGE_DIR / value.removeprefix("package:")) if value.startswith("package:") else str(base / value)

    for dotted in CONFIG_PATHS:
        section = config
        for key in dotted[:-1]:
            section = section[key]
        section[dotted[-1]] = absolute(section[dotted[-1]])
    for spec in config["inventory"]["provider"]["specs"]:
        spec["path"] = absolute(spec["path"])
    for key in ("symbolLibraries", "footprintDirs"):
        config["cad"][key] = [absolute(item) for item in config["cad"][key]]
    return config


class LedCopy:
    """A temp copy of fixtures/led (upstream + circuit) plus its resolved config."""

    def __init__(self):
        self.directory = tempfile.TemporaryDirectory(prefix="led-regression-")
        self.base = Path(self.directory.name)
        shutil.copytree(FIXTURE / "upstream", self.base / "upstream", ignore=shutil.ignore_patterns("*.step", "*.STEP", "__pycache__", "tmp"))
        shutil.copytree(FIXTURE / "circuit", self.base / "circuit")
        self.root = self.base / "upstream"
        self.config = resolved_config(self.base)

    def cleanup(self):
        self.directory.cleanup()

    def path(self, relative):
        return self.root / relative

    def edit_json(self, relative, change):
        path = self.path(relative)
        data = load(path)
        change(data)
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def edit_text(self, relative, old, new):
        path = self.path(relative)
        text = path.read_text(encoding="utf-8")
        assert text.count(old) == 1, f"{relative}: {old!r} must occur once"
        path.write_text(text.replace(old, new), encoding="utf-8")

    def run_new(self):
        return run_cli("--config", "-", config=self.config)

    def run_oracle(self):
        env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
        return subprocess.run([sys.executable, "-B", ORACLE], cwd=self.root, capture_output=True, text=True, env=env, timeout=120)


def rule(rules, domain):
    return next(item for item in rules if item["domain"] == domain)


def chain_stage(data, stage):
    chain = next(item for item in data["rules"] if "evidence_chain" in item)
    return next(item for item in chain["evidence_chain"] if item["stage"] == stage)


def rename_al8860_ep(copy_):
    """Rename AL8860's EP pin consistently (pin map, critical pins, canonical hash) so only the EP assertion can fail."""
    def change_map(data):
        mapping = data["pin_maps"][0]
        next(pin for pin in mapping["pins"] if pin["name"] == "EP")["name"] = "EPAD"
        copy_.new_al8860_hash = canonical_pin_map(mapping)

    def change_lock(data):
        lock = next(item for item in data["locks"] if item["record_id"] == "rec-al8860mp-13")
        next(pin for pin in lock["critical_pins"] if pin["name"] == "EP")["name"] = "EPAD"
        lock["canonical_sha256"] = copy_.new_al8860_hash

    copy_.edit_json(".claude/skills/component-al8860mp-13/pin-map.json", change_map)
    copy_.edit_json(f"{AUDIT}/fixtures/golden/real-pin-maps.json", change_lock)


def remove_evidence_chain(data):
    del next(item for item in data["rules"] if "evidence_chain" in item)["evidence_chain"]


def set_policy_case(copy_, name, **fields):
    def change(data):
        seeded = next(check for check in data["checks"] if check["type"] == "seeded-fixtures")
        next(case for case in seeded["invalidCases"] if case["name"] == name).update(fields)
    path = copy_.base / "circuit/policy.json"
    data = load(path)
    change(data)
    path.write_text(json.dumps(data), encoding="utf-8")


def set_oracle_case(data, name, **fields):
    next(case for case in data["cases"] if case["name"] == name).update(fields)


# (name, mutate(copy), new-CLI FAIL substring, oracle FAIL substring or None when the oracle does not cover the gate)
MUTATIONS = (
    # pin-locks
    ("pin-locks: STUSB stays UNSOURCED",
     lambda c: c.edit_json(f"{AUDIT}/fixtures/golden/real-pin-maps.json", lambda d: next(l for l in d["locks"] if l["record_id"] == "rec-stusb4500qtr").update(trust_status="NEEDS BENCH")),
     "STUSB pin lock must stay UNSOURCED", "STUSB pin lock must stay UNSOURCED"),
    ("pin-locks: AL8860 EP maps to pin 9", rename_al8860_ep,
     "AL8860 EP must independently map symbol pin 9 to footprint pad 9", "AL8860 EP must independently map symbol pin 9 to footprint pad 9"),
    ("pin-locks: canonical pin-map hash",
     lambda c: c.edit_json(".claude/skills/component-stusb4500qtr/pin-map.json", lambda d: d["pin_maps"][0]["pins"][0].update(name="MUTATED")),
     "rec-stusb4500qtr: canonical pin map changed", "rec-stusb4500qtr: canonical pin map changed"),
    ("pin-locks: exact lock parity",
     lambda c: c.edit_json(f"{AUDIT}/fixtures/golden/real-pin-maps.json", lambda d: d["locks"].pop()),
     "real pin locks: exact pin-map parity required", "real pin locks: exact pin-map parity required"),
    # critical-fact-review
    ("critical-fact-review: 8 required domains",
     lambda c: c.edit_json(f"{AUDIT}/fixtures/golden/critical-fact-review.json", lambda d: next(r for r in d["reviews"] if r["domain"] == "connector").update(domain="rail")),
     "required destructive-risk domains missing ['connector']", "required destructive-risk domains missing"),
    ("critical-fact-review: at least 2 passes",
     lambda c: c.edit_json(f"{AUDIT}/fixtures/golden/critical-fact-review.json", lambda d: d.update(independent_review_passes=d["independent_review_passes"][:1])),
     "critical fact review: 2 independent review passes required", "two independent review passes required"),
    ("critical-fact-review: review-log hash lock",
     lambda c: c.path(f"{AUDIT}/review-artifacts/issue-21.md").write_text(c.path(f"{AUDIT}/review-artifacts/issue-21.md").read_text(encoding="utf-8") + "\ntampered\n", encoding="utf-8"),
     "critical fact review: review-log hash changed", "critical fact review: review-log hash changed"),
    ("critical-fact-review: review log inside reviewLogsRoot",
     lambda c: c.edit_json(f"{AUDIT}/fixtures/golden/critical-fact-review.json", lambda d: d["independent_review_passes"][0].update(review_log="../circuit-spec-integration/SKILL.md")),
     "review-log file is missing or outside", "review-log file is missing or outside"),
    ("critical-fact-review: value/unit/evidence lock",
     lambda c: c.edit_json(f"{AUDIT}/fixtures/golden/critical-fact-review.json", lambda d: d["reviews"][0].update(evidence_extract="changed extract")),
     "value/unit/evidence lock changed", "value/unit/evidence lock changed"),
    # refresh-evidence
    ("refresh-evidence: retrieval profile",
     lambda c: c.edit_json(f"{AUDIT}/fixtures/refresh-evidence.json", lambda d: d["evidence"][0].update(retrieval_profile="curl-v1")),
     "invalid refresh result/profile", "invalid refresh result/profile"),
    ("refresh-evidence: required authority classes",
     lambda c: c.edit_json(f"{AUDIT}/fixtures/refresh-evidence.json", lambda d: d.update(evidence=[e for e in d["evidence"] if e["source_id"] != "src-al8860-generator"])),
     "authority classes ['PROJECT_GENERATOR']", "requires generator and manufacturer-primary examples"),
    ("refresh-evidence: non-empty",
     lambda c: c.edit_json(f"{AUDIT}/fixtures/refresh-evidence.json", lambda d: d.update(evidence=[])),
     "refresh evidence: empty", "refresh evidence: empty"),
    # integration
    ("integration: exactly 8 domains",
     lambda c: c.edit_json(f"{INTEGRATION}/references/rules.json", lambda d: rule(d["rules"], "rail-envelope").update(domain="rail-envelope-extra")),
     "integration rules: exact required domains", "integration rules: exact required domains"),
    ("integration: verdict whitelist",
     lambda c: c.edit_json(f"{INTEGRATION}/references/rules.json", lambda d: rule(d["rules"], "rail-envelope").update(verdict="NOT APPLICABLE")),
     "rule-rail-envelope: unsafe integration verdict", "rule-rail-envelope: unsafe integration verdict"),
    ("integration: chain rule required",
     lambda c: c.edit_json(f"{INTEGRATION}/references/rules.json", remove_evidence_chain),
     "integration rules: an evidence-chain rule is required", "evidence_chain"),
    ("integration: generated-netlist stays MIXED",
     lambda c: c.edit_json(f"{INTEGRATION}/references/rules.json", lambda d: chain_stage(d, "generated-netlist").update(status="OPEN", fact_ids=[])),
     "generated-netlist stage must be MIXED", "generator prose cannot CONFIRM an exported netlist"),
    ("integration: last 5 stages OPEN",
     lambda c: c.edit_json(f"{INTEGRATION}/references/rules.json", lambda d: chain_stage(d, "pcb-orientation").update(status="MIXED")),
     "downstream proof must remain OPEN", "downstream proof must remain OPEN"),
    ("integration: required skill files",
     lambda c: c.path(f"{INTEGRATION}/agents/openai.yaml").unlink(),
     "integration: missing required file .claude/skills/circuit-spec-integration/agents/openai.yaml", "circuit-spec-integration: missing agents/openai.yaml"),
    # seeded-fixtures (the oracle's copies of these cases live in its contract-cases.json)
    ("seeded-fixtures: case fails for the expected reason",
     lambda c: (set_policy_case(c, "wrong-mpn", expected_error="ZZZ-UNRELATED"), c.edit_json(f"{AUDIT}/fixtures/invalid/contract-cases.json", lambda d: set_oracle_case(d, "wrong-mpn", expected_error="ZZZ-UNRELATED"))),
     "wrong-mpn: failed for unintended reason", "wrong-mpn: failed for unintended reason"),
    ("seeded-fixtures: a passing invalid case fails",
     lambda c: (set_policy_case(c, "wrong-package", value="USB-C-SMD_10P-P1.00-L6.8-W8.9"), c.edit_json(f"{AUDIT}/fixtures/invalid/contract-cases.json", lambda d: set_oracle_case(d, "wrong-package", value="USB-C-SMD_10P-P1.00-L6.8-W8.9"))),
     "wrong-package: invalid fixture passed", "wrong-package: invalid fixture passed"),
    # led-generator-v1 provider gates
    ("provider: MPN from the generator",
     lambda c: c.edit_text("scripts/schgen/board_p_spec.py", "('TYPE-C-31-M-17', 'TYPE-C-31-M-17', 'C283540'", "('TYPE-C-31-M-18', 'TYPE-C-31-M-17', 'C283540'"),
     "line-c283540: wrong MPN against generator", "line-c283540: wrong MPN against generator"),
    ("provider: placements from the generator",
     lambda c: c.edit_text("scripts/schgen/board_p_spec.py", "'J1':    ('TYPE-C-31-M-17'", "'J9':    ('TYPE-C-31-M-17'"),
     "line-c283540: board/refdes or DNP mismatch", "line-c283540: board/refdes or DNP mismatch"),
    ("provider: bare-copper exclusions",
     lambda c: c.edit_json(f"{AUDIT}/references/inventory.json", lambda d: d["exclusions"].pop()),
     "bare-copper exclusions differ", "bare-copper exclusions differ"),
    ("provider: generator symbol parity",
     lambda c: c.edit_text("scripts/schgen/board_p_spec.py", "('AO3401A_C347476', 'AO3401A', 'C347476'", "('AO3401A_C1', 'AO3401A', 'C347476'"),
     "pin map symbol differs from generator", "pin map symbol differs from generator"),
    ("provider: generator_specs consistency",
     lambda c: c.edit_json(f"{AUDIT}/references/inventory.json", lambda d: d["generator_specs"].reverse()),
     "differ from the configured specs", None),
)


class LedOracleParityTests(unittest.TestCase):
    def test_new_cli_and_oracle_both_pass_on_the_fixture_copy(self):
        led = LedCopy()
        try:
            new, oracle = led.run_new(), led.run_oracle()
            self.assertEqual(new.returncode, 0, new.stderr)
            self.assertEqual(new.stdout.splitlines()[-1], PASS_LINE)
            self.assertNotIn("SKIP:", new.stdout)
            self.assertEqual(oracle.returncode, 0, oracle.stderr)
            self.assertEqual(oracle.stdout.strip(), PASS_LINE)
        finally:
            led.cleanup()

    def test_every_policy_and_provider_gate_fails_on_its_mutation(self):
        for name, mutate, expected, oracle_expected in MUTATIONS:
            with self.subTest(gate=name):
                led = LedCopy()
                try:
                    mutate(led)
                    result = led.run_new()
                    self.assertEqual(result.returncode, 1, f"new CLI passed: {result.stdout}")
                    self.assertIn(expected, result.stderr)
                    self.assertNotIn("Traceback", result.stderr)
                    if oracle_expected is not None:
                        oracle = led.run_oracle()
                        self.assertNotEqual(oracle.returncode, 0, f"oracle passed: {oracle.stdout}")
                        self.assertIn(oracle_expected, oracle.stderr)
                finally:
                    led.cleanup()

    def test_dropping_the_direct_routing_fixture_fails_the_policy(self):
        led = LedCopy()
        try:
            led.config["routing"]["directRouting"] = None
            result = led.run_new()
            self.assertEqual(result.returncode, 1)
            self.assertIn("policy seeded-fixtures: routing.directRouting must be", result.stderr)
        finally:
            led.cleanup()


class LedCorpusTests(unittest.TestCase):
    """The 15 LED-corpus tests of upstream test_validate.py, run against a temp copy."""

    @classmethod
    def setUpClass(cls):
        cls.led = LedCopy()
        cls.config = cls.led.config
        cls.schema = load(SCHEMA_PATH)
        cls.inventory_data = load_inventory(cls.config["inventory"]["path"])
        cls.provider = provider_for(cls.config["inventory"]["provider"])
        cls.routing = RoutingPolicy.load(cls.config["routing"]["vendorQualifiers"], cls.provider.board_names(cls.inventory_data))
        cls.provider.validate_inventory(cls.inventory_data, cls.config)
        cls.lines = cls.inventory_data["lines"]

    @classmethod
    def tearDownClass(cls):
        cls.led.cleanup()

    def aggregate(self, bundles_root=None):
        return validate_owner_bundles(self.schema, self.lines, bundles_root or self.config["bundles"]["root"], reserved_dirs=["component-spec-audit"], routing=self.routing)[0]

    def context(self, aggregate):
        return SimpleNamespace(config=self.config, aggregate=aggregate)

    def pin_assets(self, aggregate):
        result = SimpleNamespace(lines=self.lines)
        validate_pin_assets(aggregate, self.lines, self.config["cad"], provider=self.provider, provider_result=result)

    def test_power_switch_identity_is_jlcpcb_and_not_external(self):
        switch = next(line for line in self.lines if line["lcsc"] == "C5446803")
        self.assertEqual(switch["mpn"], "SS-12D01-G020")
        self.assertNotEqual(switch.get("mounting"), "external")
        self.assertEqual(resolve("G-Switch SS-12D01-G020", self.lines, self.routing), ["line-c5446803"])
        for change in ("blank-lcsc", "wrong-mpn"):
            data = copy.deepcopy(self.inventory_data)
            line = next(line for line in data["lines"] if line["lcsc"] == "C5446803")
            if change == "blank-lcsc": line["lcsc"] = ""
            else: line["mpn"] = "WR11AS"
            with self.subTest(change=change), self.assertRaises(ContractError):
                self.provider.validate_inventory(data, self.config)

    def test_power_switch_pin_map_cannot_claim_wrong_pcb_footprint(self):
        aggregate = self.aggregate()
        next(m for m in aggregate["pin_maps"] if m["record_id"] == "rec-c5446803")["footprint"] = "R0603"
        with self.assertRaises(ContractError):
            self.pin_assets(aggregate)

    def test_power_switch_rejects_a_fused_rail_bypass(self):
        """Fixture-only: this imports and EXECUTES schgen code, so it runs in a subprocess from the temp copy."""
        script = (
            "import copy, sys\n"
            "sys.path.insert(0, 'scripts/schgen')\n"
            "import verify_power_switch as v\n"
            "v.check_topology(v.spec.NETS)\n"
            "broken = copy.deepcopy(v.spec.NETS)\n"
            "broken['V15_FUSED'].remove('F1.2')\n"
            "broken['V15'].append('F1.2')\n"
            "try:\n    v.check_topology(broken)\nexcept AssertionError:\n    print('bypass rejected')\n"
            "else:\n    raise SystemExit('fused rail bypass accepted')\n"
        )
        env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
        result = subprocess.run([sys.executable, "-B", "-c", script], cwd=self.led.root, capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "bypass rejected")

    def test_full_offline_contract(self):
        self.assertEqual(validate(self.config).lines, self.inventory_data["assertions"]["orderable_lines"])

    def test_inventory_counts_and_exclusions(self):
        assertions = self.inventory_data["assertions"]
        self.assertEqual(len(self.lines), assertions["orderable_lines"])
        self.assertEqual(sum(not line["dnp"] for line in self.lines), assertions["fitted_lines"])
        self.assertEqual(sum(line["dnp"] for line in self.lines), assertions["dnp_or_hand_fit_lines"])
        self.assertEqual(len(self.inventory_data["exclusions"]), 4)

    def test_all_routing_cases_are_direct(self):
        fixture = load(self.config["routing"]["directRouting"])
        validate_routing(self.lines, fixture, self.routing)
        self.assertEqual({case["line_id"] for case in fixture["cases"]}, {line["line_id"] for line in self.lines})

    def test_open_coverage_blocking_fact_ids_lint_passes_on_migrated_data(self):
        for owner in sorted({line["owner_skill"] for line in self.lines}):
            bundle = load_skill_bundle(Path(self.config["bundles"]["root"]) / owner)
            for item in bundle["coverage"]:
                self.assertIn("blocking_fact_ids", item, f"{owner}/{item['coverage_id']}: missing blocking_fact_ids")
                if item["status"] == "OPEN" and OPEN_UNAVAILABLE_CLAIM.search(item["reason"]):
                    self.assertTrue(item["blocking_fact_ids"], f"{owner}/{item['coverage_id']}: unverifiable OPEN claim")

    def test_every_owner_directory_and_artifact_is_required(self):
        owners = sorted({line["owner_skill"] for line in self.lines})
        for missing in ("directory", "facts.json"):
            with tempfile.TemporaryDirectory() as directory, self.subTest(missing=missing):
                skills_root = Path(directory)
                for owner in owners:
                    shutil.copytree(Path(self.config["bundles"]["root"]) / owner, skills_root / owner)
                self.aggregate(skills_root)
                if missing == "directory":
                    shutil.rmtree(skills_root / owners[0])
                    expected = "expected exact directories"
                else:
                    (skills_root / owners[0] / "facts.json").unlink()
                    expected = "missing local manifest files"
                with self.assertRaisesRegex(ContractError, expected):
                    self.aggregate(skills_root)

    def test_routing_fails_closed_on_conflicts_and_filters(self):
        cases = {
            "0603WAF4700T5E C23162": [],
            "UNI-ROYAL 0603WAF1003T5E": ["line-c25803"],
            "CL31A106KBHNNNE C15849": [],
            "Samsung Electro-Mechanics 0603WAF1003T5E": [],
            "100 kOhm resistor 0603WAF1003T5E": ["line-c25803"],
            "RLP25FEER200": ["line-c459674"],
            "C45783": ["line-c45783"],
            "other-vendor SS26 C999019": [],
            "Vishay SS26 C7420363": [],
            "vishay SS26 C7420363": [],
            "FakeCorp AO3401A C347476": [],
            "fakecorp AO3401A C347476": [],
            "AO3401A from Vishay C347476": [],
            "SS26 by vishay C7420363": [],
            "AOS AO3401A C347476": [],
            "Alpha and Omega AO3401A C347476": [],
            "Toshiba AO3401A C347476": [],
            "AOS C347476": [],
            "Vishay C7420363": [],
            "Board-P AL8860MP-13 C500782": ["line-c500782"],
            "review AL8860MP-13 CTRL pin": ["line-c500782"],
            "inspect AL8860MP-13 CTRL pin": ["line-c500782"],
            "new AL8860MP-13 design": ["line-c500782"],
            "UNI-ROYAL": [],
            "100 kOhm resistor": [],
        }
        for query, expected in cases.items():
            with self.subTest(query=query):
                self.assertEqual(resolve(query, self.lines, self.routing), expected)
        bundle = load_skill_bundle(Path(self.config["bundles"]["root"]) / "component-project-passives")
        self.assertEqual(resolve_bundle_route("0603WAF4700T5E C23162", bundle["routes"], self.routing), [])
        self.assertEqual(resolve_bundle_route("UNI-ROYAL 0603WAF1003T5E", bundle["routes"], self.routing), ["rec-c25803"])

    def test_real_pin_locks_reject_deletion_rename_and_swap(self):
        aggregate = self.aggregate()
        policy = next(check for check in load(self.config["policy"]["path"])["checks"] if check["type"] == "pin-locks")
        check_pin_locks(policy, self.context(aggregate))
        for mutation in ("delete", "rename", "swap"):
            changed = copy.deepcopy(aggregate)
            mapping = next(item for item in changed["pin_maps"] if len(item["pins"]) >= 2)
            if mutation == "delete": mapping["pins"].pop()
            elif mutation == "rename": mapping["pins"][0]["name"] += "_MUTATED"
            else:
                mapping["pins"][0]["footprint_pad"], mapping["pins"][1]["footprint_pad"] = mapping["pins"][1]["footprint_pad"], mapping["pins"][0]["footprint_pad"]
            with self.subTest(mutation=mutation), self.assertRaisesRegex(ContractError, "canonical pin map changed"):
                check_pin_locks(policy, self.context(changed))

    def test_pin_maps_match_kicad_symbols_and_footprints(self):
        aggregate = self.aggregate()
        self.pin_assets(aggregate)
        changed = copy.deepcopy(aggregate)
        changed["pin_maps"][0]["pins"][0]["footprint_pad"] = "999"
        with self.assertRaisesRegex(ContractError, "differs from KiCad footprint"):
            self.pin_assets(changed)
        # The generic CAD check runs first, so the generator-parity hook is exercised directly.
        for field in ("symbol", "footprint"):
            changed = copy.deepcopy(aggregate)
            changed["pin_maps"][0][field] += "_WRONG"
            with self.subTest(field=field), self.assertRaisesRegex(ContractError, "differs from generator"):
                self.provider.extra_pin_asset_checks(SimpleNamespace(lines=self.lines), changed)

    def test_integration_calculations_recompute_from_raw_facts(self):
        aggregate = self.aggregate()
        rules = load_rules(self.config["integration"]["rulesPath"])
        validate_rules(rules, aggregate, self.schema)
        for fact_id in ("fact-c25803-resistance", "fact-c22807-resistance", "fact-c14663-capacitance", "fact-high-diode-smaj20a-clamp", "fact-stusb-vdd-absolute-max"):
            changed = copy.deepcopy(aggregate)
            next(fact for fact in changed["facts"] if fact["fact_id"] == fact_id)["value"] *= 2
            with self.subTest(fact_id=fact_id), self.assertRaisesRegex(ContractError, "result is stale"):
                validate_rules(rules, changed, self.schema)
        changed_rules = copy.deepcopy(rules)
        calculation = next(item for rule_ in changed_rules for item in rule_.get("conditioned_calculations", []) if item["calculation_id"] == "calc-q1-steady-vgs")
        calculation["results"][0]["vgs_v"] = -9.6
        with self.assertRaisesRegex(ContractError, "scenario result is stale"):
            validate_rules(changed_rules, aggregate, self.schema)
        changed = copy.deepcopy(aggregate)
        pins = changed["pin_maps"][0]["pins"]
        pins[0]["footprint_pad"], pins[1]["footprint_pad"] = pins[1]["footprint_pad"], pins[0]["footprint_pad"]
        with self.assertRaisesRegex(ContractError, "symbol-pin to footprint-pad"):
            self.pin_assets(changed)

    def test_generator_prose_cannot_confirm_exported_netlist(self):
        aggregate = self.aggregate()
        chain = copy.deepcopy(rule(load_rules(self.config["integration"]["rulesPath"]), "source-to-bench-chain"))
        generated = next(stage for stage in chain["evidence_chain"] if stage["stage"] == "generated-netlist")
        self.assertEqual(generated["status"], "MIXED")
        changed = copy.deepcopy(aggregate)
        next(fact for fact in changed["facts"] if fact["fact_id"] == generated["fact_ids"][0])["value"] = "nonsense free text"
        generated["status"] = "CONFIRMED"
        with self.assertRaisesRegex(ContractError, "generator prose cannot CONFIRM"):
            validate_evidence_chain(chain, changed)

    def test_critical_fact_review_locks_claim_locator_and_conditions(self):
        aggregate = self.aggregate()
        policy_path = Path(self.config["policy"]["path"])
        policy = next(check for check in load(policy_path)["checks"] if check["type"] == "critical-fact-review")
        review_path = self.led.path(policy["review"])
        review = load(review_path)

        def run(aggregate_, review_=None):
            if review_ is not None:
                review_path.write_text(json.dumps(review_), encoding="utf-8")
            try:
                check_critical_fact_review(policy, self.context(aggregate_))
            finally:
                review_path.write_text(json.dumps(review), encoding="utf-8")

        run(aggregate)
        fact_id = review["reviews"][0]["fact_id"]
        changed = copy.deepcopy(aggregate)
        next(fact for fact in changed["facts"] if fact["fact_id"] == fact_id)["locator"] += " changed"
        with self.assertRaisesRegex(ContractError, "locator/conditions changed"):
            run(changed)
        for field, value in (("value", 104), ("unit", "kV")):
            changed = copy.deepcopy(aggregate)
            next(fact for fact in changed["facts"] if fact["fact_id"] == fact_id)[field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ContractError, "value/unit/evidence lock changed"):
                run(changed)
        changed = copy.deepcopy(aggregate)
        source_id = review["reviews"][0]["source_id"]
        next(source for source in changed["sources"] if source["source_id"] == source_id)["evidence_extract"] = "arbitrary"
        with self.assertRaisesRegex(ContractError, "value/unit/evidence lock changed"):
            run(changed)
        changed_review = copy.deepcopy(review)
        changed_review["independent_review_passes"][0]["review_log"] = "review-artifacts/missing.md"
        with self.assertRaisesRegex(ContractError, "review-log file is missing"):
            run(aggregate, changed_review)
        changed_review = copy.deepcopy(review)
        changed_review["independent_review_passes"][0]["review_log_sha256"] = "f" * 64
        with self.assertRaisesRegex(ContractError, "review-log hash changed"):
            run(aggregate, changed_review)

    def test_distributor_identity_lane_cannot_promote_limits(self):
        bundle = load_skill_bundle(Path(self.config["bundles"]["root"]) / "component-type-c-31-m-17")
        fact = next(item for item in bundle["facts"] if item["provenance"] == "DISTRIBUTOR-IDENTITY")
        validate_bundle(bundle, self.schema)
        for field, value in (("class", "ABSOLUTE_MAXIMUM"), ("verdict", "PASS - primary-source confirmed"), ("provenance", "PRIMARY-SPEC")):
            changed = copy.deepcopy(bundle)
            next(item for item in changed["facts"] if item["fact_id"] == fact["fact_id"])[field] = value
            with self.subTest(field=field), self.assertRaises(ContractError):
                validate_bundle(changed, self.schema)
        for field in ("lcsc", "manufacturer", "mpn"):
            changed = copy.deepcopy(bundle)
            next(item for item in changed["facts"] if item["fact_id"] == fact["fact_id"])["value"][field] += "-wrong"
            with self.subTest(identity_field=field), self.assertRaisesRegex(ContractError, "differs from owning record"):
                validate_bundle(changed, self.schema)
        changed = copy.deepcopy(bundle)
        next(item for item in changed["facts"] if item["fact_id"] == fact["fact_id"])["value"]["voltage_v"] = 20
        with self.assertRaisesRegex(ContractError, "exact structured identity keys"):
            validate_bundle(changed, self.schema)
        changed = copy.deepcopy(bundle)
        next(item for item in changed["facts"] if item["fact_id"] == fact["fact_id"])["value"]["variant"] = "mutated identity parser output"
        with self.assertRaisesRegex(ContractError, "canonical distributor identity extract hash changed"):
            validate_bundle(changed, self.schema)


if __name__ == "__main__":
    unittest.main()
