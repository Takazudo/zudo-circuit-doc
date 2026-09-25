"""``inventory.provider.kind`` -> provider implementation. Add one line per provider module."""

from __future__ import annotations

from ..errors import require
from .led_generator_v1 import LedGeneratorProvider
from .manual import ManualProvider

PROVIDERS = {
    ManualProvider.kind: ManualProvider,
    LedGeneratorProvider.kind: LedGeneratorProvider,
}


def provider_for(options):
    require(isinstance(options, dict), "inventory.provider: must be an object")
    kind = options.get("kind")
    require(kind in PROVIDERS, f"inventory provider: unknown kind {kind!r}; registered: {sorted(PROVIDERS)}")
    return PROVIDERS[kind](options)
