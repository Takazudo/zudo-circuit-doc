"""Contract error type and the small shared helpers every check builds on."""

from __future__ import annotations

import json
from pathlib import Path


class ContractError(ValueError):
    pass


def load(path: Path):
    with Path(path).open(encoding="utf-8") as handle:
        return json.load(handle)


def require(condition, message):
    if not condition:
        raise ContractError(message)


def required_keys(obj, keys, context):
    missing = [key for key in keys if key not in obj]
    require(not missing, f"{context}: missing keys {missing}")
