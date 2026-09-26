/**
 * The vocabulary `check-browser` (#27) shares across its modules.
 *
 * A `Representative` is deliberately the same shape as
 * `config/define.ts`'s `BrowserSmokeRepresentativeConfig` (`{kind, path, slug,
 * identity, availability?}`) — a project names its own pages here, never this
 * package. `--representatives <json>` accepts the same `{representatives:
 * [...]}` shape the config key does, so a fixture (or CI) can point at a JSON
 * file instead of editing `circuit.config.ts`.
 */

export type Representative = {
  readonly kind: string;
  /** Site route, e.g. `/docs/components/records/<slug>/`. */
  readonly path: string;
  readonly slug: string;
  readonly identity: string;
  readonly availability?: string;
};

/** Everything a single run needs; every LED-only value from the pinned upstream script lives here now. */
export type BrowserSmokeOptions = {
  readonly distRoot: string;
  readonly representatives: readonly Representative[];
  /** The catalog (or equivalent "away") route, used by the SPA dispose/remount check. Defaults to `CATALOG_ROUTE`. */
  readonly awayRoute: string;
  readonly chromeBin: string;
  readonly shellAssertions: boolean;
  readonly searchAssertions: boolean;
  /** Absolute path to the generated MDX tree (`docs.generatedContent`); required only when `searchAssertions` is set. */
  readonly generatedRoot: string | undefined;
};

export type BrowserSmokeReport = {
  readonly lines: readonly string[];
};
