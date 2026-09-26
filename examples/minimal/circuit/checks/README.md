# Checks

What each project check establishes, and what it does not. Report a check's actual output, including its `SCOPE:`, `SKIP:` and `WARN:` lines; never summarize a skipped check as passed.

| Command | Establishes | Does not establish |
| --- | --- | --- |
| `pnpm circuit:check` | The evidence bundles, inventory, routing, integration rules and (when CAD is enabled) pin assets satisfy the v1 contract; the package's seeded self-test still detects known mutations | That any electrical claim is correct for the design, that a source was read correctly, or that declared placements match a schematic (see the `SCOPE:` line) |
| `pnpm circuit:generate` | Generated component pages and `circuit/generated/preflight.json` reflect the current evidence and selection | That the evidence is current with its remote sources |
| `pnpm check` | Validation passes, committed generated output matches a dry-run generation (drift and ownership conflicts), selected models and footprint previews match their inputs, the doc site type-checks | Anything about the built HTML |
| `pnpm build` then `pnpm check:site` | The built site references only files that exist, publishes nothing outside the selection and the assets allowlist, and has no broken links or anchors | Visual rendering or island behavior in a browser |
| `pnpm exec zudo-circuit-doc check-browser` | Islands hydrate and the built pages behave in system Chrome | Anything when it exits `4` (Chrome missing: not run) |
| `pnpm exec zudo-circuit-doc validate --online` | Retained non-volatile source hashes still match the bytes the URLs serve today | That the documents support the recorded claims; it never alters retained evidence |
| `pnpm previews:generate`, `pnpm exec zudo-circuit-doc footprints check` | Footprint SVG previews are rendered from, and match, the selected footprints | Dimensional correctness or pin correspondence; a preview is a rendering |
| `pnpm circuit:doctor` | Which required and optional tools are present | That any check passes |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Pass |
| `1` | Check failed |
| `2` | Usage or configuration error |
| `4` | Not run: an optional tool (Docker, Chrome) is missing |

## What no check establishes

`COVERED` coverage, a clean validation and a green build are not hardware sign-off. Physical fit, assembled state, programmed state and bench behavior are established only by recorded observations (Workflow F in [WORKFLOW.md](../WORKFLOW.md)).
