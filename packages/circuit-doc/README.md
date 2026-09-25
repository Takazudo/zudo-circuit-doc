# @takazudo/zudo-circuit-doc

The runtime package for `create-zudo-circuit-doc` projects: a circuit-development component-evidence engine built on [zudo-doc](https://github.com/zudolab/zudo-doc).

**Status:** under construction. See the implementation epic: https://github.com/Takazudo/zudo-circuit-doc/issues/1

## Entry points

| Import | Purpose |
| --- | --- |
| `@takazudo/zudo-circuit-doc` | core |
| `@takazudo/zudo-circuit-doc/config` | `circuit.config.ts` types |
| `@takazudo/zudo-circuit-doc/ui` | MDX UI components |
| `@takazudo/zudo-circuit-doc/mdx-extras` | zfb `mdxExtras` seam |
| `@takazudo/zudo-circuit-doc/islands` | hydration islands seed |
| `@takazudo/zudo-circuit-doc/descriptors` | evidence descriptors |
| `@takazudo/zudo-circuit-doc/styles.css` | package styles |

The CLI is exposed as the `zudo-circuit-doc` binary.

## Build output

`pnpm build` emits to `lib/`, not the conventional `dist/` — zfb 2.21.0's workspace-package
staging hard-prunes any directory named `dist` from workspace packages
([zudo-front-builder#3154](https://github.com/Takazudo/zudo-front-builder/issues/3154)).

## License

MIT. See [LICENSE](./LICENSE).
