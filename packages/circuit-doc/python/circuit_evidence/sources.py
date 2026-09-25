"""Source-lock validation and the opt-in online hash refresh."""

from __future__ import annotations

import hashlib
import re
import tempfile
import urllib.request
from pathlib import Path

from .errors import require, required_keys

HEX64 = re.compile(r"^[0-9a-f]{64}$")
ID = re.compile(r"^[a-z][a-z0-9-]*$")
LOCATOR_DETAIL = re.compile(r"(section|table|figure|row|pin|title block|calculated)", re.I)
ZERO_SHA256 = "0" * 64
HTTP_TIMEOUT_SECONDS = 20
HTTP_ACCEPT = "application/pdf,text/plain,text/html;q=0.9,*/*;q=0.8"


def http_headers(user_agent):
    return {
        "User-Agent": f"Mozilla/5.0 (compatible; {user_agent})",
        "Accept": HTTP_ACCEPT,
    }


def validate_source(source, schema):
    required_keys(source, schema["source_required"], source.get("source_id", "source"))
    require(ID.fullmatch(source["source_id"]), f"{source['source_id']}: invalid source ID")
    require(source["availability"] in schema["source_availability"], f"{source['source_id']}: invalid availability")
    require(source["authority_class"] in schema["authority_classes"], f"{source['source_id']}: authority class")
    require(HEX64.fullmatch(source["sha256"]), f"{source['source_id']}: SHA-256 must be 64 lowercase hex digits")
    if source["availability"] == "AVAILABLE":
        require(source["sha256"] != ZERO_SHA256, f"{source['source_id']}: AVAILABLE source cannot use all-zero SHA-256 sentinel")
    else:
        require(source["sha256"] == ZERO_SHA256, f"{source['source_id']}: SOURCE UNAVAILABLE must use all-zero SHA-256 sentinel")
    require(isinstance(source["physical_pdf_page_index"], int) and source["physical_pdf_page_index"] >= 0, f"{source['source_id']}: PDF page index")
    for key in ("document_title", "document_number", "revision", "document_date", "authoritative_url", "retrieval_date", "printed_page_label", "locator", "evidence_extract"):
        require(isinstance(source[key], str) and source[key].strip(), f"{source['source_id']}: blank {key}")
    request_headers = source.get("request_headers", {})
    require(isinstance(request_headers, dict) and set(request_headers) <= {"Referer"}, f"{source['source_id']}: only a per-source Referer header is allowed")
    require(all(isinstance(value, str) and value.startswith("https://") for value in request_headers.values()), f"{source['source_id']}: invalid per-source request header")
    refresh_policy = source.get("refresh_policy", "HASH-LOCKED")
    require(refresh_policy in ("HASH-LOCKED", "VOLATILE-HTML"), f"{source['source_id']}: invalid refresh policy")
    if refresh_policy == "VOLATILE-HTML":
        require(isinstance(source.get("refresh_note"), str) and "not deterministic" in source["refresh_note"], f"{source['source_id']}: volatile refresh needs an explicit note")
        require(source["availability"] == "AVAILABLE" and source["authority_class"] == "DISTRIBUTOR_IDENTITY" and HEX64.fullmatch(source.get("identity_extract_sha256", "")), f"{source['source_id']}: volatile refresh is limited to canonical distributor identity web evidence")
    require(LOCATOR_DETAIL.search(source["locator"]), f"{source['source_id']}: locator lacks section/table/figure/row detail")


def store_and_verify(payload, target, expected_sha256, source_id):
    target = Path(target)
    target.write_bytes(payload)
    try:
        require(hashlib.sha256(payload).hexdigest() == expected_sha256, f"{source_id}: stale online hash")
    finally:
        target.unlink(missing_ok=True)


def fetch_source(source, opener=urllib.request.urlopen, *, user_agent):
    request = urllib.request.Request(source["authoritative_url"], headers={**http_headers(user_agent), **source.get("request_headers", {})})
    with opener(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
        return response.read()


def online_sources(schema, sources, selected_ids=None, opener=urllib.request.urlopen, *, temp_root, user_agent, skip_volatile=False):
    """Re-download and hash-check sources; retained evidence is never modified.

    With no ``selected_ids`` every AVAILABLE source is refreshed. ``skip_volatile``
    leaves VOLATILE-HTML sources out of that refresh-all set and returns their IDs;
    an explicitly selected volatile source still fails.
    """
    temp_parent = Path(temp_root)
    temp_parent.mkdir(parents=True, exist_ok=True)
    sources_by_id = {source["source_id"]: source for source in sources}
    selected = set(selected_ids or ())
    skipped = []
    if selected:
        require(selected <= set(sources_by_id), f"online refresh: unknown source IDs {sorted(selected - set(sources_by_id))}")
        chosen = [sources_by_id[source_id] for source_id in sorted(selected)]
    else:
        chosen = [source for source in sources if source["availability"] == "AVAILABLE"]
        if skip_volatile:
            skipped = [source["source_id"] for source in chosen if source.get("refresh_policy", "HASH-LOCKED") == "VOLATILE-HTML"]
            chosen = [source for source in chosen if source["source_id"] not in skipped]
    with tempfile.TemporaryDirectory(prefix="component-spec-refresh-", dir=temp_parent) as directory:
        temp = Path(directory)
        for source in chosen:
            validate_source(source, schema)
            require(source["availability"] == "AVAILABLE", f"{source['source_id']}: only AVAILABLE sources can be refreshed")
            require(source.get("refresh_policy", "HASH-LOCKED") == "HASH-LOCKED", f"{source['source_id']}: volatile source cannot claim deterministic selective refresh")
            target = temp / f"{source['source_id']}.download"
            payload = fetch_source(source, opener, user_agent=user_agent)
            store_and_verify(payload, target, source["sha256"], source["source_id"])
    return skipped
