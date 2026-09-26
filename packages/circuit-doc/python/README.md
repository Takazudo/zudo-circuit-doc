# python/

The canonical component-evidence validator, shipped inside the npm tarball (ADR-007). Python **3.10+**, standard library only; run with `python3 -B` so no `__pycache__` is written into an installed package.

- `circuit_evidence/` — the generic v1 contract core: source, fact, bundle, routing, aggregate, template and golden checks. Every project path arrives as an argument; the only data it locates on its own is its package-data self-test under `circuit_evidence/selftest/`.
- `tests/` — unit tests (excluded from the published package). Run from the repo root with `pnpm test:python`.
