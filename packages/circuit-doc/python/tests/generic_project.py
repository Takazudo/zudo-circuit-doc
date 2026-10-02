"""Synthetic generic projects and resolved configs for the orchestrator/CLI tests."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parent.parent
PACKAGE_DIR = PYTHON_DIR.parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from circuit_evidence import BUNDLE_FILES, load, template_bundle  # noqa: E402

CLI = PYTHON_DIR / "circuit_validate.py"
TEMPLATE = PACKAGE_DIR / "templates/component-skill-template"
SCHEMA = PACKAGE_DIR / "contract/schema.json"
USER_AGENT = "zudo-circuit-doc-component-spec/1.0"
AUDIT = "component-spec-audit"
INTEGRATION = "circuit-spec-integration"


def schema():
    return load(SCHEMA)


def line(line_id, mpn, manufacturer, *, lcsc="", owner, package="PKG", function="schottky diode", placements=(), dnp=False, identity_state="UNRESOLVED", source_state="SOURCE UNAVAILABLE", **extra):
    return {
        "line_id": line_id, "mpn": mpn, "manufacturer": manufacturer, "lcsc": lcsc, "package": package,
        "dnp": dnp, "owner_skill": owner, "identity_state": identity_state, "source_state": source_state,
        "function": function, "placements": [dict(item) for item in placements], **extra,
    }


def bundle_for(line_data, *, suffix):
    """The template bundle with every demo value replaced by ``line_data``'s identity."""
    text = json.dumps(template_bundle(TEMPLATE))
    for old, new in (
        ("Example Manufacturer", line_data["manufacturer"]),
        ("EXAMPLE-MPN", line_data["mpn"]),
        ('"EXAMPLE"', json.dumps(line_data["package"])),
        ("example.invalid", "vendor.test"),
        ("C000000", line_data["lcsc"] or "C000000"),
        ("independent-reviewer-placeholder", "reviewer-a"),
        ("example function", line_data["function"]),
        ("-example", f"-{suffix}"),
    ):
        text = text.replace(old, new)
    bundle = json.loads(text)
    bundle["records"][0]["line_id"] = line_data["line_id"]
    if not line_data["lcsc"]:
        bundle["records"][0]["lcsc"] = ""
        route = bundle["routes"][0]
        route["aliases"]["lcsc"] = []
        route["positive"] = [f"check {line_data['mpn']} pinout"]
    if line_data.get("mounting") == "external":
        bundle["pin_maps"][0].update({"mounting": "external", "footprint": ""})
    return bundle


def skill_md(name):
    return (
        f"---\nname: {name}\n"
        "description: Resolve exact component limits and constraints for this synthetic test part. Use whenever it is relevant.\n"
        "---\n\n# Test component\n"
    )


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return path


def write_bundle(skill_dir, bundle):
    skill_dir = Path(skill_dir)
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(skill_md(skill_dir.name), encoding="utf-8")
    for key, (filename, field) in BUNDLE_FILES.items():
        write_json(skill_dir / filename, {"schema_version": 1, field: bundle[key]})


def inventory(lines):
    return {
        "schema_version": 1, "generator_specs": [],
        "assertions": {
            "orderable_lines": len(lines),
            "fitted_lines": sum(not item["dnp"] for item in lines),
            "dnp_or_hand_fit_lines": sum(item["dnp"] for item in lines),
        },
        "exclusions": [], "lines": lines,
    }


def make_project(root, lines=(), *, bundles=None, rules=None, forward_tests=None, direct_routing=None, vendor_names=None, cad=None, policy=None):
    """Write a synthetic project under ``root`` and return its resolved config.

    ``bundles`` maps an owner directory to a bundle; by default each line gets its own
    owner bundle derived from the template.
    """
    root = Path(root)
    skills = root / ".claude/skills"
    audit_refs = skills / AUDIT / "references"
    integration_refs = skills / INTEGRATION / "references"
    lines = list(lines)
    for directory, name in ((skills / AUDIT, AUDIT), (skills / INTEGRATION, INTEGRATION)):
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "SKILL.md").write_text(skill_md(name), encoding="utf-8")
    inventory_path = write_json(audit_refs / "inventory.json", inventory(lines))
    if bundles is None:
        bundles = {item["owner_skill"]: bundle_for(item, suffix=item["line_id"].removeprefix("line-")) for item in lines}
    for owner, bundle in bundles.items():
        write_bundle(skills / owner, bundle)
    rules_path = write_json(integration_refs / "rules.json", {"schema_version": 1, "rules": rules or []})
    forward_path = write_json(integration_refs / "forward-tests.json", forward_tests) if forward_tests is not None else None
    routing_path = write_json(audit_refs / "direct-routing.json", direct_routing) if direct_routing is not None else None
    vendor_path = write_json(audit_refs / "external-vendor-qualifiers.json", {"schema_version": 1, "vendor_names": vendor_names}) if vendor_names is not None else None
    policy_path = write_json(root / "circuit/policy.json", policy) if policy is not None else None
    return {
        "configVersion": 1, "contractVersion": 1, "projectRoot": str(root),
        "bundles": {"root": str(skills), "ownerPrefix": "component-", "reservedDirs": [AUDIT], "auditSkillDir": str(skills / AUDIT), "requireSkillMd": True},
        "inventory": {"path": str(inventory_path), "candidatesPath": None, "provider": {"kind": "manual"}},
        "routing": {"directRouting": str(routing_path) if routing_path else None, "vendorQualifiers": str(vendor_path) if vendor_path else None},
        "template": {"dir": str(TEMPLATE), "name": "component-example"},
        "cad": cad or {"enabled": False, "symbolLibraries": [], "footprintDirs": [], "requirePinEqualsPad": True},
        "integration": {"rulesPath": str(rules_path), "forwardTests": str(forward_path) if forward_path else None, "integrationSkillDir": str(skills / INTEGRATION)},
        "policy": {"path": str(policy_path) if policy_path else None},
        "online": {"tempRoot": str(root / ".circuit-cache/sources"), "userAgent": USER_AGENT, "skipVolatileInAll": True},
        "output": {"json": False},
    }


def run_cli(*args, config=None, stdin=None, env=None):
    """Run the CLI with ``python3 -B``; ``config`` (a dict) is written beside nothing and piped via stdin."""
    command = [sys.executable, "-B", str(CLI), *args]
    if config is not None:
        stdin = json.dumps(config)
    run_env = {key: value for key, value in os.environ.items() if key.lower() not in ("http_proxy", "https_proxy", "all_proxy")}
    run_env.update({"PYTHONDONTWRITEBYTECODE": "1", "NO_PROXY": "*", "no_proxy": "*"})
    run_env.update(env or {})
    return subprocess.run(command, input=stdin, capture_output=True, text=True, env=run_env, timeout=120)
