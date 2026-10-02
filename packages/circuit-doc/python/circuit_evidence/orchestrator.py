"""Config-driven validation run: the resolved-config JSON (RESOLVED_CONFIG.md) decides every path,
the inventory provider and the project policy; the check order is fixed here.
"""

from __future__ import annotations

import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from . import cad as cad_checks
from .aggregate import partition_aggregate, validate_owner_bundles
from .bundle import validate_bundle
from .errors import load, require, required_keys
from .golden import SELFTEST_DIR, run_seeded_fixtures
from .integration import DEFAULT_INTEGRATION_SKILL, check_forward_tests, load_rules, validate_rules
from .inventory import load_candidates, load_inventory, provider_for
from .policy import POLICY_CHECKS
from .routing import RoutingPolicy, validate_routing
from .skillmd import frontmatter
from .sources import online_sources
from .template import check_placeholder_leak, template_bundle, validate_template_skill

CONFIG_VERSION = 1
CONTRACT_VERSION = 1
SCHEMA_PATH = Path(__file__).resolve().parents[2] / "contract/schema.json"
CONFIG_SECTIONS = {
    "bundles": ("root", "ownerPrefix", "reservedDirs", "auditSkillDir", "requireSkillMd"),
    "inventory": ("path", "provider", "candidatesPath"),
    "routing": ("directRouting", "vendorQualifiers"),
    "template": ("dir", "name"),
    "cad": ("enabled", "symbolLibraries", "footprintDirs", "requirePinEqualsPad"),
    "integration": ("rulesPath", "forwardTests", "integrationSkillDir"),
    "policy": ("path",),
    "online": ("tempRoot", "userAgent", "skipVolatileInAll"),
    "output": ("json",),
}
REQUIRED_PATHS = ("projectRoot", "bundles.root", "inventory.path", "template.dir", "online.tempRoot")
OPTIONAL_PATHS = ("inventory.candidatesPath", "bundles.auditSkillDir", "routing.directRouting", "routing.vendorQualifiers", "integration.rulesPath", "integration.forwardTests", "integration.integrationSkillDir", "policy.path")


@dataclass
class Report:
    scope: list = field(default_factory=list)
    skip: list = field(default_factory=list)
    warn: list = field(default_factory=list)
    lines: int = 0
    offline: bool = True
    refreshed: str = "none"

    def pass_line(self):
        return f"PASS: component-spec contract; {self.lines} lines; offline={self.offline}; refreshed={self.refreshed}"

    def prefixed_lines(self):
        return [*(f"SCOPE: {line}" for line in self.scope), *(f"SKIP: {line}" for line in self.skip), *(f"WARN: {line}" for line in self.warn)]


@dataclass
class ValidationContext:
    """Everything a policy check may need; later steps fill the later fields."""

    config: dict
    schema: dict
    report: Report
    provider: object = None
    inventory: dict = None
    lines: list = None
    candidates: list = field(default_factory=list)
    fitted_aggregate: dict = None
    candidate_aggregate: dict = None
    routing: RoutingPolicy = None
    aggregate: dict = None
    bundles: dict = None
    provider_result: object = None
    rules: list = None


def _lookup(config, dotted):
    value = config
    for part in dotted.split("."):
        value = value[part]
    return value


