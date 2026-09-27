# Expected changes from the pinned upstream goldens

`fixtures/led/expected/` overrides exactly one file, in exactly one field, from
what a byte-for-byte comparison against `fixtures/led/upstream/` would
otherwise require:

| File | Field | Upstream (pinned) | Expected (this package) |
| --- | --- | --- | --- |
| `doc/component-docs/preflight.json` | `viewModelVersion` | `1` | `2` |

Every other byte of `expected/doc/component-docs/preflight.json` is identical
to `upstream/doc/component-docs/preflight.json`. Every generated MDX page (all
39 of them) is byte-identical to its upstream counterpart — there is no
override for any of them.

## Why

[ADR-011](../../dev-docs/decisions.md#adr-011-neutral-generated-page-marker) bumped the
core `VIEW_MODEL_VERSION` from `1` to `2` (landed in
[#18](https://github.com/Takazudo/zudo-circuit-doc/issues/18), before any
example or fixture output was committed, so no committed preflight went
stale). The pinned zudo-led-lamp corpus was generated against the upstream
engine, which still emits `1`. `viewModelVersion` is the packaged pipeline's own
version tag, not part of the reviewed component-evidence contract, so this is
the one place a value is allowed to legitimately differ between "what upstream
produced" and "what this package produces from the same evidence" —
[#21](https://github.com/Takazudo/zudo-circuit-doc/issues/21) exists to prove
it is the *only* place.

## Rule for any future difference

If `node scripts/check-led-fixture.mjs` ever finds another byte that differs
from the pinned upstream output, **do not add it here**. That is a regression
in the owning code, not a second expected change — fix the regression (or, if
it is a deliberate future change, get it reviewed and update this table and
ADR-011 together, in the same PR that introduces the difference).
