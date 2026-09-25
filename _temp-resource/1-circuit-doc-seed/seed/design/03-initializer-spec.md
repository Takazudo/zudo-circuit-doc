# Initializer specification

Everything in this file describes the **proposed** product contract. These commands do not exist in the inspected zudo-circuit-doc repository.

## CLI design

Proposed usage after a verified release:

```sh
pnpm create zudo-circuit-doc my-circuit
```

Proposed deterministic fixture/local build invocation:

```sh
create-zudo-circuit-doc ./my-circuit --name my-circuit --yes --no-install --no-git
```

The implementation should distinguish destination path, npm-safe project name, site title and library namespace. Validate them separately. Display the resolved plan before any long installation. If a target already contains files, report the collision and exit without altering it; a future adoption command can handle existing projects explicitly.

| Option | Intended behavior |
| --- | --- |
| Destination | Output path; resolve consistently before writing |
| `--name` | Package/project identifier; validate separately from path |
| `--title` | Human-readable site title |
| `--yes` | Use documented initialization defaults |
| `--no-install` | Write files without dependency installation |
| `--no-git` | Do not create a repository or commit |
| `--agent claude\|codex\|both\|none` | Thin entry points into a canonical project workflow |
| `--help`, `--version` | Documentation and version taken from actual package metadata |

Optional flags beyond the small initial set should wait until they have a useful fixture. Do not add a force-overwrite option as a shortcut to update support.

## Composing zudo-doc correctly

The inspected create-zudo-doc exposes a `createZudoDoc()` API, with installation and git defaults false in that API. Its `CreateOptions` uses `projectName` as the output-directory name and has **no separate destination property**. The CLI separately supports destination and name behavior. Do not invent an API argument to solve that mismatch. [API](https://github.com/zudolab/zudo-doc/blob/6a10f764181cd9f73059d4bf523e3673983859d8/packages/create-zudo-doc/src/api.ts).

Choose and validate one implementation strategy:

1. Use the actual API in a controlled target-parent directory, respecting its real path/name semantics; or
2. Invoke the installed initializer CLI with an argument array in a staging location; or
3. Maintain a synchronized template following zudo-sg, with an explicit upstream scaffold pin and a refresh process.

The architecture audit explains the tradeoffs. Staging should prevent a partial failure from leaving an apparently initialized directory. It should not install dependencies or initialize git until composition succeeds.

## Default generated project

| Path | Contents |
| --- | --- |
| `README.md` | Commands and the first circuit task |
| `package.json`, `pnpm-workspace.yaml` | Root scripts and doc workspace |
| `circuit.config.ts` | Paths, evidence/inventory provider, boards, libraries, selected capabilities |
| `circuit/WORKFLOW.md` | Canonical working instructions |
| `circuit/publication/` | Empty reviewed record/source/model selections |
| `circuit/checks/` | Project-specific fixtures as needed; empty initially |
| `.claude/skills/component-spec-audit/` | v1 provider data/entry point with empty inventory, no copied lamp record list |
| `.claude/skills/circuit-spec-integration/` | Empty project integration rules and entry point |
| `AGENTS.md`, `CLAUDE.md` | Selected tool entry files linking canonical workflow |
| `doc/` | zudo-doc application with circuit runtime integration |
| `doc/src/content/docs/` | Authored project pages and owned generated component tree |
| `boards/`, `symbols/`, `footprints/` | Created only when useful; no fictional KiCad project |
| `.circuit-cache/` | Ignored optional downloads/intermediate research artifacts |
| `manufacturing/` | Created by an explicit export task, not prefilled |

The supplied [config draft](../templates/circuit.config.proposed.ts) is an inspectable design artifact with no import from a nonexistent package. It is not a validated runtime config.

## Empty-state contract

A successful empty project displays:

- a project brief with questions to answer;
- an authored architecture page with no fictional electrical values;
- an empty component catalog explaining the next task;
- no published raw source or model asset;
- no fake selected component, source hash or PASS verdict;
- no required KiCad, Docker, EasyEDA or manufacturer credential for ordinary docs build.

It must still reject malformed config, missing declared files, stale selected IDs and malformed evidence. An absent inventory is different from an explicitly empty inventory. A selected missing model is different from selecting no models.

The provided empty inventory matches the upstream v1 shape. It does **not** make the unchanged LED CLI work: generic provider extraction remains necessary. See [empty data notes](../templates/empty-data/README.md).

## Proposed command ownership

| Proposed command | Function |
| --- | --- |
| `pnpm dev` | Generate/check retained docs state, then host + watcher |
| `pnpm build` | Offline validation, selected preview freshness, generation, site build |
| `pnpm check` | Config/evidence/generated output and relevant reference checks |
| `pnpm circuit:check` | Canonical evidence/integration validation |
| `pnpm circuit:generate` | Project retained evidence into docs |
| `pnpm circuit:doctor` | Explain missing optional/required tools and version/config problems |

“Fetch datasheet” and “obtain model” are agent workflows first. A later helper may automate provider-specific retrieval, but do not fabricate a universal one-command provider API. Failed retrieval should produce a useful evidence state and report.

In the LED source, commands such as `generate:components`, `check:components`, `generate:models`, `check:models`, `generate:footprint-previews`, `check:footprint-previews`, `scan:artifacts` and `test:components` already exist under `doc/`. Preserve their real responsibilities while selecting a smaller public command surface. [package.json](https://github.com/Takazudo/zudo-led-lamp/blob/194d8a297e3545588197342130c3111a66c10973/doc/package.json).

## Host template defaults

Use five or six navigable project sections, with task-driven pages. Keep generated component pages visually distinct from authored architecture/research. Make locale choice and project title explicit. The source template may be English while accepting Japanese project content.

Keep deployment provider optional. The lamp's Cloudflare custom domain, workflow secrets and deployment account are not reusable defaults. Do not copy project-specific dependency pins as proof that future package versions are mutually compatible: choose the family of zudo-doc/zfb versions actually tested during implementation.

## Initializer packaging tests

Pack the initializer and runtime. Install them into a temporary directory outside the monorepo. Exercise destination paths containing spaces, separate `--name`, noninteractive defaults, a pre-existing destination, missing optional tools and an interrupted install. Check emitted dependencies, package assets, template permissions, version output and directory ownership.

The initializer should print exact next commands valid for the generated project. It should never print successful setup before composition and the selected install step finish.
