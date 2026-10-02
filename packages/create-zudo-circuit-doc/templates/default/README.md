# __SITE_TITLE__

A circuit-development project documented with [zudo-circuit-doc](https://github.com/Takazudo/zudo-circuit-doc) on top of [zudo-doc](https://github.com/zudolab/zudo-doc).

It keeps two kinds of knowledge side by side:

- **Authored documentation** under `doc/src/content/docs/`: the project brief, architecture, research, decisions, verification plans and the next-actions handoff.
- **Exact-component evidence** under `.claude/skills/`: one owner bundle per exact component, with sources, facts, verdicts, coverage and pin maps. The component pages under `/docs/components/` are generated from it and never edited by hand.

The project starts empty on purpose: no component, board, CAD file or firmware is preselected, and nothing is marked verified. The site builds and explains what to do next.

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

## Your first circuit task

1. Run `pnpm install`, `pnpm circuit:doctor` and `pnpm dev`, and open the site.
2. Describe the idea to your agent in a sentence or two and ask it to fill the project brief. It follows Workflow A in [circuit/WORKFLOW.md](circuit/WORKFLOW.md): the brief, a first architecture overview and the next actions, with unknowns left as unknowns.
3. When you know the first exact part, ask for it by manufacturer and full part number, for example "add this part and download its datasheet". More short requests, in English and Japanese, are in [circuit/agent-task-examples.md](circuit/agent-task-examples.md).

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
