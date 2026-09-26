"""The shipped component-skill template and the check that its demo values never leak."""

from __future__ import annotations

import re
from pathlib import Path

from .bundle import load_skill_bundle
from .errors import require
from .skillmd import frontmatter

TEMPLATE_SKILL_NAME = "component-example"
PLACEHOLDER_PATTERNS = (
    ("EXAMPLE-MPN", re.compile(r"EXAMPLE-MPN")),
    ("C000000", re.compile(r"(?<![A-Za-z0-9])C000000(?![0-9])")),
    ("example.invalid", re.compile(r"example\.invalid", re.I)),
    ("Example Manufacturer", re.compile(r"Example Manufacturer")),
    ("independent-reviewer-placeholder", re.compile(r"independent-reviewer-placeholder")),
    ("template ID", re.compile(r"(?<![a-z0-9-])(?:rec|src|line)-example(?![a-z0-9])")),
)


def template_bundle(template_dir):
    return load_skill_bundle(template_dir)


def validate_template_skill(template_dir, expected_name=TEMPLATE_SKILL_NAME):
    template_skill = Path(template_dir) / "SKILL.md"
    frontmatter(template_skill, expected_name)
    text = template_skill.read_text(encoding="utf-8")
    closing = text.find("---\n", 4)
    require(closing >= 0 and text.find("## Human component reference", closing + 4) >= 0, "component template: missing Human component reference section")


def _strings(value, path):
    if isinstance(value, str):
        yield path, value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from _strings(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _strings(item, f"{path}.{index}")


def check_placeholder_leak(active_bundles):
    """Fail when an active owner bundle still carries template demo values.

    ``active_bundles`` maps an owner name to its loaded bundle. Pass only active
    owner bundles; the template itself is exempt and is never an active bundle.
    """
    for owner in sorted(active_bundles):
        for path, text in _strings(active_bundles[owner], owner):
            for label, pattern in PLACEHOLDER_PATTERNS:
                require(pattern.search(text) is None, f"{path}: template placeholder leaked into an active bundle ({label}): {text}")
