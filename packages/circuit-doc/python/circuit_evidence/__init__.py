"""Generic v1 component-evidence contract core (Python standard library only).

Every project path arrives as an argument; nothing here locates project data on its own.
"""

from .aggregate import validate_local_skills, validate_owner_bundles
from .bundle import BUNDLE_FILES, OPEN_UNAVAILABLE_CLAIM, canonical_pin_map, load_skill_bundle, validate_bundle, validate_pin_maps
from .errors import ContractError, load, require, required_keys
from .facts import (
    arithmetic,
    expression_names,
    fact_blocks_domain,
    fact_evidence_available,
    fact_primary_trusted,
    graph_cycles,
    validate_facts,
    validate_pass_trust,
)
from .golden import SELFTEST_DIR, run_seeded_fixtures, set_target, validate_golden
from .routing import (
    NO_ROUTING_POLICY,
    RoutingPolicy,
    contains_alias,
    external_vendor_tokens,
    looks_like_vendor_hint,
    resolve,
    resolve_bundle_route,
    resolve_identities,
    validate_routing,
)
from .skillmd import frontmatter
from .sources import (
    HEX64,
    HTTP_TIMEOUT_SECONDS,
    ID,
    LOCATOR_DETAIL,
    ZERO_SHA256,
    fetch_source,
    http_headers,
    online_sources,
    store_and_verify,
    validate_source,
)
from .template import TEMPLATE_SKILL_NAME, check_placeholder_leak, template_bundle, validate_template_skill

CONTRACT_VERSION = 1
