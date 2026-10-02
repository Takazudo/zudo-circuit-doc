"""Audited alternatives with their own identities and no fitted placements."""

from __future__ import annotations

from pathlib import Path

from ..errors import load, require, required_keys
from ..sources import ID

CANDIDATE_KEYS = ("candidate_id", "owner_skill", "mpn", "manufacturer", "lcsc", "package", "function")


def _validate_shape(candidates):
    require(isinstance(candidates, (list, tuple)), "candidates: must be a list")
    seen = set()
    for candidate in candidates:
        require(isinstance(candidate, dict), "candidate: must be an object")
        label = candidate.get("candidate_id", "candidate")
        required_keys(candidate, CANDIDATE_KEYS, label)
        for key in CANDIDATE_KEYS:
            value = candidate[key]
            require(isinstance(value, str) and (key == "lcsc" or value.strip()), f"{label}: {key} must be a {'string' if key == 'lcsc' else 'nonblank string'}")
        candidate_id = candidate["candidate_id"]
        require(ID.fullmatch(candidate_id), f"{candidate_id}: invalid candidate ID")
        require(candidate_id not in seen, f"{candidate_id}: duplicate candidate_id")
        seen.add(candidate_id)
        require("placements" not in candidate, f"{candidate_id}: placements are forbidden for candidates")
        if "replaces_line_ids" in candidate:
            replaces = candidate["replaces_line_ids"]
            require(isinstance(replaces, list) and all(isinstance(item, str) and ID.fullmatch(item) for item in replaces), f"{candidate_id}: replaces_line_ids must be a list of inventory line IDs")


def load_candidates(path):
    """Read and shape-check a v1 candidate file; return its candidate entries."""
    path = Path(path)
    require(path.is_file(), f"candidates: configured file is missing: {path}")
    data = load(path)
    require(isinstance(data, dict), "candidates: top level must be an object")
    required_keys(data, ("schema_version", "candidates"), "candidates")
    require(type(data["schema_version"]) is int and data["schema_version"] == 1, "candidates: unsupported schema_version (expected 1)")
    require(isinstance(data["candidates"], list), "candidates: must be a list")
    _validate_shape(data["candidates"])
    return data["candidates"]


def validate_candidates(candidates, lines):
    """Require unique identities and resolvable replacement links to inventory lines."""
    _validate_shape(candidates)
    line_ids = {line["line_id"] for line in lines}
    identities = {(line["manufacturer"].casefold(), line["mpn"].casefold()) for line in lines}
    lcsc_values = {line["lcsc"] for line in lines if line["lcsc"]}
    for candidate in candidates:
        candidate_id = candidate["candidate_id"]
        require(candidate_id not in line_ids, f"{candidate_id}: candidate_id collides with an inventory line_id")
        for line_id in candidate.get("replaces_line_ids", []):
            require(line_id in line_ids, f"{candidate_id}: replaces_line_ids references unknown inventory line {line_id}")
        identity = (candidate["manufacturer"].casefold(), candidate["mpn"].casefold())
        require(identity not in identities, f"{candidate_id}: duplicate (manufacturer, mpn) identity owned by an inventory line or another candidate")
        identities.add(identity)
        lcsc = candidate["lcsc"]
        if lcsc:
            require(lcsc not in lcsc_values, f"{candidate_id}: duplicate LCSC ownership by an inventory line or another candidate")
            lcsc_values.add(lcsc)
