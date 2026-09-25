import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Reads the package version from package.json at runtime, resolved relative
 * to `baseUrl` (pass `import.meta.url` from src or dist — both sit one
 * directory below the package root, spec #9).
 */
export function readPackageVersion(baseUrl: string | URL): string {
  const packageJsonUrl = new URL("../package.json", baseUrl);
  const contents = readFileSync(fileURLToPath(packageJsonUrl), "utf8");
  const pkg = JSON.parse(contents) as { version: string };
  return pkg.version;
}
