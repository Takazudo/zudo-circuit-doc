# Resolved-config JSON (v1)

`circuit_validate.py` reads its whole input from one JSON object. The JS runner writes it after it has loaded and resolved `circuit.config.ts`. The runner passes it as `--config <file>` or pipes it on stdin with `--config -`. Python never reads TypeScript, and never works out a project path from its own location.

- **Every key is required.** A missing key, a wrong type, or a relative path is a `FAIL`.
- **Every path is absolute.** `null` means "not configured".
- **A configured file that does not exist is a `FAIL` that names the path.** An explicitly empty file, such as `lines: []` or `rules: []`, passes.

```jsonc
{
  "configVersion": 1,
  "contractVersion": 1,
  "projectRoot": "/abs/project",
  "bundles": {
    "root": "/abs/project/.claude/skills",       // must exist; owner bundles are <root>/<ownerPrefix>*
    "ownerPrefix": "component-",
    "reservedDirs": ["component-spec-audit"],    // prefix-matching dirs that are not owner bundles
    "auditSkillDir": "/abs/project/.claude/skills/component-spec-audit",  // or null
    "requireSkillMd": true
  },
  "inventory": {
    "path": "/abs/project/.claude/skills/component-spec-audit/references/inventory.json",
    "provider": { "kind": "manual" }             // or { "kind": "<registered>", ...provider options }
  },
  "routing": {
    "directRouting": "/abs/.../direct-routing.json",               // or null
    "vendorQualifiers": "/abs/.../external-vendor-qualifiers.json" // or null
  },
  "template": { "dir": "/abs/node_modules/@takazudo/zudo-circuit-doc/templates/component-skill-template", "name": "component-example" },
  "cad": { "enabled": false, "symbolLibraries": [], "footprintDirs": [], "requirePinEqualsPad": true },
  "integration": {
    "rulesPath": "/abs/.../rules.json",                    // or null
    "forwardTests": "/abs/.../forward-tests.json",         // or null
    "integrationSkillDir": "/abs/project/.claude/skills/circuit-spec-integration"  // or null
  },
  "policy": { "path": null },                              // or "/abs/.../policy.json"
  "online": { "tempRoot": "/abs/project/.circuit-cache/sources", "userAgent": "zudo-circuit-doc-component-spec/1.0", "skipVolatileInAll": true },
  "output": { "json": false }
}
```

## Key notes

- **`bundles.requireSkillMd`:** when `true`, `SKILL.md` must exist under `auditSkillDir` and `integrationSkillDir` (when they are set), and its frontmatter `name` must equal the directory name. When `false`, the frontmatter is checked only if the file exists. Owner bundles always require `SKILL.md`, because `schema.json` `required_skill_files` lists it.
- **`inventory.provider`:** `kind` selects the implementation in `circuit_evidence/inventory/registry.py`. `manual` (generic-v1, ADR-010) takes no other options, and it requires `generator_specs: []`.
  `led-generator-v1` takes `specs: [{path, board?}]` (absolute paths; `[]` means no generator). Board names come from each spec's `PROJECT_NAME` unless `board` overrides it, and the inventory's `generator_specs` must equal the spec paths relative to `projectRoot`.
- **`routing.directRouting`:**
  - When configured, the file must hold exactly one `{line_id, negative}` case per inventory line.
  - When `null`, the positive direct-routing queries still run for every line.
  - `vendorQualifiers` may list zero vendors.
- **`template`:** the packaged component-skill template. It is validated, and it is the base for the seeded self-test's template cases.
- **`cad`:**
  - When `enabled: false`, no library file is read, and the run prints `SKIP: pin-asset check not performed: cad disabled`.
  - When enabled, every pin map's `symbol` must exist as a `(symbol "NAME"` block in one of `symbolLibraries`, and its `footprint` must exist as `<footprint>.kicad_mod` in one of `footprintDirs`. The first match in list order wins.
  - Symbol pins and footprint pads must equal the pin map's pins.
  - `requirePinEqualsPad` must be `true` in contract v1.
- **`integration`:**
  - `rules.json` is `{schema_version, rules: []}`.
  - Every rule that carries an `evidence_chain` gets its chain checked.
  - Whether a chain rule is mandatory, and which domains and verdicts are allowed, is project policy.
  - `forwardTests` is `{schema_version, cases: [], negative_routes?: []}`. When it has cases, the observed runs are read from `observed-runs.json` in the same directory. Zero cases print `SKIP: forward tests: 0 cases (...)`.
  - The integration skill name, used for the expected trigger skill and the `/skill` invocation, is the basename of `integrationSkillDir`. It defaults to `circuit-spec-integration`.
- **`policy.path`:**
  - The file is `{schema_version, <checkKey>: <value>, ...}`.
  - Each key dispatches to the check registered under that key in `policy.POLICY_CHECKS`, and an unknown key fails.
  - The one registered key is `checks`: a list of typed checks (`pin-locks`, `critical-fact-review`, `refresh-evidence`, `integration`, `seeded-fixtures`). `circuit_evidence/policy/checks.py` documents the schema; an unknown check type fails.
  - Paths inside the policy file are relative to `projectRoot` and must stay inside it.
- **`online`:** used only with `--online` or `--refresh-source`.
  - Downloads go to a fresh subdirectory of `tempRoot`, which is created if needed and emptied afterwards.
  - `userAgent` goes into the request `User-Agent`.
  - With `skipVolatileInAll`, `--online` skips VOLATILE-HTML sources and prints `SKIP: <id> volatile source not hash-refreshable`. `--refresh-source <volatile id>` still fails.
- **`output.json`:** same as `--json`: one JSON object `{status, scope, skip, warn, lines, offline, refreshed, message?}` on stdout.

The seeded self-test and `contract/schema.json` are package data, located next to the Python package. They are not configured here.

## Check order and output

The checks run in this order:

1. skill frontmatter
2. template
3. seeded self-test
4. local bundles + placeholder leak
5. inventory provider
6. routing
7. CAD pin assets
8. integration
9. policy
10. then the optional online refresh

Output is the `SCOPE:` lines, then the `SKIP:` lines, then the `WARN:` lines, then `PASS: component-spec contract; <N> lines; offline=<bool>; refreshed=<none|all|id,...>` with exit 0. Any error, of any exception type, prints `FAIL: <message>` on stderr with exit 1 and no traceback. Usage errors exit 2.
