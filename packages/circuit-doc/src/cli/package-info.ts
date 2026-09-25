/** The package's own `package.json`, read at runtime (same depth from `src/cli/` and `dist/cli/`). */

import { readFileSync } from "node:fs";

export type PackageInfo = {
  readonly name: string;
  readonly version: string;
  readonly engines: { readonly node?: string };
};

let cached: PackageInfo | undefined;

export function packageInfo(): PackageInfo {
  cached ??= JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as PackageInfo;
  return cached;
}
