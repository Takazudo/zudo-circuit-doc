"""Inventory checks every provider shares: file shape, enums, counts and owner-bundle parity."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from ..errors import load, require, required_keys
from ..facts import fact_primary_trusted
from ..sources import ID

INVENTORY_KEYS = ("schema_version", "generator_specs", "assertions", "exclusions", "lines")
ASSERTION_KEYS = ("orderable_lines", "fitted_lines", "dnp_or_hand_fit_lines")
PLACEMENT_ASSERTION_KEYS = ("fitted_placements", "dnp_placements")
LINE_KEYS = ("line_id", "mpn", "manufacturer", "lcsc", "package", "dnp", "owner_skill", "identity_state", "source_state", "function", "placements")
IDENTITY_STATES = ("VERIFIED", "UNRESOLVED")
SOURCE_STATES = ("AVAILABLE", "SOURCE UNAVAILABLE")
MOUNTINGS = ("pcb", "external")
PARITY_KEYS = ("mpn", "manufacturer", "lcsc", "package")


@dataclass
class ProviderResult:
    """What an inventory provider hands the rest of the run.

    ``placements`` is a flat list of ``{line_id, board, refdes, dnp}``; ``scope_lines`` and
    ``warnings`` are printed without their ``SCOPE:`` / ``WARN:`` prefix.
    """

    lines: list
    placements: list
    scope_lines: list = field(default_factory=list)
    warnings: list = field(default_factory=list)


class InventoryProvider:
    """Base for ``inventory.provider.kind`` implementations; ``options`` is that config object."""

    kind = ""
    placement_fit = False

    def __init__(self, options):
        self.options = options

    def board_names(self, inventory):
        """Project qualifiers routing must never read as vendor hints."""
        return placement_boards(inventory["lines"])

    def seeded_cases(self):
        """``(extra_cases, extra_bases)`` appended to the packaged seeded self-test."""
        return (), None

    def validate(self, inventory, aggregate, config):
        raise NotImplementedError

    def extra_pin_asset_checks(self, provider_result, aggregate):
        """Provider-specific pin-asset checks, run after the generic ones when CAD is enabled."""


def load_inventory(path, *, placement_fit=False):
    path = Path(path)
    require(path.is_file(), f"inventory: configured file is missing: {path}")
    data = load(path)
    validate_inventory_shape(data, placement_fit=placement_fit)
    return data


def validate_inventory_shape(data, *, placement_fit=False):
    require(isinstance(data, dict), "inventory: top level must be an object")
    required_keys(data, INVENTORY_KEYS, "inventory")
    assertions = data["assertions"]
    require(isinstance(assertions, dict), "inventory assertions: must be an object")
    required_keys(assertions, ASSERTION_KEYS, "inventory assertions")
    count_keys = ASSERTION_KEYS + tuple(key for key in PLACEMENT_ASSERTION_KEYS if key in assertions)
    require(all(isinstance(assertions[key], int) and not isinstance(assertions[key], bool) and assertions[key] >= 0 for key in count_keys), "inventory assertions: counts must be non-negative integers")
    for key in ("generator_specs", "exclusions", "lines"):
        require(isinstance(data[key], list), f"inventory: {key} must be a list")
    for line in data["lines"]:
        validate_line_shape(line, placement_fit=placement_fit)
    line_ids = [line["line_id"] for line in data["lines"]]
    require(len(set(line_ids)) == len(line_ids), "inventory: duplicate line_id ownership")


def validate_line_shape(line, *, placement_fit=False):
    require(isinstance(line, dict), "inventory line: must be an object")
    context = line.get("line_id", "line") if isinstance(line.get("line_id"), str) else "line"
    required_keys(line, tuple(key for key in LINE_KEYS if key != "dnp") if placement_fit else LINE_KEYS, context)
    require(all(isinstance(line[key], str) and line[key].strip() for key in ("line_id", "mpn", "manufacturer", "package", "owner_skill", "function")), f"{context}: blank identity field")
    require(ID.fullmatch(line["line_id"]), f"{line['line_id']}: invalid line ID")
    require(isinstance(line["lcsc"], str), f"{line['line_id']}: lcsc must be a string")
    if "dnp" in line:
        require(isinstance(line["dnp"], bool), f"{line['line_id']}: dnp must be a boolean")
    require(line["source_state"] in SOURCE_STATES, f"{line['line_id']}: source availability state")
    require(line["identity_state"] in IDENTITY_STATES, f"{line['line_id']}: identity state")
    require(line.get("mounting", "pcb") in MOUNTINGS, f"{line['line_id']}: unknown mounting")
    require(isinstance(line["placements"], list), f"{line['line_id']}: placements must be a list")
    if not line["placements"]:
        required_keys(line, ("dnp",), context)
    for placement in line["placements"]:
        require(isinstance(placement, dict), f"{line['line_id']}: placement must be an object")
        required_keys(placement, ("board", "refdes", "dnp") if placement_fit else ("board", "refdes"), f"{line['line_id']} placement")
        require(all(isinstance(placement[key], str) and placement[key].strip() for key in ("board", "refdes")), f"{line['line_id']}: blank placement board/refdes")
        if "dnp" in placement:
            require(isinstance(placement["dnp"], bool), f"{line['line_id']}: placement dnp must be a boolean")
            require("dnp" not in line or placement["dnp"] == line["dnp"], f"{line['line_id']}: conflicting line/placement dnp")


def effective_fit(line, placement):
    """The placement's DNP bit, falling back to its line's declaration."""
    return placement["dnp"] if "dnp" in placement else line["dnp"]


def line_fit(line):
    """All effective placement DNP bits, or the unplaced line's declared bit."""
    return [effective_fit(line, item) for item in line["placements"]] or [line["dnp"]]


