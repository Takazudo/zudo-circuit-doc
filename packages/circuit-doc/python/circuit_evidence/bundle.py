"""Owner-bundle validation: records, parity, coverage, interactions, routes and pin maps."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from .errors import load, require, required_keys
from .facts import fact_blocks_domain, fact_evidence_available, fact_primary_trusted, validate_facts, validate_pass_trust
from .routing import NO_ROUTING_POLICY, resolve_bundle_route
from .sources import HEX64, validate_source

OPEN_UNAVAILABLE_CLAIM = re.compile(r"unavailable|lower-authority|UNSOURCED", re.I)
BUNDLE_FILES = {
    "records": ("manifest.json", "records"),
    "sources": ("sources.json", "sources"),
    "facts": ("facts.json", "facts"),
    "coverage": ("coverage.json", "coverage"),
    "routes": ("routing.json", "routes"),
    "interactions": ("interactions.json", "interactions"),
    "pin_maps": ("pin-map.json", "pin_maps"),
}


def validate_pin_maps(pin_maps):
    for mapping in pin_maps:
        required_keys(mapping, ("pin_map_id", "record_id", "symbol", "footprint", "pins", "reviewed_by"), "pin map")
        require(mapping["pins"], f"{mapping['pin_map_id']}: empty pin map")
        symbol_pins = [pin["symbol_pin"] for pin in mapping["pins"]]
        pads = [pin["footprint_pad"] for pin in mapping["pins"]]
        require(len(set(symbol_pins)) == len(symbol_pins), f"{mapping['pin_map_id']}: duplicate symbol pin")
        require(len(set(pads)) == len(pads), f"{mapping['pin_map_id']}: duplicate footprint pad")
        for pin in mapping["pins"]:
            required_keys(pin, ("symbol_pin", "name", "footprint_pad", "function"), mapping["pin_map_id"])


def validate_bundle(bundle, schema, routing=NO_ROUTING_POLICY):
    records, sources, facts = bundle["records"], bundle["sources"], bundle["facts"]
    coverage, routes = bundle["coverage"], bundle["routes"]
    interactions, pin_maps = bundle["interactions"], bundle["pin_maps"]
    for source in sources:
        validate_source(source, schema)
    validate_facts(facts, sources, schema)
    validate_pass_trust(facts, sources)
    validate_pin_maps(pin_maps)
    record_ids = {record["record_id"] for record in records}
    require(len(record_ids) == len(records), "duplicate record ID")
    records_by_id = {record["record_id"]: record for record in records}
    facts_by_id = {fact["fact_id"]: fact for fact in facts}
    sources_by_id = {source["source_id"]: source for source in sources}
    id_groups = {
        "source": [item["source_id"] for item in sources], "fact": [item["fact_id"] for item in facts],
        "interaction": [item["interaction_id"] for item in interactions], "coverage": [item["coverage_id"] for item in coverage],
        "route": [item["route_id"] for item in routes], "pin map": [item["pin_map_id"] for item in pin_maps],
    }
    for label, values in id_groups.items():
        require(len(set(values)) == len(values), f"duplicate {label} ID")
    for record in records:
        required_keys(record, schema["record_required"], record.get("record_id", "record"))
        require(record["kind"] in ("standalone", "subordinate"), f"{record['record_id']}: record kind")
        if record["kind"] == "subordinate":
            parent = records_by_id.get(record["parent_record_id"])
            require(parent is not None and parent["kind"] == "standalone", f"{record['record_id']}: subordinate parent must resolve to a standalone record in this bundle")
        else:
            require(record["parent_record_id"] is None, f"{record['record_id']}: standalone parent_record_id must be null")
        assigned_sources = {item["source_id"] for item in sources if item.get("record_id") == record["record_id"]}
        assigned_facts = {item["fact_id"] for item in facts if item.get("record_id") == record["record_id"]}
        assigned_interactions = {item["interaction_id"] for item in interactions if record["record_id"] in item.get("record_ids", [])}
        for key in ("source_ids", "fact_ids", "interaction_ids"):
            require(len(record[key]) == len(set(record[key])), f"{record['record_id']}: duplicate {key}")
        require(set(record["source_ids"]) == assigned_sources, f"{record['record_id']}: source ID parity/orphan failure")
        require(set(record["fact_ids"]) == assigned_facts, f"{record['record_id']}: fact ID parity/orphan failure")
        require(set(record["interaction_ids"]) == assigned_interactions, f"{record['record_id']}: interaction ID parity/orphan failure")
        manufacturer_facts = [fact for fact in facts if fact["record_id"] == record["record_id"] and fact["fact_id"].endswith("-manufacturer")]
        require(manufacturer_facts, f"{record['record_id']}: unsourced manufacturer fact")
        for fact in manufacturer_facts:
            require(fact["value"] == record["manufacturer"] and fact["provenance"] in ("PRIMARY-SPEC", "UNVERIFIED"), f"{record['record_id']}: manufacturer evidence invalid")
        record_coverage = [item for item in coverage if item.get("record_id") == record["record_id"]]
        require(record_coverage, f"{record['record_id']}: requires coverage")
        require(any(item.get("record_id") == record["record_id"] for item in routes), f"{record['record_id']}: requires routing fixture")
        require(any(item.get("record_id") == record["record_id"] for item in pin_maps), f"{record['record_id']}: requires pin map")
        domains = record["open_domains"]
        require(isinstance(domains, list) and all(isinstance(domain, str) and domain.strip() for domain in domains), f"{record['record_id']}: open_domains must be nonblank strings")
        require(len(domains) == len(set(domains)), f"{record['record_id']}: duplicate open domain")
        open_coverage = {item["domain"] for item in record_coverage if item.get("status") == "OPEN"}
        require(open_coverage == set(domains), f"{record['record_id']}: open domains and OPEN coverage must match exactly")
    for source in sources:
        require(source.get("record_id") in record_ids, f"{source['source_id']}: orphan source/unknown record ID")
    for fact in facts:
        require(fact["record_id"] in record_ids, f"{fact['fact_id']}: orphan fact/unknown record ID")
        source = next(item for item in sources if item["source_id"] == fact["source_id"])
        require(source["record_id"] == fact["record_id"], f"{fact['fact_id']}: source belongs to a different record")
        if fact["provenance"] == "DISTRIBUTOR-IDENTITY":
            record = records_by_id[fact["record_id"]]
            require(isinstance(fact["value"], dict) and set(fact["value"]) == {"lcsc", "manufacturer", "mpn", "variant"}, f"{fact['fact_id']}: distributor identity value must use exact structured identity keys")
            require(fact["value"]["lcsc"] == record["lcsc"] and fact["value"]["manufacturer"] == record["manufacturer"] and fact["value"]["mpn"] == record["mpn"], f"{fact['fact_id']}: distributor identity differs from owning record")
            require(isinstance(fact["value"]["variant"], str) and fact["value"]["variant"].strip() and fact["unit"] == "NONE" and not fact["depends_on"] and not fact["expression"], f"{fact['fact_id']}: invalid distributor identity variant/units/dependencies")
            extract_hash = source.get("identity_extract_sha256", "")
            actual_extract_hash = hashlib.sha256(json.dumps(fact["value"], sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            require(HEX64.fullmatch(extract_hash) and extract_hash == actual_extract_hash, f"{fact['fact_id']}: canonical distributor identity extract hash changed")
        if fact["provenance"] == "PRIMARY-SPEC":
            require(source["authority_class"] == "MANUFACTURER_PRIMARY", f"{fact['fact_id']}: primary provenance needs manufacturer primary source")
    for item in coverage:
        required_keys(item, schema["coverage_required"], "coverage")
        require(item["status"] in ("COVERED", "OPEN"), f"{item['coverage_id']}: unexplained coverage gap")
        require(isinstance(item["reason"], str) and item["reason"].strip(), f"{item['coverage_id']}: coverage reason")
        require(item["record_id"] in record_ids, f"{item['coverage_id']}: orphan coverage/unknown record ID")
        require(isinstance(item["fact_ids"], list) and len(item["fact_ids"]) == len(set(item["fact_ids"])), f"{item['coverage_id']}: fact_ids must be a unique list")
        require(set(item["fact_ids"]) <= set(facts_by_id), f"{item['coverage_id']}: unknown coverage fact ID")
        require(all(facts_by_id[fact_id]["record_id"] == item["record_id"] for fact_id in item["fact_ids"]), f"{item['coverage_id']}: coverage fact belongs to another record")
        require(isinstance(item["blocking_fact_ids"], list) and len(item["blocking_fact_ids"]) == len(set(item["blocking_fact_ids"])), f"{item['coverage_id']}: blocking_fact_ids must be a unique list")
        require(set(item["blocking_fact_ids"]) <= set(item["fact_ids"]), f"{item['coverage_id']}: blocking_fact_ids must be a subset of fact_ids")
        if item["status"] == "COVERED":
            require(item["fact_ids"], f"{item['coverage_id']}: COVERED domain requires explicit fact IDs")
            require(all(fact_evidence_available(fact_id, facts_by_id, sources_by_id) for fact_id in item["fact_ids"]), f"{item['coverage_id']}: COVERED domain depends on unavailable or UNSOURCED evidence")
        if item["status"] == "OPEN":
            for fact_id in item["blocking_fact_ids"]:
                require(fact_blocks_domain(fact_id, facts_by_id, sources_by_id), f"{item['coverage_id']}: blocking fact {fact_id} does not carry a blocking verdict")
            unnamed = [fact_id for fact_id in item["fact_ids"] if fact_blocks_domain(fact_id, facts_by_id, sources_by_id)]
            require(item["blocking_fact_ids"] or not unnamed, f"{item['coverage_id']}: OPEN entry cites blocking-verdict facts {sorted(unnamed)} but blocking_fact_ids is empty")
            if OPEN_UNAVAILABLE_CLAIM.search(item["reason"]):
                require(item["blocking_fact_ids"], f"{item['coverage_id']}: OPEN reason claims unavailable/lower-authority/UNSOURCED evidence but blocking_fact_ids is empty")
    for interaction in interactions:
        required_keys(interaction, schema["interaction_required"], "interaction")
        require(interaction["verdict"] in schema["verdicts"] and interaction["verdict"] != "CONFIRMED - distributor identity only", f"{interaction['interaction_id']}: verdict")
        require(interaction["record_ids"] and set(interaction["record_ids"]) <= record_ids, f"{interaction['interaction_id']}: orphan interaction/unknown record ID")
        require(set(interaction["fact_ids"]) <= {fact["fact_id"] for fact in facts}, f"{interaction['interaction_id']}: unknown fact ID")
        fact_record_ids = {fact["record_id"] for fact in facts if fact["fact_id"] in interaction["fact_ids"]}
        require(fact_record_ids <= set(interaction["record_ids"]), f"{interaction['interaction_id']}: fact belongs to an unlisted record")
        if interaction["verdict"] in ("PASS - primary-source confirmed", "BLOCKER - deterministic spec violation"):
            require(interaction["fact_ids"] and all(fact_primary_trusted(fact_id, facts_by_id, sources_by_id) for fact_id in interaction["fact_ids"]), f"{interaction['interaction_id']}: PASS/BLOCKER interaction is not trust-closed")
    for route in routes:
        required_keys(route, ("route_id", "record_id", "aliases", "positive", "negative"), "route")
        require(set(route["aliases"]) == {"mpn", "lcsc", "manufacturer", "function"}, f"{route['route_id']}: routing alias classes")
        require(all(route["aliases"][key] for key in ("mpn", "manufacturer", "function")), f"{route['route_id']}: blank routing aliases")
        require(route["positive"] and route["negative"], f"{route['route_id']}: positive/negative routing fixtures")
        require(route["record_id"] in record_ids, f"{route['route_id']}: orphan route/unknown record ID")
        record = records_by_id[route["record_id"]]
        require(record["mpn"] in route["aliases"]["mpn"] and (record["lcsc"] in route["aliases"]["lcsc"] if record["lcsc"] else route["aliases"]["lcsc"] == []) and record["manufacturer"] in route["aliases"]["manufacturer"], f"{route['route_id']}: exact identity aliases missing")
        for query in route["positive"]:
            require(resolve_bundle_route(query, routes, routing) == [route["record_id"]], f"{route['route_id']}: positive query does not resolve uniquely to its record: {query}")
        for mpn in route["aliases"]["mpn"]:
            require(resolve_bundle_route(mpn, routes, routing) == [route["record_id"]], f"{route['route_id']}: declared MPN alias does not route")
            for alias_class in ("manufacturer", "function"):
                for alias in route["aliases"][alias_class]:
                    require(resolve_bundle_route(f"{alias} {mpn}", routes, routing) == [route["record_id"]], f"{route['route_id']}: declared {alias_class} alias does not route: {alias}")
        for lcsc in route["aliases"]["lcsc"]:
            require(resolve_bundle_route(lcsc, routes, routing) == [route["record_id"]], f"{route['route_id']}: declared LCSC alias does not route")
        for query in route["negative"]:
            require(resolve_bundle_route(query, routes, routing) == [], f"{route['route_id']}: negative query unexpectedly resolves: {query}")
    for mapping in pin_maps:
        require(mapping["record_id"] in record_ids, f"{mapping['pin_map_id']}: orphan pin map/unknown record ID")
    require({mapping["record_id"] for mapping in pin_maps} == record_ids, "pin maps: exact record coverage parity required")


def load_skill_bundle(skill_dir):
    skill_dir = Path(skill_dir)
    return {key: load(skill_dir / filename)[field] for key, (filename, field) in BUNDLE_FILES.items()}


def canonical_pin_map(mapping):
    payload = {
        "record_id": mapping["record_id"],
        "pin_map_id": mapping["pin_map_id"],
        "symbol": mapping["symbol"],
        "footprint": mapping["footprint"],
        "pins": sorted(
            ({key: pin[key] for key in ("symbol_pin", "name", "footprint_pad", "function")} for pin in mapping["pins"]),
            key=lambda pin: (pin["symbol_pin"], pin["footprint_pad"]),
        ),
    }
    if mapping.get("mounting") == "external":
        payload["mounting"] = "external"
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
