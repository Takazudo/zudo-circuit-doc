# zudo-circuit-doc

Build a circuit project whose decisions, component evidence and open questions stay visible in
its documentation.

**Documentation: <https://zudo-circuit-doc.zudolab.dev/>**

[![npm: @takazudo/zudo-circuit-doc](https://img.shields.io/npm/v/@takazudo/zudo-circuit-doc?label=%40takazudo%2Fzudo-circuit-doc)](https://www.npmjs.com/package/@takazudo/zudo-circuit-doc)
[![npm: create-zudo-circuit-doc](https://img.shields.io/npm/v/create-zudo-circuit-doc?label=create-zudo-circuit-doc)](https://www.npmjs.com/package/create-zudo-circuit-doc)

zudo-circuit-doc has two parts, following the same initializer/runtime split as
[zudo-sg](https://github.com/Takazudo/zudo-sg):

- **[`create-zudo-circuit-doc`](https://www.npmjs.com/package/create-zudo-circuit-doc)** creates a new circuit project.
- **[`@takazudo/zudo-circuit-doc`](https://www.npmjs.com/package/@takazudo/zudo-circuit-doc)** is the runtime the project depends on: its commands, evidence checks and component pages.

A new project opens as useful documentation before it contains any component, board, KiCad file
or firmware. It gives you a project brief, an agent workflow, an initially empty component
catalog, and commands to validate evidence (datasheets, facts, CAD assets, design decisions) and
regenerate the site. The generated site runs on [zudo-doc](https://github.com/zudolab/zudo-doc).

## Quick start

You need Node.js 24 LTS, pnpm through Corepack, and Python 3.10 or newer
([requirements](https://zudo-circuit-doc.zudolab.dev/docs/getting-started/requirements/)).

```sh
pnpm create zudo-circuit-doc my-circuit
cd my-circuit
pnpm circuit:doctor   # check the toolchain
pnpm dev              # open the project's documentation site
```

Then [begin your first task](https://zudo-circuit-doc.zudolab.dev/docs/getting-started/first-task/):
write the project brief, and add a component once you know its exact part number.

## Documentation

- [Getting Started](https://zudo-circuit-doc.zudolab.dev/docs/getting-started/): create a project and run it for the first time
- [Concepts](https://zudo-circuit-doc.zudolab.dev/docs/concepts/): the evidence, publication, CAD and file-ownership rules
- [Workflows](https://zudo-circuit-doc.zudolab.dev/docs/workflows/): the tasks an agent carries out in a generated project
- [Reference](https://zudo-circuit-doc.zudolab.dev/docs/reference/): commands, configuration, schemas and generated files
- [Changelog](https://zudo-circuit-doc.zudolab.dev/docs/changelog/)

## Developing this repository

This is the monorepo that builds both packages.

```
packages/
  circuit-doc/               @takazudo/zudo-circuit-doc — the runtime package
  create-zudo-circuit-doc/   the initializer CLI
examples/                    fixture hosts consumed by CI
fixtures/                    pinned regression corpora, not workspace members
doc/                         the documentation site above (zudo-doc)
```

- `corepack pnpm install` — install dependencies
- `pnpm build` — build every package
- `pnpm typecheck` — typecheck every package
- `pnpm test` — run the TypeScript and Python test suites
- `pnpm doc:build` — build the documentation site

See [CLAUDE.md](./CLAUDE.md) for the full development guide, and [dev-docs/](./dev-docs) for
publishing, site deployment and design decisions.

## License

MIT. See [LICENSE](./LICENSE).
