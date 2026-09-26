# create-zudo-circuit-doc

Scaffolds a new [zudo-circuit-doc](https://github.com/Takazudo/zudo-circuit-doc) project: a zudo-doc-based circuit-development initializer that opens as useful documentation before any component, board, KiCad file or firmware exists.

**Status:** under construction. See the implementation epic: https://github.com/Takazudo/zudo-circuit-doc/issues/1

## Usage

```
npm create zudo-circuit-doc@latest [destination]
# or, in this monorepo:
pnpm create zudo-circuit-doc [destination]
```

If `destination` is omitted, the CLI prompts for one on an interactive terminal; on a non-interactive session, or with `--yes`, a missing destination is an error.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `[destination]` | prompted | Directory to create. Must not exist, or must be empty. Spaces are allowed. |
| `--name <npm-name>` | `destination`'s basename | The generated `package.json` name (npm grammar, 1-214 chars, no `node_modules`). |
| `--title <site title>` | title-cased `--name` | The site title. 1-80 printable characters, excluding `" ' \` \\ $ < > { }` and control characters — it is substituted into TS string literals and MDX frontmatter. |
| `--library <kicad-lib-name>` | `--name` | The KiCad library name (`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`). |
| `--agent claude\|codex\|both\|none` | `both` | Which thin agent-entry file(s) to keep: `claude` keeps `CLAUDE.md`, `codex` keeps `AGENTS.md`, `both` keeps both, `none` keeps neither. `.claude/skills/**` is always kept — it is the evidence storage (ADR-006). |
| `--yes`, `-y` | off | Never prompt; a missing destination is an error. |
| `--install` / `--no-install` | `--install` | Run `pnpm install` in the destination after scaffolding. |
| `--git` / `--no-git` | `--git` | Run `git init -b main` and commit the scaffold. Skipped with a note if the destination is already inside a git work tree. |
| `--help`, `-h` | | Print usage and exit. |
| `--version`, `-v` | | Print the installed version and exit. |

There is no force flag: if the destination exists and is not empty, the command reports the collision, exits with status 1, and leaves the destination byte-for-byte unchanged.

## What is generated

The scaffold composes the project atomically (via a staging directory renamed into place, so the destination is never partially written) from the package's own `templates/default`. Its full contents are the epic's **Generated project contract** (https://github.com/Takazudo/zudo-circuit-doc/issues/1), summarized here:

- Root: `package.json`, `pnpm-workspace.yaml`, `circuit.config.ts`, `README.md`, `CLAUDE.md`/`AGENTS.md` (per `--agent`), `.gitignore`, `ZUDO_DEPS_PINS.md`.
- `circuit/`: the canonical agent workflow (`WORKFLOW.md`, A-G), authoring templates, checks, and empty publication/preflight records.
- `.claude/skills/`: `component-spec-audit` and `circuit-spec-integration`, the evidence-storage skill bundles.
- `doc/`: a zudo-doc app — route stub, chrome-bindings shim, and `zfb.config.ts`.

After scaffolding, the printed **Next steps** give the exact commands to run (`cd`, `pnpm install` if it did not already run, `pnpm circuit:doctor`, `pnpm dev`), plus a pointer to `circuit/WORKFLOW.md` for the first task.

## Create-only semantics

This tool only creates new projects. There is no `update` or "adopt an existing directory" mode — running it again against the same non-empty destination is a collision, not a merge or an upgrade.

## Tool requirements

- Node >=22.18.0
- pnpm (via corepack; the generated project pins `packageManager`)
- git, if `--git` is not disabled

## License

MIT. See [LICENSE](./LICENSE).
