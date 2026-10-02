"""Candidate inventory identity, owner parity and closed aggregate partitions."""

import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from generic_project import bundle_for, line, make_project, run_cli, schema, write_bundle, write_json
from circuit_evidence.aggregate import partition_aggregate, validate_owner_bundles
from circuit_evidence.errors import ContractError
from circuit_evidence.inventory import load_candidates, provider_for, validate_candidates
from circuit_evidence.inventory.led_generator_v1 import LedGeneratorProvider
from circuit_evidence.orchestrator import validate, validate_config


def candidate(**changes):
    return {
        "candidate_id": "cand-b", "owner_skill": "component-a", "mpn": "ALT-200",
        "manufacturer": "Alternate Maker", "lcsc": "", "package": "PKG",
        "function": "schottky diode", **changes,
    }


def candidate_bundle(entry, suffix="b"):
    bundle = bundle_for({**entry, "line_id": None}, suffix=suffix)
    bundle["records"][0]["candidate_id"] = entry["candidate_id"]
    return bundle


def combined(*bundles):
    return {key: [item for bundle in bundles for item in bundle[key]] for key in bundles[0]}


class CandidateTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.line = line("line-a", "FIT-100", "Fitted Maker", owner="component-a", lcsc="C100")
        self.entry = candidate()
        self.fitted = bundle_for(self.line, suffix="a")
        self.alternative = candidate_bundle(self.entry)

    def project(self, *, candidate_only=False, bundle=None):
        bundle = bundle if bundle is not None else (self.alternative if candidate_only else combined(self.fitted, self.alternative))
        config = make_project(self.root, [] if candidate_only else [self.line], bundles={"component-a": bundle})
        config["inventory"]["candidatesPath"] = str(write_json(self.root / "candidates.json", {"schema_version": 1, "candidates": [self.entry]}))
        return config

    def owner_bundles(self, bundle, *, entries=None):
        config = self.project(bundle=bundle)
        return validate_owner_bundles(schema(), [self.line], config["bundles"]["root"], candidates=[self.entry] if entries is None else entries, reserved_dirs=config["bundles"]["reservedDirs"])

    def test_mixed_owner_passes_and_context_keeps_both_partitions(self):
        config = self.project()
        with patch("circuit_evidence.orchestrator.run_policy") as policy:
            report = validate(config)
        context = policy.call_args.args[0]
        self.assertEqual(report.lines, 1)
        self.assertEqual(context.candidates, [self.entry])
        self.assertEqual(context.fitted_aggregate, self.fitted)
        self.assertEqual(context.candidate_aggregate, self.alternative)
        self.assertEqual(context.aggregate, combined(self.fitted, self.alternative))
        result = run_cli("--config", "-", "--json", config=config)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["lines"], 1)

    def test_candidate_only_owner_passes_with_no_fitted_lines(self):
        config = self.project(candidate_only=True)
        self.assertEqual(validate(config).lines, 0)

    def test_candidates_are_excluded_from_cad_and_scope_counts_candidate_owners(self):
        second = candidate(candidate_id="cand-c", owner_skill="component-candidates", mpn="ALT-300", lcsc="C300", package="ALT-PKG")
        shared_bundle = combined(self.fitted, self.alternative)
        candidate_only_bundle = candidate_bundle(second, "c")
        cad_dir = self.root / "cad"
        footprints = cad_dir / "footprints"
        footprints.mkdir(parents=True)
        symbol_library = cad_dir / "project.kicad_sym"
        symbol_library.write_text(
            '(kicad_symbol_lib (symbol "FIT-100" (symbol "FIT-100_1_1" '
            '(pin passive line (at 0 0 0) (length 2.54) (name "IN") (number "1")))))\n',
            encoding="utf-8",
        )
        (footprints / "PKG.kicad_mod").write_text('(footprint "PKG" (pad "1" smd rect))\n', encoding="utf-8")
        config = make_project(
            self.root,
            [self.line],
            bundles={"component-a": shared_bundle, "component-candidates": candidate_only_bundle},
            cad={
                "enabled": True,
                "symbolLibraries": [str(symbol_library)],
                "footprintDirs": [str(footprints)],
                "requirePinEqualsPad": True,
            },
        )
        config["inventory"]["candidatesPath"] = str(write_json(
            self.root / "candidates.json", {"schema_version": 1, "candidates": [self.entry, second]},
        ))

        report = validate(config)
        self.assertEqual(report.lines, 1)
        self.assertEqual(report.pass_line(), "PASS: component-spec contract; 1 lines; offline=True; refreshed=none")
        self.assertIn(
            "SCOPE: candidates: 2 audited candidate records in 2 owners "
            "(excluded from placements, CAD binding, routing and publication)",
            report.prefixed_lines(),
        )
        result = run_cli("--config", "-", config=config)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PASS: component-spec contract; 1 lines;", result.stdout)
        self.assertIn("SCOPE: candidates: 2 audited candidate records in 2 owners", result.stdout)

    def test_integration_rules_reject_candidate_record_or_fact_references(self):
        rule_template = {
            "rule_id": "rule-candidate", "domain": "candidate-check", "record_ids": [], "fact_ids": [],
            "conditions": "under the stated conditions", "verdict": schema()["verdicts"][0],
            "refusal": "refuse an unsupported conclusion",
        }
        for record_ids, fact_ids in ((["rec-b"], ["fact-a-pin"]), (["rec-a"], ["fact-b-pin"])):
            with self.subTest(record_ids=record_ids, fact_ids=fact_ids):
                config = self.project()
                rule = {**rule_template, "record_ids": record_ids, "fact_ids": fact_ids}
                write_json(config["integration"]["rulesPath"], {"schema_version": 1, "rules": [rule]})
                with self.assertRaisesRegex(ContractError, "integration rule references an audited candidate record"):
                    validate(config)

    def test_manual_provider_candidate_mutation_checks_fitted_identity(self):
        provider = provider_for({"kind": "manual"})
        colliding = candidate(mpn=self.line["mpn"], manufacturer=self.line["manufacturer"])
        with self.assertRaisesRegex(ContractError, "duplicate \\(manufacturer, mpn\\) identity"):
            provider.validate_candidates([colliding], {"lines": [self.line]})

    def test_led_generator_provider_rejects_candidates_placed_by_lcsc_or_external_key(self):
        specs = (
            (
                "placed_lcsc.py",
                "PROJECT_NAME = 'main-board'\n"
                "COMPONENTS = {'D1': ('ALT-200_C200', 'ALT-200', 'C200', 'lib:PKG', False, (0, 0))}\n"
                "NETS = {}\n",
                candidate(candidate_id="cand-lcsc", mpn="ALT-200", lcsc="C200"),
            ),
            (
                "placed_external.py",
                "PROJECT_NAME = 'main-board'\n"
                "COMPONENTS = {'J1': ('ALT-EXT', 'ALT-EXT', '', '', False, (0, 0))}\n"
                "EXTERNAL_COMPONENTS = {'J1': {'mpn': 'ALT-EXT', 'manufacturer': 'External Maker', "
                "'package': 'CONNECTOR', 'supplier': 'Test Supplier', 'order_code': 'O-1', "
                "'datasheet': 'https://example.test/ds'}}\n"
                "NETS = {}\n",
                candidate(candidate_id="cand-external", mpn="ALT-EXT", manufacturer="External Maker", lcsc="", package="CONNECTOR"),
            ),
        )
        for filename, source, entry in specs:
            with self.subTest(filename=filename):
                spec = self.root / filename
                spec.write_text(source, encoding="utf-8")
                provider = LedGeneratorProvider({"kind": "led-generator-v1", "specs": [{"path": str(spec)}]})
                with self.assertRaisesRegex(ContractError, "candidate is placed by generator specs; it is fitted, not a candidate"):
                    provider.validate_candidates([entry], {"lines": [self.line]})

    def test_candidate_owner_separate_from_fitted_owner(self):
        self.entry["owner_skill"] = "component-alternatives"
        config = make_project(self.root, [self.line], bundles={"component-a": self.fitted, "component-alternatives": self.alternative})
        config["inventory"]["candidatesPath"] = str(write_json(self.root / "candidates.json", {"schema_version": 1, "candidates": [self.entry]}))
        self.assertEqual(validate(config).lines, 1)

    def test_candidate_only_directory_without_candidate_file_fails(self):
        config = self.project(candidate_only=True)
        config["inventory"]["candidatesPath"] = None
        with self.assertRaisesRegex(ContractError, "unexpected directories.*component-a"):
            validate(config)

    def test_config_requires_nullable_absolute_candidate_path_and_existing_file(self):
        config = make_project(self.root)
        for value in ("relative.json", 5, [], {}):
            with self.subTest(value=value):
                config["inventory"]["candidatesPath"] = value
                with self.assertRaisesRegex(ContractError, "inventory.candidatesPath must be an absolute path or null"):
                    validate_config(config)
        del config["inventory"]["candidatesPath"]
        with self.assertRaisesRegex(ContractError, "missing keys.*candidatesPath"):
            validate_config(config)
        config["inventory"]["candidatesPath"] = str(self.root / "missing.json")
        with self.assertRaisesRegex(ContractError, "candidates: configured file is missing:.*missing.json"):
            validate(config)

    def test_no_candidate_configuration_preserves_fitted_aggregate(self):
        config = make_project(self.root, [self.line])
        with patch("circuit_evidence.orchestrator.run_policy") as policy:
            validate(config)
        context = policy.call_args.args[0]
        self.assertEqual(context.candidates, [])
        self.assertEqual(context.fitted_aggregate, self.fitted)
        self.assertTrue(all(not items for items in context.candidate_aggregate.values()))

    def test_explicit_empty_candidate_file_and_null_fitted_candidate_id_pass(self):
        self.fitted["records"][0]["candidate_id"] = None
        config = make_project(self.root, [self.line], bundles={"component-a": self.fitted})
        config["inventory"]["candidatesPath"] = str(write_json(self.root / "candidates.json", {"schema_version": 1, "candidates": []}))
        self.assertEqual(validate(config).lines, 1)

    def test_record_requires_exactly_one_identity(self):
        for changes in ({"candidate_id": None}, {"candidate_id": ""}, {"candidate_id": []}, {"line_id": "line-a"}, {"line_id": 5}):
            with self.subTest(changes=changes):
                bundle = combined(self.fitted, copy.deepcopy(self.alternative))
                bundle["records"][1].update(changes)
                with self.assertRaisesRegex(ContractError, "rec-b: record must have exactly one identity"):
                    self.owner_bundles(bundle)
        bundle = combined(self.fitted, copy.deepcopy(self.alternative))
        for key in ("candidate_id", "line_id"):
            bundle = combined(self.fitted, copy.deepcopy(self.alternative))
            del bundle["records"][1][key]
            with self.subTest(missing=key), self.assertRaisesRegex(ContractError, "rec-b: record must have exactly one identity"):
                self.owner_bundles(bundle)

    def test_unknown_and_foreign_owner_candidate_ids_fail(self):
        for candidate_id in ("cand-missing", "cand-foreign"):
            with self.subTest(candidate_id=candidate_id):
                bundle = combined(self.fitted, copy.deepcopy(self.alternative))
                bundle["records"][1]["candidate_id"] = candidate_id
                entries = [self.entry]
                if candidate_id == "cand-foreign":
                    foreign = candidate(candidate_id=candidate_id, owner_skill="component-z", mpn="OTHER-300")
                    entries.append(foreign)
                    write_bundle(self.root / ".claude/skills/component-z", candidate_bundle(foreign, "z"))
                with self.assertRaisesRegex(ContractError, f"rec-b: unknown or foreign-owner candidate_id {candidate_id}"):
                    self.owner_bundles(bundle, entries=entries)

    def test_identity_parity_checks_all_keys(self):
        for key in ("mpn", "manufacturer", "lcsc", "package"):
            with self.subTest(key=key):
                bundle = combined(self.fitted, copy.deepcopy(self.alternative))
                bundle["records"][1][key] = "mismatch"
                with self.assertRaisesRegex(ContractError, f"cand-b: {key} differs from candidate inventory"):
                    self.owner_bundles(bundle)

    def test_exact_owner_parity_rejects_missing_and_duplicate_candidate_records(self):
        with self.assertRaisesRegex(ContractError, "exactly its assigned candidates"):
            self.owner_bundles(self.fitted)
        bundle = combined(self.fitted, self.alternative, candidate_bundle(self.entry, "duplicate"))
        with self.assertRaisesRegex(ContractError, "exactly its assigned candidates"):
            self.owner_bundles(bundle)

    def test_candidate_file_accepts_extras_and_optional_replacements(self):
        entry = candidate(replaces_line_ids=["line-a"], note="reviewed", dnp="not used")
        path = write_json(self.root / "candidates.json", {"schema_version": 1, "candidates": [entry], "note": "extra"})
        loaded = load_candidates(path)
        self.assertEqual(loaded, [entry])
        validate_candidates(loaded, [self.line])
        write_json(path, {"schema_version": 1, "candidates": []})
        self.assertEqual(load_candidates(path), [])

    def test_candidate_file_rejects_malformed_envelope(self):
        for data in ([], {}, {"schema_version": 2, "candidates": []}, {"schema_version": True, "candidates": []}, {"schema_version": 1, "candidates": {}}, {"schema_version": 1, "candidates": [None]}):
            with self.subTest(data=data):
                path = write_json(self.root / "candidates.json", data)
                with self.assertRaises(ContractError):
                    load_candidates(path)

    def test_candidate_fields_are_required_typed_and_nonblank(self):
        for key in self.entry:
            for value in (None, [], 1, *(() if key == "lcsc" else ("", "  "))):
                with self.subTest(key=key, value=value):
                    with self.assertRaises(ContractError):
                        validate_candidates([candidate(**{key: value})], [self.line])
            entry = candidate()
            del entry[key]
            with self.subTest(missing=key), self.assertRaisesRegex(ContractError, "missing keys"):
                validate_candidates([entry], [self.line])

    def test_invalid_id_placements_and_unresolved_replacements_fail(self):
        for changes, error in (
            ({"candidate_id": "bad id"}, "invalid candidate ID"),
            ({"placements": []}, "placements are forbidden"),
            ({"placements": None}, "placements are forbidden"),
            ({"replaces_line_ids": "line-a"}, "must be a list"),
            ({"replaces_line_ids": [None]}, "must be a list"),
            ({"replaces_line_ids": ["line-missing"]}, "unknown inventory line"),
        ):
            with self.subTest(changes=changes), self.assertRaisesRegex(ContractError, error):
                validate_candidates([candidate(**changes)], [self.line])

    def test_duplicate_ids_and_line_id_collisions_fail(self):
        with self.assertRaisesRegex(ContractError, "duplicate candidate_id"):
            validate_candidates([self.entry, self.entry], [self.line])
        with self.assertRaisesRegex(ContractError, "collides with an inventory line_id"):
            validate_candidates([candidate(candidate_id="line-a")], [self.line])

    def test_identity_collisions_include_casefolded_mpn_and_nonempty_lcsc(self):
        cases = [
            ([candidate(mpn="fit-100", manufacturer="FITTED MAKER")], "duplicate .*identity"),
            ([candidate(lcsc="C100")], "duplicate LCSC"),
            ([self.entry, candidate(candidate_id="cand-c", mpn="alt-200", manufacturer="ALTERNATE MAKER")], "duplicate .*identity"),
            ([candidate(lcsc="C200"), candidate(candidate_id="cand-c", mpn="ALT-300", lcsc="C200")], "duplicate LCSC"),
        ]
        for entries, error in cases:
            with self.subTest(entries=entries), self.assertRaisesRegex(ContractError, error):
                validate_candidates(entries, [self.line])
        validate_candidates([self.entry, candidate(candidate_id="cand-c", mpn="ALT-300")], [self.line])

    def test_cross_partition_interaction_records_rejected(self):
        bundle = combined(self.fitted, self.alternative)
        bundle["interactions"][0]["record_ids"].append("rec-b")
        bundle["records"][1]["interaction_ids"].append("int-a")
        with self.assertRaisesRegex(ContractError, "int-a: interaction crosses"):
            validate(self.project(bundle=bundle))

    def test_cross_partition_interaction_facts_rejected_even_without_record_reference(self):
        bundle = combined(self.fitted, self.alternative)
        bundle["interactions"][0]["fact_ids"].append("fact-b-pin")
        with self.assertRaisesRegex(ContractError, "int-a: interaction crosses"):
            partition_aggregate(bundle)

    def test_cross_partition_fact_dependency_rejected(self):
        bundle = combined(self.fitted, self.alternative)
        fitted_fact = next(fact for fact in bundle["facts"] if fact["fact_id"] == "fact-a-pin")
        candidate_fact = next(fact for fact in bundle["facts"] if fact["fact_id"] == "fact-b-pin")
        candidate_fact["value"] = 1
        fitted_fact.update(value=1, provenance="CALCULATED", depends_on=["fact-b-pin"], expression="fact_b_pin")
        with self.assertRaisesRegex(ContractError, "fact-a-pin: depends_on crosses"):
            validate(self.project(bundle=bundle))

    def test_cross_partition_subordinate_parent_rejected(self):
        bundle = combined(self.fitted, self.alternative)
        bundle["records"][1].update(kind="subordinate", parent_record_id="rec-a")
        with self.assertRaisesRegex(ContractError, "rec-b: subordinate parent crosses"):
            validate(self.project(bundle=bundle))

    def test_partition_rejects_dangling_references_instead_of_dropping_entities(self):
        for key, field, value, error in (
            ("sources", "record_id", "rec-missing", "unknown record"),
            ("facts", "depends_on", ["fact-missing"], "unknown fact"),
            ("records", "parent_record_id", "rec-missing", "unknown record"),
            ("interactions", "record_ids", ["rec-missing"], "unknown record"),
            ("interactions", "fact_ids", ["fact-missing"], "unknown fact"),
        ):
            bundle = copy.deepcopy(self.fitted)
            bundle[key][0][field] = value
            with self.subTest(key=key, field=field), self.assertRaisesRegex(ContractError, error):
                partition_aggregate(bundle)

    def test_same_partition_shared_interaction_dependency_and_parent_are_preserved(self):
        other = candidate_bundle(candidate(candidate_id="cand-c", mpn="ALT-300"), "c")
        bundle = combined(self.fitted, self.alternative, other)
        bundle["records"][2].update(kind="subordinate", parent_record_id="rec-b")
        bundle["facts"][-1]["depends_on"] = ["fact-b-pin"]
        bundle["interactions"][-1]["record_ids"].append("rec-b")
        bundle["interactions"][-1]["fact_ids"].append("fact-b-pin")
        before = copy.deepcopy(bundle)
        fitted, candidates = partition_aggregate(bundle)
        self.assertEqual(bundle, before)
        self.assertEqual(fitted, self.fitted)
        for key in bundle:
            self.assertEqual(candidates[key], bundle[key][len(fitted[key]):])


if __name__ == "__main__":
    unittest.main()
