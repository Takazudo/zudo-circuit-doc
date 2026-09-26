/**
 * The public-scope check (ADR-018, epic #1).
 *
 * `docs.publicRoot` (`doc/public`) is served verbatim by zudo-doc — every file
 * under it is reachable at its raw URL whether or not any page links to it, and
 * whether or not `assetViewerExclude` hides it from the asset viewer index.
 * `assetViewerExclude` is a **visibility** setting for the generated viewer
 * pages; it does not withdraw the file from the public web server. So the only
 * check that actually enforces "raw evidence and CAD files are not public" is
 * a filesystem walk of what got copied there, independent of what zudo-doc's
 * asset viewer chooses to list.
 *
 * Two escapes, both deliberate and both auditable:
 *   - `assets/component-previews/**` — this feature's own generated output
 *     (footprint SVGs, WRL previews, the preview manifest). The generator
 *     decides what goes there; nothing hand-authored belongs in it.
 *   - `circuit/publication/assets.json` — the deliberate-publication allowlist
 *     (ADR-018). Every entry carries a `reason` (enforced by `config/map.ts`
 *     when the file is read), so a reviewer sees WHY a raw file is public.
 */

import { readdir } from "node:fs/promises";
import { join, relative, extname, sep } from "node:path";

import { fail } from "../core/errors.ts";
import type { PublicationAssets } from "../config/map.ts";

/**
 * Raw evidence/CAD file types that must never be reachable under
 * `docs.publicRoot` without an explicit reason. `.json` covers a raw evidence
 * bundle (there is no legitimate reason to hand-place one under the public
 * root — the generator's own JSON there is the preview manifest, which lives
 * under the exempt `component-previews` root). `.svg`/`.wrl` are the
 * generator's own preview formats — exempt under `component-previews`, but
 * anywhere else on the public root they are exactly as unreviewed as any other
 * restricted type.
 */
export const RESTRICTED_PUBLIC_EXTENSIONS: readonly string[] = [
  ".pdf",
  ".step",
  ".stp",
  ".kicad_mod",
  ".kicad_sym",
  ".kicad_pcb",
  ".kicad_sch",
  ".zip",
  ".7z",
  ".json",
  ".wrl",
  ".svg",
];

/** Relative to `docs.publicRoot`; this whole subtree is generator-owned. */
export const COMPONENT_PREVIEWS_PREFIX = "assets/component-previews/";

/** Only the preview generator's own output formats are exempt under the preview root. */
const GENERATED_PREVIEW_EXTENSIONS: readonly string[] = [".svg", ".wrl"];
const GENERATED_PREVIEW_MANIFEST = `${COMPONENT_PREVIEWS_PREFIX}footprints/manifest.json`;

function isGeneratedPreviewAsset(relPath: string): boolean {
  if (!relPath.startsWith(COMPONENT_PREVIEWS_PREFIX)) return false;
  return relPath === GENERATED_PREVIEW_MANIFEST || GENERATED_PREVIEW_EXTENSIONS.includes(extname(relPath).toLowerCase());
}

export type PublicScopeViolation = {
  readonly path: string;
  readonly reason: string;
};

/**
 * Walk `publicRoot` and report every restricted file that is neither under the
 * generator-owned preview root nor listed in the allowlist. Throws
 * `PUBLICATION_POLICY` on the first pass with anything found — the message
 * lists every offender, not just the first.
 */
export async function checkPublicScope(input: {
  readonly publicRoot: string;
  readonly assets: PublicationAssets;
}): Promise<readonly string[]> {
  const violations = await findPublicScopeViolations(input.publicRoot, input.assets);
  if (violations.length > 0) {
    fail(
      "PUBLICATION_POLICY",
      `${violations.length} raw evidence/CAD file(s) are publicly reachable under docs.publicRoot ` +
        "(assetViewerExclude hides a file from the asset viewer index, it does not make the file private)",
      { offenders: violations.map((entry) => `${entry.path}: ${entry.reason}`).slice(0, 20) },
    );
  }
  return violations.map((entry) => entry.path);
}

export async function findPublicScopeViolations(
  publicRoot: string,
  assets: PublicationAssets,
): Promise<readonly PublicScopeViolation[]> {
  const allowlist = new Set(assets.assets.map((entry) => entry.path));
  const violations: PublicScopeViolation[] = [];

  const walk = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((left, right) => (left.name < right.name ? -1 : 1))) {
      const path = join(directory, entry.name);
      const relPath = relative(publicRoot, path).split(sep).join("/");
      if (entry.isSymbolicLink()) {
        violations.push({ path: relPath, reason: "symlinked path under docs.publicRoot is not allowed" });
        continue;
      }
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!RESTRICTED_PUBLIC_EXTENSIONS.includes(extname(entry.name).toLowerCase())) continue;
      if (isGeneratedPreviewAsset(relPath)) continue;
      if (allowlist.has(relPath)) continue;
      violations.push({
        path: relPath,
        reason: "not under assets/component-previews/ and not listed in publication.assets",
      });
    }
  };

  await walk(publicRoot);
  return violations;
}
