# CLAUDE.md — zudo-circuit-doc monorepo

Development guide for agents working in this repository. This is the **monorepo** that builds `create-zudo-circuit-doc` and `@takazudo/zudo-circuit-doc`; it is not a generated circuit project (see `circuit/WORKFLOW.md` inside a *generated* project for that agent workflow).

## Layout

```
packages/
  circuit-doc/               @takazudo/zudo-circuit-doc — the runtime package
  create-zudo-circuit-doc/   the initializer CLI
examples/                    fixture hosts consumed by CI (empty, minimal)
fixtures/led/                pinned zudo-led-lamp regression corpus (not a workspace member)
doc/                         this project's own zudo-doc documentation site
_temp-resource/               planning-only resources for the current epic (see below)
```

## File ownership ("Owns")

This repo is built by parallel `/x-wt-teams` sub-issues, each of which lists the files it **Owns** in the epic (https://github.com/Takazudo/zudo-circuit-doc/issues/1). Do not edit a file owned by a different sub-issue's scope without checking that issue first — shared manifests (root `package.json` scripts, the runtime package's `exports`/`bin`/`files`, workspace globs) are pre-created once and later issues only fill in their own targets, never rename entries.

## Commands

- `corepack pnpm install` — install dependencies (pnpm version comes from `packageManager`)
- `pnpm build` — build every package under `packages/*`
- `pnpm typecheck` — typecheck every package under `packages/*`
- `pnpm test` — run the TypeScript and Python test suites (`test:ts` + `test:python`)
- `pnpm doc:build` — build this repo's own documentation site (`doc/`)

Later sub-issues add scripts for the LED fixture, template sync, packed-consumer verification and acceptance scenarios — see the root `package.json` `scripts` table, which is pre-created in full even before every target file exists.

## Heavy runs

Heavy or port-based commands (full monorepo build, packed-consumer verify, browser smoke, Docker KiCad previews) go through the shared queue/memory gate:

```
bash $HOME/.claude/scripts/heavy-guard.sh -- <command>
```

Exit 75 means machine contention — retry later, it is not a test failure.

## Never edit

- The pinned upstream clones referenced by the epic (zudo-led-lamp, zudo-sg, zudo-doc) — read them by SHA, never check out, install or build inside them.
- Bytes under `fixtures/led/upstream/**` — this is a hash-locked regression corpus. Intentional output differences go in `fixtures/led/expected/` with `EXPECTED-CHANGES.md`.

## `_temp-resource/`

`_temp-resource/1-circuit-doc-seed/` holds the research seed and planning artifacts for the current epic (issues #1–#34). It is planning-only, excluded from lint/format/test globs, and deleted by the epic's last sub-issue (#34) before the root PR merges. Do not treat it as part of the shipped product.

## Version family (ADR-003)

The dependency versions below are exact-pinned across the whole repo — do not drift them individually:

| Package | Version |
| --- | --- |
| `@takazudo/zudo-doc` | 5.27.0 |
| `@takazudo/zfb`, `@takazudo/zfb-runtime`, `@takazudo/zfb-md-wasm` | 2.21.0 |
| pnpm (`packageManager`, via corepack) | 11.5.2 |
| Node | >=22.18.0 |
| Python | >=3.10 (stdlib only) |

**Fallback rule:** if the M1 host or island hydration fails on zfb 2.21.0 but passes on 2.20.3, pin 2.20.3 across the family and file an upstream report with `/dev-upstream-report`.

## Node type stripping

On Node 22/24, native TypeScript type stripping prints an `ExperimentalWarning` to stderr. Tests must not assert that stderr is empty when they spawn a `node --experimental-strip-types` process.
