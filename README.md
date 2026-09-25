# zudo-circuit-doc

A circuit-development project initializer powered by [zudo-doc](https://github.com/zudolab/zudo-doc).

It follows the same initializer/runtime split as [zudo-sg](https://github.com/Takazudo/zudo-sg):

- **`create-zudo-circuit-doc`** creates a new circuit project.
- **`@takazudo/zudo-circuit-doc`** is the runtime package the project depends on.

A new project opens as useful documentation before it contains any component, board, KiCad file or firmware. It carries one canonical agent workflow for exact-component evidence: datasheets, facts, CAD assets, and design decisions.

**Status:** under construction. See the implementation epic: https://github.com/Takazudo/zudo-circuit-doc/issues/1

## Monorepo layout

```
packages/
  circuit-doc/               @takazudo/zudo-circuit-doc — the runtime package
  create-zudo-circuit-doc/   the initializer CLI
examples/                    fixture hosts consumed by CI (added by later sub-issues)
fixtures/                    pinned regression corpora, not workspace members
doc/                         this project's own zudo-doc documentation site
```

See [CLAUDE.md](./CLAUDE.md) for the full development guide.

## Commands

- `corepack pnpm install` — install dependencies
- `pnpm build` — build every runtime package
- `pnpm typecheck` — typecheck every runtime package
- `pnpm test` — run the TypeScript and Python test suites
- `pnpm doc:build` — build this repo's own documentation site

## License

MIT. See [LICENSE](./LICENSE).
