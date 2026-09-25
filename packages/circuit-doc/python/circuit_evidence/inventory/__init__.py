"""Inventory profiles: shared checks plus one provider per ``inventory.provider.kind``."""

from .common import (
    IDENTITY_STATES,
    SOURCE_STATES,
    InventoryProvider,
    ProviderResult,
    evidence_states,
    load_inventory,
    placement_boards,
    placements,
    summary_lag_warnings,
    validate_counts,
    validate_inventory_shape,
    validate_owner_parity,
)
from .manual import ManualProvider
from .registry import PROVIDERS, provider_for