def validate_config(config):
    require(isinstance(config, dict), "config: top level must be an object")
    required_keys(config, ("configVersion", "contractVersion", "projectRoot", *CONFIG_SECTIONS), "config")
    require(config["configVersion"] == CONFIG_VERSION, f"config: unsupported configVersion {config['configVersion']!r}")
    require(config["contractVersion"] == CONTRACT_VERSION, f"config: unsupported contractVersion {config['contractVersion']!r}")
    for section, keys in CONFIG_SECTIONS.items():
        require(isinstance(config[section], dict), f"config: {section} must be an object")
        required_keys(config[section], keys, f"config {section}")
    for dotted in REQUIRED_PATHS:
        value = _lookup(config, dotted)
        require(isinstance(value, str) and Path(value).is_absolute(), f"config: {dotted} must be an absolute path")
    for dotted in OPTIONAL_PATHS:
        value = _lookup(config, dotted)
        require(value is None or (isinstance(value, str) and Path(value).is_absolute()), f"config: {dotted} must be an absolute path or null")
    for dotted in ("cad.symbolLibraries", "cad.footprintDirs", "bundles.reservedDirs"):
        value = _lookup(config, dotted)
        require(isinstance(value, list) and all(isinstance(item, str) and item for item in value), f"config: {dotted} must be a list of strings")
    for dotted in ("cad.symbolLibraries", "cad.footprintDirs"):
        require(all(Path(item).is_absolute() for item in _lookup(config, dotted)), f"config: {dotted} must hold absolute paths")
    for dotted in ("bundles.requireSkillMd", "cad.enabled", "cad.requirePinEqualsPad", "online.skipVolatileInAll", "output.json"):
        require(isinstance(_lookup(config, dotted), bool), f"config: {dotted} must be a boolean")
    for dotted in ("bundles.ownerPrefix", "template.name", "online.userAgent"):
        value = _lookup(config, dotted)
        require(isinstance(value, str) and value.strip(), f"config: {dotted} must be a nonblank string")
    return config


def require_configured_file(path, label):
    require(Path(path).is_file(), f"{label}: configured file is missing: {path}")


def check_skill_frontmatter(skill_dir, require_skill_md):
    if skill_dir is None:
        return
    skill_md = Path(skill_dir) / "SKILL.md"
    if require_skill_md or skill_md.exists():
        require_configured_file(skill_md, "skill frontmatter")
        frontmatter(skill_md, Path(skill_dir).name)


def run_policy(context):
    path = context.config["policy"]["path"]
    if path is None:
        return
    require_configured_file(path, "policy")
    require(POLICY_CHECKS, f"policy: {path} is configured but no policy checks are registered")
    data = load(path)
    require(isinstance(data, dict), "policy: top level must be an object")
    for key in sorted(set(data) - {"schema_version"}):
        require(key in POLICY_CHECKS, f"policy: unknown check {key!r}; registered: {sorted(POLICY_CHECKS)}")
        POLICY_CHECKS[key](data[key], context)


