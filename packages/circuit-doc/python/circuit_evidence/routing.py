"""Direct routing: resolve a natural-language query to exactly one inventory line or record."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from .errors import load, require, required_keys

VENDOR_TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9+&.-]*", re.I)


@dataclass(frozen=True)
class RoutingPolicy:
    """Project inputs the resolver needs beyond the entries themselves.

    ``vendor_tokens`` come from the external-vendor-qualifiers file; ``board_names``
    are project qualifiers (e.g. ``board-p``) that must never read as vendor hints.
    """

    vendor_tokens: frozenset = field(default_factory=frozenset)
    board_names: frozenset = field(default_factory=frozenset)

    @classmethod
    def load(cls, vendor_qualifiers=None, board_names=()):
        tokens = external_vendor_tokens(vendor_qualifiers) if vendor_qualifiers is not None else set()
        return cls(frozenset(tokens), frozenset(name.casefold() for name in board_names))


NO_ROUTING_POLICY = RoutingPolicy()


def contains_alias(query, alias):
    return re.search(rf"(?<![A-Za-z0-9]){re.escape(alias)}(?![A-Za-z0-9])", query, re.I) is not None


def looks_like_vendor_hint(token, known_vendor_tokens, board_names=frozenset()):
    folded = token.casefold()
    if folded in board_names:
        return False
    return (
        folded in known_vendor_tokens
        or re.search(r"(?:corp|inc|ltd|semi|semiconductor|electronics?|vendor)$", folded) is not None
        or (any(char.isupper() for char in token[1:]) and any(char.islower() for char in token))
    )


def external_vendor_tokens(path):
    path = Path(path)
    require(path.is_file(), "routing: external-vendor-qualifiers.json is required")
    data = load(path)
    required_keys(data, ("schema_version", "vendor_names"), "external vendor qualifiers")
    names = data["vendor_names"]
    require(isinstance(names, list) and all(isinstance(name, str) and name.strip() for name in names), "routing: external vendor names must be nonblank")
    require(len({name.casefold() for name in names}) == len(names), "routing: duplicate external vendor name")
    return {
        token.casefold() for name in names
        for token in VENDOR_TOKEN.findall(name)
    }


def resolve_identities(query, entries, *, id_key, routing=NO_ROUTING_POLICY):
    lcsc_tokens = {token.upper() for token in re.findall(r"\bC\d+\b", query, re.I)}
    known_lcsc = {entry["lcsc"] for entry in entries}
    mentioned_lcsc = lcsc_tokens & known_lcsc
    unknown_lcsc = lcsc_tokens - known_lcsc
    mentioned_mpn = {entry["mpn"].casefold() for entry in entries if contains_alias(query, entry["mpn"])}
    mpn_matches = {entry[id_key] for entry in entries if entry["mpn"].casefold() in mentioned_mpn}
    lcsc_matches = {entry[id_key] for entry in entries if entry["lcsc"] in mentioned_lcsc}

    # Exact identifiers are resolved independently. Any conflict or unknown explicit
    # LCSC token fails closed instead of allowing one identifier to override another.
    if unknown_lcsc or len(mentioned_lcsc) > 1:
        return []
    # One MPN shared by several manufacturers (ADR-009): only a named manufacturer
    # may pick one of them; a bare or doubly-qualified MPN stays ambiguous.
    if len(mpn_matches) > 1:
        qualified = {entry[id_key] for entry in entries if entry[id_key] in mpn_matches and contains_alias(query, entry["manufacturer"])}
        if len(qualified) != 1:
            return []
        mpn_matches = qualified
    if lcsc_matches and mpn_matches and lcsc_matches != mpn_matches:
        return []
    candidates = lcsc_matches or mpn_matches
    if not candidates:
        return []

    known_vendor_tokens = {
        token.casefold() for item in entries
        for token in VENDOR_TOKEN.findall(item["manufacturer"])
    }
    known_vendor_tokens.update(routing.vendor_tokens)
    function_tokens = {
        token.casefold() for item in entries
        for token in VENDOR_TOKEN.findall(item["function"])
    }
    known_vendor_tokens -= function_tokens
    # Only vendor-like qualifiers use the prefix grammar. Ordinary verbs and
    # adjectives before an MPN remain valid natural-language routing prompts.
    for entry in entries:
        if entry[id_key] not in candidates or not contains_alias(query, entry["mpn"]):
            continue
        qualifier = re.search(rf"\b([A-Za-z][A-Za-z0-9+&.-]*)\s+{re.escape(entry['mpn'])}(?![A-Za-z0-9])", query, re.I)
        if qualifier and looks_like_vendor_hint(qualifier.group(1), known_vendor_tokens, routing.board_names):
            manufacturer_tokens = {
                token for item in entries if item[id_key] == entry[id_key]
                for token in VENDOR_TOKEN.findall(item["manufacturer"])
            }
            if qualifier.group(1).casefold() not in {token.casefold() for token in manufacturer_tokens}:
                return []
        suffix = re.search(rf"{re.escape(entry['mpn'])}(?![A-Za-z0-9])\s+(?:from|by)\s+([A-Za-z][A-Za-z0-9+&.-]*)", query, re.I)
        if suffix:
            manufacturer_tokens = {
                token for item in entries if item[id_key] == entry[id_key]
                for token in VENDOR_TOKEN.findall(item["manufacturer"])
            }
            if suffix.group(1).casefold() not in {token.casefold() for token in manufacturer_tokens}:
                return []

    # An explicit vendor immediately before an exact LCSC identifier is also a
    # binding claim. Reject a mismatched claim instead of silently accepting the
    # LCSC token alone; board names remain ordinary project qualifiers.
    for entry in entries:
        if entry[id_key] not in candidates or entry["lcsc"] not in mentioned_lcsc:
            continue
        qualifier = re.search(rf"\b([A-Za-z][A-Za-z0-9+&.-]*)\s+{re.escape(entry['lcsc'])}(?![A-Za-z0-9])", query, re.I)
        if qualifier and looks_like_vendor_hint(qualifier.group(1), known_vendor_tokens, routing.board_names):
            manufacturer_tokens = {
                token.casefold() for item in entries if item[id_key] == entry[id_key]
                for token in VENDOR_TOKEN.findall(item["manufacturer"])
            }
            if qualifier.group(1).casefold() not in manufacturer_tokens:
                return []

    # Manufacturer/function text narrows an exact identity; it never unions sibling
    # records or selects a record by a bare ambiguous alias.
    manufacturer_matches = {entry[id_key] for entry in entries if contains_alias(query, entry["manufacturer"])}
    function_matches = {entry[id_key] for entry in entries if contains_alias(query, entry["function"])}
    filtered = {
        entry[id_key] for entry in entries
        if entry[id_key] in candidates
        and (not manufacturer_matches or entry[id_key] in manufacturer_matches)
        and (not function_matches or entry[id_key] in function_matches)
    }
    return sorted(filtered)


def resolve(query, lines, routing=NO_ROUTING_POLICY):
    return resolve_identities(query, lines, id_key="line_id", routing=routing)


def resolve_bundle_route(query, routes, routing=NO_ROUTING_POLICY):
    entries = []
    for route in routes:
        for mpn in route["aliases"]["mpn"]:
            for lcsc in (route["aliases"]["lcsc"] or [""]):
                for manufacturer in route["aliases"]["manufacturer"]:
                    for function in route["aliases"]["function"]:
                        entries.append({"record_id": route["record_id"], "mpn": mpn, "lcsc": lcsc, "manufacturer": manufacturer, "function": function})
    return resolve_identities(query, entries, id_key="record_id", routing=routing)


def validate_routing(lines, fixtures, routing=NO_ROUTING_POLICY):
    """Every line routes directly; ``fixtures`` is the parsed direct-routing file, or None when not configured."""
    by_id = {line["line_id"]: line for line in lines}
    if fixtures is None:
        checks = [(line, None) for line in lines]
    else:
        cases = fixtures["cases"]
        require(len(cases) == len(lines) and {x["line_id"] for x in cases} == set(by_id), "routing: every inventory line needs one fixture")
        checks = [(by_id[case["line_id"]], case) for case in cases]
    mpn_counts = {}
    for line in lines:
        mpn_counts[line["mpn"].casefold()] = mpn_counts.get(line["mpn"].casefold(), 0) + 1
    for line, case in checks:
        if mpn_counts[line["mpn"].casefold()] > 1:
            # A shared MPN only routes with its manufacturer named (ADR-009).
            require(resolve(line["mpn"], lines, routing) == [], f"routing {line['line_id']}: shared MPN resolves without a manufacturer qualifier: {line['mpn']}")
            queries = (line["lcsc"], f"{line['manufacturer']} {line['mpn']}", f"{line['function']} {line['manufacturer']} {line['mpn']}")
        else:
            queries = (line["mpn"], line["lcsc"], f"{line['manufacturer']} {line['mpn']}", f"{line['function']} {line['mpn']}")
        for query in filter(None, queries):
            require(resolve(query, lines, routing) == [line["line_id"]], f"routing {line['line_id']}: positive query is not direct and unique: {query}")
        if case is not None:
            require(resolve(case["negative"], lines, routing) == [], f"routing {line['line_id']}: negative query unexpectedly resolves")