def validate_counts(data, *, placement_fit=False):
    lines, assertions = data["lines"], data["assertions"]
    require(len(lines) == assertions["orderable_lines"], "inventory: orderable line count differs from reviewed assertion")
    fitted_lines = sum(any(not bit for bit in line_fit(line)) for line in lines) if placement_fit else sum(not line["dnp"] for line in lines)
    dnp_lines = sum(any(line_fit(line)) for line in lines) if placement_fit else sum(line["dnp"] for line in lines)
    require(fitted_lines == assertions["fitted_lines"], "inventory: fitted line count differs from reviewed assertion")
    require(dnp_lines == assertions["dnp_or_hand_fit_lines"], "inventory: DNP/hand-fit line count differs from reviewed assertion")
    for key, dnp in (("fitted_placements", False), ("dnp_placements", True)):
        if key in assertions:
            count = assertions[key]
            require(isinstance(count, int) and not isinstance(count, bool) and count >= 0, "inventory assertions: counts must be non-negative integers")
            actual = sum(effective_fit(line, item) == dnp for line in lines for item in line["placements"])
            require(actual == count, f"inventory: {key} count differs from reviewed assertion")


def validate_owner_parity(lines, aggregate):
    """Each owner-bundle record carries exactly its inventory line's identity."""
    lines_by_id = {line["line_id"]: line for line in lines}
    for record in aggregate["records"]:
        line = lines_by_id.get(record["line_id"])
        require(line is not None, f"{record['record_id']}: record line {record['line_id']} is not in the inventory")
        for key in PARITY_KEYS:
            require(record[key] == line[key], f"{line['owner_skill']}/{line['line_id']}: {key} differs from inventory")


def placements(lines):
    return [{"line_id": line["line_id"], "board": item["board"], "refdes": item["refdes"], "dnp": effective_fit(line, item)} for line in lines for item in line["placements"]]


def placement_boards(lines):
    return sorted({item["board"] for line in lines for item in line["placements"]})


def evidence_states(line, aggregate):
    """The (identity_state, source_state) a line's owner-bundle evidence supports.

    Sources: AVAILABLE only when the line has sources and every one is AVAILABLE.
    Identity: VERIFIED only when every record's manufacturer fact is primary-trusted.
    """
    record_ids = {record["record_id"] for record in aggregate["records"] if record["line_id"] == line["line_id"]}
    sources = [source for source in aggregate["sources"] if source.get("record_id") in record_ids]
    source_state = "AVAILABLE" if sources and all(source["availability"] == "AVAILABLE" for source in sources) else "SOURCE UNAVAILABLE"
    facts_by_id = {fact["fact_id"]: fact for fact in aggregate["facts"]}
    sources_by_id = {source["source_id"]: source for source in aggregate["sources"]}
    verified = bool(record_ids) and all(
        any(
            fact["record_id"] == record_id and fact["fact_id"].endswith("-manufacturer") and fact_primary_trusted(fact["fact_id"], facts_by_id, sources_by_id)
            for fact in aggregate["facts"]
        )
        for record_id in record_ids
    )
    return ("VERIFIED" if verified else "UNRESOLVED"), source_state


def summary_lag_warnings(lines, aggregate):
    warnings = []
    for line in lines:
        identity_state, source_state = evidence_states(line, aggregate)
        lags = []
        if line["identity_state"] != identity_state:
            lags.append(f"identity_state {line['identity_state']} but evidence supports {identity_state}")
        if line["source_state"] != source_state:
            lags.append(f"source_state {line['source_state']} but evidence supports {source_state}")
        if lags:
            warnings.append(f"inventory summary for {line['line_id']} lags evidence: {'; '.join(lags)}")
    return warnings
