# Example: TMP1075 I²C temperature breakout

An **example project** for [zudo-circuit-doc](https://github.com/Takazudo/zudo-circuit-doc), documented on top of [zudo-doc](https://github.com/zudolab/zudo-doc). It is a small I²C temperature-sensor breakout with one exact component, **Texas Instruments TMP1075DR** (SOIC-8, TI package D), taken through the workflow in [circuit/WORKFLOW.md](circuit/WORKFLOW.md) the way a user's agent would do it: the brief and architecture (Workflow A), a real datasheet download with a recorded receipt (Workflow C), an owner evidence bundle, inventory line, publication selection and generated record page (Workflow B), and a KiCad symbol, footprint and 3D model with receipts (Workflow D). CAD is enabled, so `pnpm circuit:check` performs the pin-asset check, and the record page shows the footprint preview and the 3D model.

It keeps two kinds of knowledge side by side:

- **Authored documentation** under `doc/src/content/docs/`: the project brief, architecture, research, decisions, verification plans and the next-actions handoff.
- **Exact-component evidence** under `.claude/skills/`: one owner bundle per exact component, with sources, facts, verdicts, coverage and pin maps. The component pages under `/docs/components/` are generated from it and never edited by hand.

The design intent (a breakout for evaluation, powered and read by a host over a four-pin header) is a project choice made for the example, not a manufacturer fact.

## Evidence notes

- **Datasheet.** TI SBOS854F, revision F, "REVISED JUNE 2024", fetched from `https://www.ti.com/lit/ds/symlink/tmp1075.pdf` on 2026-09-26 (HTTP 200, `application/pdf`, starts with `%PDF-`, 49 pages). Its SHA-256 and the per-page locators are in `.claude/skills/component-ti-tmp1075dr/sources.json`. The PDF itself is **not committed**; it lives in the git-ignored `.circuit-cache/sources/` only.
- **TI regenerates this PDF.** The orderable addendum is appended live, so the file's bytes change while the revision stays F. A later hash mismatch at the same revision (for example from `pnpm exec zudo-circuit-doc validate --online`) means "regenerated; re-verify the locators", not corruption. Re-inspect the changed bytes before re-pinning the hash.
- **Generic inventory profile, no LCSC number.** An LCSC listing for TMP1075DR exists (C2878381). It is **deliberately not used**: the inventory line keeps `lcsc: ""` to exercise the generic (non-LCSC) manual profile. The DigiKey order code `296-51833-1-ND` (cut tape) was checked on the DigiKey product page on 2026-09-26 and is display-only supplier metadata; a Mouser code is omitted because it was not verified.
- **CAD assets are generic (fidelity family).** The symbol `TMP1075D` (kicad-symbols `9.0.9`), footprint `SOIC-8_3.9x4.9mm_P1.27mm` (kicad-footprints `9.0.9`) and STEP+WRL pair (kicad-packages3D `8.0.9`, the last tag that ships a WRL) come from the official KiCad libraries, not from TI. The footprint is a generic JEDEC MS-012AA land pattern whose pads differ from TI's example land pattern; that is a recorded project choice. Receipts with URLs, tags and SHA-256 values are in `circuit/cad-receipts/`, the unmodified imports and the two documented derivations in `footprints/vendor/kicad-soic8/`, and the license notes in [NOTICE.md](NOTICE.md). Physical seating, solder fillet and clearance are still `NEEDS BENCH`.
- **Declared, not bound.** The placement `U1` on `sensor-breakout` is declared in the inventory; no schematic exists, and `pnpm circuit:check` says so in its `SCOPE:` line.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm install` | Install dependencies |
| `pnpm dev` | Dev server, regenerating component pages as evidence changes |
| `pnpm build` | Publish selected models, generate component pages, build the site |
| `pnpm check` | Validate evidence, check generated output is current, type-check the site |
| `pnpm check:site` | Post-build checks: references, publication scope, links |
| `pnpm circuit:check` | Validate the component evidence (offline) |
| `pnpm circuit:generate` | Regenerate the component pages and the preflight report |
| `pnpm circuit:doctor` | Report required and optional tools |
| `pnpm previews:generate` | Render footprint previews (optional; needs Docker) |

Agent-facing commands (new component bundles, online source refresh) are listed in [circuit/WORKFLOW.md](circuit/WORKFLOW.md).

## Continuing this example

1. Run `pnpm install`, `pnpm circuit:doctor` and `pnpm dev`, and open the site.
2. Read the project brief and next actions on the site. The next tasks are selecting the exact passives and header, and planning the bring-up measurement.
3. More short requests, in English and Japanese, are in [circuit/agent-task-examples.md](circuit/agent-task-examples.md).

## Tool requirements

| Tool | Required | Used for |
| --- | --- | --- |
| Node.js ≥22.18 | Yes | Everything |
| pnpm 11 (via corepack) | Yes | Install and scripts |
| Python ≥3.10 | Yes | Evidence validation (standard library only) |
| git | Yes | History and review diffs |
| Docker with the pinned KiCad image | No | Footprint previews |
| Chrome | No | Browser smoke check |
| Network | No | Downloading sources and assets only; the build is offline |
| easyeda2kicad | No | Importing CAD assets for LCSC-listed parts |

## Package versions

Both `@takazudo/zudo-circuit-doc` and `create-zudo-circuit-doc` are published on npm. This project depends on `@takazudo/zudo-circuit-doc` through the version range in `package.json`. To upgrade, raise that range and run `pnpm install`.
