"""Data-driven project policy (see ``checks.py`` for the policy-file schema)."""

from .checks import CHECK_TYPES, run_checks

# Policy-file key -> check(value, context); the orchestrator dispatches on these keys.
POLICY_CHECKS = {"checks": run_checks}
