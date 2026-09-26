"""The generic-v1 inventory profile (ADR-010): lines are declared by hand, not generated."""

from __future__ import annotations

import re

from ..errors import require
from .common import InventoryProvider, ProviderResult, placements, summary_lag_warnings, validate_counts, validate_owner_parity

LCSC = re.compile(r"^C[0-9]+$")


class ManualProvider(InventoryProvider):
    kind = "manual"

    def __init__(self, options):
        super().__init__(options)
        require(set(options) == {"kind"}, f"inventory provider manual: unexpected options {sorted(set(options) - {'kind'})}")

    def validate(self, inventory, aggregate, config):
        require(inventory["generator_specs"] == [], "inventory provider manual: generator_specs must be []")
        lines = inventory["lines"]
        validate_counts(inventory)
        identities = [(line["manufacturer"].casefold(), line["mpn"].casefold()) for line in lines]
        require(len(set(identities)) == len(identities), "inventory: duplicate (manufacturer, mpn) identity")
        lcsc_values = [line["lcsc"] for line in lines if line["lcsc"]]
        require(len(set(lcsc_values)) == len(lcsc_values), "inventory: duplicate LCSC ownership")
        for line in lines:
            if line["lcsc"]:
                require(LCSC.fullmatch(line["lcsc"]), f"{line['line_id']}: LCSC must match ^C[0-9]+$ when present")
            if line.get("mounting") == "external":
                require(line["lcsc"] == "" and not line["dnp"], f"{line['line_id']}: external identity must have no LCSC and be fitted")
                for key in ("supplier", "order_code"):
                    require(isinstance(line.get(key), str) and line[key].strip(), f"{line['line_id']}: external {key} missing")
            suppliers = line.get("suppliers", [])
            require(isinstance(suppliers, list), f"{line['line_id']}: suppliers must be a list")
            for supplier in suppliers:
                require(
                    isinstance(supplier, dict) and set(supplier) == {"supplier", "order_code"}
                    and all(isinstance(supplier[key], str) and supplier[key].strip() for key in ("supplier", "order_code")),
                    f"{line['line_id']}: suppliers entries need exactly nonblank supplier and order_code",
                )
        validate_owner_parity(lines, aggregate)
        declared = placements(lines)
        pin_assets = "performed" if config["cad"]["enabled"] else "not performed: cad disabled"
        scope = (
            f"inventory provider=manual; schematic/placement binding not performed "
            f"({len(lines)} lines, {len(declared)} declared placements unverified); pin-asset check {pin_assets}"
        )
        return ProviderResult(lines=lines, placements=declared, scope_lines=[scope], warnings=summary_lag_warnings(lines, aggregate))
