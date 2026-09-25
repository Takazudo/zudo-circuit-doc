# Planning resources for the Circuit Doc v0.1 epic (temporary)

This directory hands planning material from the `/big-plan` session to the implementation sessions through git. It is **temporary**: sub-issue T31 deletes it before the root PR merges. Durable knowledge moves into `doc/`, via the design records (T03), the docs (T24) and the release pages (T31).

Tooling must ignore this directory. Keep it out of every lint, format, typecheck and test glob.

## Contents

| Path | What | Use |
| --- | --- | --- |
| `seed/` | The research seed `zudo-circuit-doc-seed-2026-09-26.zip`, prepared with ChatGPT for this project: `START-HERE.md`, `design/01–07`, `research/*` (4 reports + source manifests), `templates/*` (10 authoring MDX pages, WORKFLOW draft, config draft, empty-data seeds, bilingual task examples), `examples/led-lessons.md`, `sources/*`. | Primary requirements and content source. |
| `planning/explore/*.md` | File:line extraction maps from 7 parallel read-only explorers: `led-engine`, `led-validator`, `led-ui-cad`, `sg-pattern`, `zudo-doc-host`, `led-fixture-ci`, `test-part`. | Exact upstream locations, couplings, and verified facts. |
| `planning/prototypes/` | Proven-in-planning artifacts: see the list below. | Starting points; re-verify before relying on them. |
| `planning/zudo-doc-probe/` | Real `create-zudo-doc@5.27.0 --yes --lang en --no-install --no-git --pm pnpm` output (`app/`, without node_modules or dist), the island-through-chromeBindingsModule probe (`app-island/`, `fakepkg/`), the `createZudoDoc()` API probe (`apiprobe/`), and the `--help` text. | Host scaffold baseline (T01, T20, T22). |

The `planning/prototypes/` artifacts:
- the NA-blocking + resolver fix diff (`resolver-and-na-fix.diff`)
- the emit ownership repro (`emit-gap.ts`)
- the empty-pipeline repro (`empty-pipeline.ts`)
- the validator probes (`probe_empty.py`, `probe_na.py`)
- the LED fixture lock prototype (`make-led-lock.mjs`, `led-fixture.lock.json`, `led-min-paths.txt`)
- the verified TMP1075DR facts (`tmp1075-probe.json`)

## Provenance and deliberate omissions

- The seed's `references/upstream/*.source` copies (174 files) are **not** included. Read the real upstream repositories at the pinned commits instead:
  - zudo-led-lamp `194d8a297e3545588197342130c3111a66c10973`
  - zudo-sg `b9b36ce35d98d6abc641d84e8535552eac0dbded`
  - zudo-doc `6a10f764181cd9f73059d4bf523e3673983859d8`

  The seed's research reports still link to those pinned GitHub permalinks. Relative links into `references/upstream/` are broken on purpose.
- The TMP1075 datasheet PDF, its page-text dumps, distributor HTML pages and the downloaded KiCad files are **not** included. T23 and T27 re-acquire them as part of the real workflow, with receipts.
- Machine-specific paths were normalized: `$HOME/repos/...` for local clones, and `<planning-session>`/`<planning-scratch>` for the planning scratch space. Paths shown under `<planning-scratch>` do not exist on your machine.
