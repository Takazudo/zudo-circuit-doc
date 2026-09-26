# contract/

The frozen **component-spec contract, version 1**, extracted from zudo-led-lamp
`194d8a297e3545588197342130c3111a66c10973`
(`.claude/skills/component-spec-audit/references/`).

| File | What it is |
| --- | --- |
| `contract.md` | The frozen v1 prose contract. Byte-identical to upstream. |
| `schema.json` | The v1 **custom** contract data: required-key lists, enums and contract prose that the Python validator (`python/circuit_evidence`) reads. |

`schema.json` is **not JSON Schema**. Do not feed it to a JSON Schema validator; it is a plain data file whose keys (`record_required`, `source_required`, `verdicts`, …) are consumed by `circuit_evidence`.

## Changes from upstream

- `schema.json` `source_required` now lists `record_id`. Upstream already enforced it (`validate.py:653`, "orphan source/unknown record ID"); the list now documents it, so a source without the key fails with `missing keys ['record_id']`. The packaged golden self-test fixture (`python/circuit_evidence/selftest/golden/critical-facts.json`) gained the matching `"record_id": "rec-golden"` on its one source.

Everything else is byte-identical to upstream.
