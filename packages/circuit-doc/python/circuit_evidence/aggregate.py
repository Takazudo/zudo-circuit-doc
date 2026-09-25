"""Discover and validate every owner bundle under a project's bundles root."""

from __future__ import annotations

from pathlib import Path

from .bundle import BUNDLE_FILES, load_skill_bundle, validate_bundle
from .errors import require
from .routing import NO_ROUTING_POLICY
from .skillmd import frontmatter


def validate_owner_bundles(schema, inventory, bundles_root, *, owner_prefix="component-", reserved_dirs=(), routing=NO_ROUTING_POLICY):
    """Validate the owner bundles and return ``(aggregate, bundles_by_owner)``."""
    required = schema["required_skill_files"]
    owners = {line["owner_skill"] for line in inventory}
    bundles_root = Path(bundles_root)
    reserved = set(reserved_dirs)
    actual_component_dirs = {
        path.name for path in bundles_root.glob(f"{owner_prefix}*")
        if path.is_dir() and path.name not in reserved
    }
    require(actual_component_dirs == owners, f"owner skills: expected exact directories {sorted(owners)}, got {sorted(actual_component_dirs)}")
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
        validate_bundle(bundle, schema, routing)
        expected = {line["line_id"]: line for line in inventory if line["owner_skill"] == skill_dir.name}
        actual = {record["line_id"]: record for record in bundle["records"]}
        require(set(actual) == set(expected), f"{skill_dir.name}: local manifest does not own exactly its assigned inventory lines")
        for line_id, record in actual.items():
            line = expected[line_id]
            for key in ("mpn", "manufacturer", "lcsc", "package"):
                require(record[key] == line[key], f"{skill_dir.name}/{line_id}: {key} differs from inventory")
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
    actual_line_ids = [record["line_id"] for record in aggregate["records"]]
    require(len(actual_line_ids) == len(inventory) and set(actual_line_ids) == expected_line_ids, "owner skills: exact global inventory-record parity required")
    return aggregate, bundles_by_owner


def validate_local_skills(schema, inventory, bundles_root, *, owner_prefix="component-", reserved_dirs=(), routing=NO_ROUTING_POLICY):
    aggregate, _bundles = validate_owner_bundles(schema, inventory, bundles_root, owner_prefix=owner_prefix, reserved_dirs=reserved_dirs, routing=routing)
    return aggregate
