"""Discover and validate every owner bundle under a project's bundles root."""

from __future__ import annotations

from pathlib import Path

from .bundle import BUNDLE_FILES, load_skill_bundle, validate_bundle
from .errors import ContractError, require
from .inventory.candidates import validate_candidates
from .inventory.common import PARITY_KEYS
from .routing import NO_ROUTING_POLICY
from .skillmd import frontmatter
from .template import check_placeholder_leak


def _owner_directory_mismatch_message(owners, actual_component_dirs, bundles_root):
    """Report the set difference, plus (best effort) any placeholder leak already
    sitting in an unexpected directory.

    ``new-component`` copies a fresh bundle straight from the template, so right after
    it runs the new directory both fails this owner-set check and still carries the
    template's example values. Surfacing the placeholder leak in the same message saves
    a second `validate` round trip once the directory is registered in the inventory.
    """
    unexpected = sorted(actual_component_dirs - owners)
    missing = sorted(owners - actual_component_dirs)
    detail = []
    if unexpected:
        detail.append(f"unexpected directories with no inventory owner: {unexpected}")
    if missing:
        detail.append(f"missing directories for inventory owners: {missing}")
    message = f"owner skills: expected exact directories {sorted(owners)}, got {sorted(actual_component_dirs)} ({'; '.join(detail)})"
    placeholder_notes = []
    for name in unexpected:
        try:
            bundle = load_skill_bundle(bundles_root / name)
            check_placeholder_leak({name: bundle})
        except ContractError as exc:
            placeholder_notes.append(str(exc))
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            continue
    if placeholder_notes:
        message += "; also in this run: " + "; ".join(placeholder_notes)
    return message


def validate_owner_bundles(schema, inventory, bundles_root, *, candidates=(), owner_prefix="component-", reserved_dirs=(), routing=NO_ROUTING_POLICY):
    """Validate the owner bundles and return ``(aggregate, bundles_by_owner)``."""
    validate_candidates(candidates, inventory)
    required = schema["required_skill_files"]
    owners = {item["owner_skill"] for item in (*inventory, *candidates)}
    bundles_root = Path(bundles_root)
    reserved = set(reserved_dirs)
    actual_component_dirs = {
        path.name for path in bundles_root.glob(f"{owner_prefix}*")
        if path.is_dir() and path.name not in reserved
    }
    if actual_component_dirs != owners:
        raise ContractError(_owner_directory_mismatch_message(owners, actual_component_dirs, bundles_root))
    global_ids = {label: set() for label in ("record", "source", "fact", "interaction")}
    aggregate = {key: [] for key in BUNDLE_FILES}
    bundles_by_owner = {}
    for owner in sorted(owners):
        skill_dir = bundles_root / owner
        missing = [name for name in required if not (skill_dir / name).is_file()]
        require(not missing, f"{skill_dir.name}: missing local manifest files {missing}")
        frontmatter(skill_dir / "SKILL.md", skill_dir.name)
        require(skill_dir.name in owners, f"{skill_dir.name}: no central owner assignment")
        bundle = load_skill_bundle(skill_dir)
        expected_lines = {line["line_id"]: line for line in inventory if line["owner_skill"] == owner}
        expected_candidates = {item["candidate_id"]: item for item in candidates if item["owner_skill"] == owner}
        actual_lines, actual_candidates = [], []
        for record in bundle["records"]:
            partition = _record_partition(record)
            identity_key = "line_id" if partition == 0 else "candidate_id"
            identity = record[identity_key]
            expected = expected_lines if partition == 0 else expected_candidates
            require(identity in expected, f"{owner}/{record.get('record_id', 'record')}: unknown or foreign-owner {identity_key} {identity}")
            (actual_lines if partition == 0 else actual_candidates).append(identity)
            for key in PARITY_KEYS:
                require(record.get(key) == expected[identity][key], f"{owner}/{identity}: {key} differs from {'inventory' if partition == 0 else 'candidate inventory'}")
        require(len(actual_lines) == len(expected_lines) and set(actual_lines) == set(expected_lines), f"{owner}: local manifest does not own exactly its assigned inventory lines")
        require(len(actual_candidates) == len(expected_candidates) and set(actual_candidates) == set(expected_candidates), f"{owner}: local manifest does not own exactly its assigned candidates")
        validate_bundle(bundle, schema, routing)
        current = {
            "record": {item["record_id"] for item in bundle["records"]},
            "source": {item["source_id"] for item in bundle["sources"]},
            "fact": {item["fact_id"] for item in bundle["facts"]},
            "interaction": {item["interaction_id"] for item in bundle["interactions"]},
        }
        for label, values in current.items():
            require(not (values & global_ids[label]), f"{skill_dir.name}: duplicate global {label} IDs")
            global_ids[label].update(values)
        for key in aggregate:
            aggregate[key].extend(bundle[key])
        bundles_by_owner[owner] = bundle
    expected_line_ids = {line["line_id"] for line in inventory}
    actual_line_ids = [record["line_id"] for record in aggregate["records"] if record["line_id"] is not None]
    require(len(actual_line_ids) == len(inventory) and set(actual_line_ids) == expected_line_ids, "owner skills: exact global inventory-record parity required")
    actual_candidate_ids = [record["candidate_id"] for record in aggregate["records"] if record["line_id"] is None]
    require(len(actual_candidate_ids) == len(candidates) and set(actual_candidate_ids) == {item["candidate_id"] for item in candidates}, "owner skills: exact global candidate-record parity required")
    return aggregate, bundles_by_owner


