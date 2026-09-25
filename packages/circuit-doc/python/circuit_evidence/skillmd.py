"""SKILL.md frontmatter checks."""

from __future__ import annotations

from pathlib import Path

from .errors import ContractError, require


def frontmatter(path: Path, expected_name: str):
    path = Path(path)
    require(path.name == "SKILL.md", f"{path}: skill filename must be uppercase SKILL.md")
    text = path.read_text(encoding="utf-8")
    require(text.startswith("---\n"), f"{path}: missing YAML frontmatter")
    try:
        raw = text.split("---\n", 2)[1]
    except IndexError as exc:
        raise ContractError(f"{path}: unterminated frontmatter") from exc
    fields = {}
    for line in raw.splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            fields[key.strip()] = value.strip()
    require(fields.get("name") == expected_name, f"{path}: name must equal directory {expected_name}")
    description = fields.get("description", "")
    require(len(description) >= 80 and "use" in description.lower(), f"{path}: description lacks trigger quality")
    require("triggers" not in fields, f"{path}: undocumented triggers key")
    require(fields.get("disable-model-invocation") != "true", f"{path}: model invocation disabled")
