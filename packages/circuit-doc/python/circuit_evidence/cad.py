"""The generic CAD pin-asset check: pin maps against configured KiCad symbol and footprint files.

KiCad files are read as text; KiCad itself is never needed.
"""

from __future__ import annotations

import re
from pathlib import Path

from .errors import ContractError, require

SYMBOL_PIN = re.compile(r'\(number\s+"([^"\s]+)"')
FOOTPRINT_PAD = re.compile(r'\(pad\s+"?([^"\s()]+)"?\s+')
CAD_DISABLED_SKIP = "pin-asset check not performed: cad disabled"


def sexp_named_block(text, kind, name):
    match = re.search(rf'\({re.escape(kind)}\s+"{re.escape(name)}"', text)
    require(match is not None, f"KiCad {kind} {name}: definition missing")
    depth, quoted, escaped = 0, False, False
    for index in range(match.start(), len(text)):
        char = text[index]
        if quoted:
            if escaped: escaped = False
            elif char == "\\": escaped = True
            elif char == '"': quoted = False
        elif char == '"': quoted = True
        elif char == "(": depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0: return text[match.start():index + 1]
    raise ContractError(f"KiCad {kind} {name}: unterminated definition")


class CadLibraries:
    """The configured symbol libraries and footprint directories, read on first use."""

    def __init__(self, symbol_libraries, footprint_dirs):
        self.symbol_libraries = [Path(path) for path in symbol_libraries]
        self.footprint_dirs = [Path(path) for path in footprint_dirs]
        self._symbol_texts = None

    def symbol_texts(self):
        """Check every configured path exists, then read the symbol libraries once."""
        if self._symbol_texts is None:
            for path in self.symbol_libraries:
                require(path.is_file(), f"cad: configured symbol library is missing: {path}")
            for path in self.footprint_dirs:
                require(path.is_dir(), f"cad: configured footprint directory is missing: {path}")
            self._symbol_texts = [path.read_text(encoding="utf-8") for path in self.symbol_libraries]
        return self._symbol_texts

    def symbol_block(self, name):
        for text in self.symbol_texts():
            if re.search(rf'\(symbol\s+"{re.escape(name)}"', text):
                return sexp_named_block(text, "symbol", name)
        return None

    def footprint_text(self, name):
        for directory in self.footprint_dirs:
            path = directory / f"{name}.kicad_mod"
            if path.is_file():
                return path.read_text(encoding="utf-8")
        return None


def validate_pin_assets(aggregate, lines, cad, *, provider=None, provider_result=None):
    """Return the SKIP message when CAD is disabled (nothing is read), else ``None`` after checking."""
    if not cad["enabled"]:
        return CAD_DISABLED_SKIP
    require(cad["requirePinEqualsPad"] is True, "cad: requirePinEqualsPad must be true in contract v1")
    libraries = CadLibraries(cad["symbolLibraries"], cad["footprintDirs"])
    libraries.symbol_texts()
    records = {record["record_id"]: record for record in aggregate["records"]}
    lines_by_id = {line["line_id"]: line for line in lines}
    for mapping in aggregate["pin_maps"]:
        record = records[mapping["record_id"]]
        line = lines_by_id[record["line_id"]]
        external = line.get("mounting") == "external"
        require(mapping.get("mounting", "pcb") == ("external" if external else "pcb"), f"{record['record_id']}: pin map mounting mismatch")
        block = libraries.symbol_block(mapping["symbol"])
        require(block is not None, f"{record['record_id']}: KiCad symbol {mapping['symbol']} missing from configured symbol libraries")
        actual_symbol_pins = set(SYMBOL_PIN.findall(block))
        locked_symbol_pins = {pin["symbol_pin"] for pin in mapping["pins"]}
        require(locked_symbol_pins == actual_symbol_pins, f"{record['record_id']}: pin map differs from KiCad symbol {mapping['symbol']}")
        if external:
            require(mapping["footprint"] == "", f"{record['record_id']}: external pin map footprint must be empty")
            require(all(pin["footprint_pad"] == pin["symbol_pin"] for pin in mapping["pins"]), f"{record['record_id']}: external terminal mapping differs")
            continue
        footprint = libraries.footprint_text(mapping["footprint"])
        require(footprint is not None, f"{record['record_id']}: KiCad footprint {mapping['footprint']} missing from configured footprint directories")
        actual_pads = set(FOOTPRINT_PAD.findall(footprint))
        locked_pads = {pin["footprint_pad"] for pin in mapping["pins"]}
        require(locked_pads == actual_pads, f"{record['record_id']}: pin map differs from KiCad footprint {mapping['footprint']}")
        require(all(pin["symbol_pin"] == pin["footprint_pad"] for pin in mapping["pins"]), f"{record['record_id']}: symbol-pin to footprint-pad mapping differs from KiCad numbering")
    if provider is not None:
        provider.extra_pin_asset_checks(provider_result, aggregate)
    return None