def validate_local_skills(schema, inventory, bundles_root, *, candidates=(), owner_prefix="component-", reserved_dirs=(), routing=NO_ROUTING_POLICY):
    aggregate, _bundles = validate_owner_bundles(schema, inventory, bundles_root, candidates=candidates, owner_prefix=owner_prefix, reserved_dirs=reserved_dirs, routing=routing)
    return aggregate


def _record_partition(record):
    """Return 0 for an inventory record and 1 for a candidate; reject ambiguity."""
    label = record.get("record_id", "record")
    line_id, candidate_id = record.get("line_id"), record.get("candidate_id")
    if isinstance(line_id, str) and candidate_id is None:
        return 0
    if "line_id" in record and line_id is None and isinstance(candidate_id, str) and candidate_id:
        return 1
    require(False, f"{label}: record must have exactly one identity; record has line_id {line_id!r} and no valid candidate identity (candidate_id={candidate_id!r})")


def partition_aggregate(aggregate):
    """Split a validated aggregate without silently dropping crossing references."""
    partitions = ({key: [] for key in aggregate}, {key: [] for key in aggregate})
    record_partitions = {record["record_id"]: _record_partition(record) for record in aggregate["records"]}

    def record_partition(record_id, label):
        require(record_id in record_partitions, f"{label}: unknown record {record_id}")
        return record_partitions[record_id]

    fact_partitions = {fact["fact_id"]: record_partition(fact["record_id"], fact["fact_id"]) for fact in aggregate["facts"]}

    def fact_partition(fact_id, label):
        require(fact_id in fact_partitions, f"{label}: unknown fact {fact_id}")
        return fact_partitions[fact_id]

    for record in aggregate["records"]:
        parent = record.get("parent_record_id")
        if parent is not None:
            require(record_partition(parent, record["record_id"]) == record_partitions[record["record_id"]], f"{record['record_id']}: subordinate parent crosses fitted/candidate partitions")
    for fact in aggregate["facts"]:
        for dependency in fact.get("depends_on", []):
            require(fact_partition(dependency, fact["fact_id"]) == fact_partitions[fact["fact_id"]], f"{fact['fact_id']}: depends_on crosses fitted/candidate partitions")
    for key, items in aggregate.items():
        for item in items:
            if key == "interactions":
                label = item["interaction_id"]
                sides = {record_partition(record_id, label) for record_id in item["record_ids"]}
                sides.update(fact_partition(fact_id, label) for fact_id in item["fact_ids"])
                require(len(sides) == 1 and item["record_ids"], f"{label}: interaction crosses fitted/candidate partitions or has no owning record")
                side = next(iter(sides))
            else:
                side = record_partition(item["record_id"], key)
            partitions[side][key].append(item)
    return partitions