def validate(config, *, online=False, refresh_source_ids=(), opener=urllib.request.urlopen, selftest_dir=SELFTEST_DIR, report=None):
    """Run every check in order and return the report; any failure raises."""
    refresh_source_ids = list(refresh_source_ids or ())
    require(not (online and refresh_source_ids), "choose --online or --refresh-source, not both")
    report = report if report is not None else Report()
    report.offline = not online and not refresh_source_ids
    report.refreshed = ",".join(refresh_source_ids) if refresh_source_ids else ("all" if online else "none")
    config = validate_config(config)
    schema = load(SCHEMA_PATH)
    context = ValidationContext(config=config, schema=schema, report=report)
    context.provider = provider_for(config["inventory"]["provider"])
    bundles_cfg, integration_cfg = config["bundles"], config["integration"]

    # 1. skill frontmatter
    check_skill_frontmatter(bundles_cfg["auditSkillDir"], bundles_cfg["requireSkillMd"])
    check_skill_frontmatter(integration_cfg["integrationSkillDir"], bundles_cfg["requireSkillMd"])

    # 2. template
    template_dir = config["template"]["dir"]
    validate_template_skill(template_dir, config["template"]["name"])
    validate_bundle(template_bundle(template_dir), schema)

    # 3. seeded self-test
    extra_cases, extra_bases = context.provider.seeded_cases()
    run_seeded_fixtures(schema, template_dir, selftest_dir=selftest_dir, extra_cases=extra_cases, extra_bases=extra_bases)

    # 4. local bundles + placeholder leak
    context.inventory = load_inventory(config["inventory"]["path"], placement_fit=context.provider.placement_fit)
    context.lines = context.inventory["lines"]
    candidates_path = config["inventory"]["candidatesPath"]
    if candidates_path is not None:
        require_configured_file(candidates_path, "candidates")
        context.candidates = load_candidates(candidates_path)
    vendor_qualifiers = config["routing"]["vendorQualifiers"]
    if vendor_qualifiers is not None:
        require_configured_file(vendor_qualifiers, "routing vendor qualifiers")
    context.routing = RoutingPolicy.load(vendor_qualifiers, context.provider.board_names(context.inventory))
    bundles_root = Path(bundles_cfg["root"])
    require(bundles_root.is_dir(), f"bundles: configured directory is missing: {bundles_root}")
    context.aggregate, context.bundles = validate_owner_bundles(
        schema, context.lines, bundles_root, candidates=context.candidates,
        owner_prefix=bundles_cfg["ownerPrefix"], reserved_dirs=bundles_cfg["reservedDirs"], routing=context.routing,
    )
    context.fitted_aggregate, context.candidate_aggregate = partition_aggregate(context.aggregate)
    check_placeholder_leak(context.bundles)

    # 5. inventory provider
    context.provider_result = context.provider.validate(context.inventory, context.fitted_aggregate, config)
    context.provider.validate_candidates(context.candidates, context.inventory)
    report.scope.extend(context.provider_result.scope_lines)
    if context.candidates:
        candidate_owners = {candidate["owner_skill"] for candidate in context.candidates}
        report.scope.append(
            f"candidates: {len(context.candidates)} audited candidate records in {len(candidate_owners)} owners "
            "(excluded from placements, CAD binding, routing and publication)"
        )
    report.warn.extend(context.provider_result.warnings)
    report.lines = len(context.provider_result.lines)

    # 6. routing (per-line direct-routing cases are mandatory once the file is configured)
    direct_routing = config["routing"]["directRouting"]
    fixtures = None
    if direct_routing is not None:
        require_configured_file(direct_routing, "routing direct-routing")
        fixtures = load(direct_routing)
    validate_routing(context.provider_result.lines, fixtures, context.routing)

    # 7. CAD pin assets
    skipped = cad_checks.validate_pin_assets(context.fitted_aggregate, context.provider_result.lines, config["cad"], provider=context.provider, provider_result=context.provider_result)
    if skipped:
        report.skip.append(skipped)

    # 8. integration
    context.rules = []
    if integration_cfg["rulesPath"] is not None:
        context.rules = load_rules(integration_cfg["rulesPath"])
        candidate_record_ids = {record["record_id"] for record in context.candidate_aggregate["records"]}
        candidate_fact_ids = {fact["fact_id"] for fact in context.candidate_aggregate["facts"]}
        validate_rules(
            context.rules,
            context.fitted_aggregate,
            schema,
            candidate_record_ids=candidate_record_ids,
            candidate_fact_ids=candidate_fact_ids,
        )
    if integration_cfg["forwardTests"] is not None:
        skill_dir = integration_cfg["integrationSkillDir"]
        skill_name = Path(skill_dir).name if skill_dir is not None else DEFAULT_INTEGRATION_SKILL
        forward = check_forward_tests(integration_cfg["forwardTests"], rules=context.rules, aggregate=context.fitted_aggregate, lines=context.provider_result.lines, routing=context.routing, skill_name=skill_name)
        if forward.cases == 0:
            report.skip.append(f"forward tests: 0 cases ({forward.negative_routes} negative routes checked)")

    # 9. project policy
    run_policy(context)

    if online or refresh_source_ids:
        online_cfg = config["online"]
        skipped_ids = online_sources(
            schema, context.aggregate["sources"], refresh_source_ids or None, opener,
            temp_root=online_cfg["tempRoot"], user_agent=online_cfg["userAgent"],
            skip_volatile=online_cfg["skipVolatileInAll"] and not refresh_source_ids,
        )
        report.skip.extend(f"{source_id} volatile source not hash-refreshable" for source_id in skipped_ids)
    return report
