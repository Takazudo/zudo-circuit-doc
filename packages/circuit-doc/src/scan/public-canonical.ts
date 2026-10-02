/** SITE-only exemptions backed by canonical bytes and the manifest actually published in dist. */
import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";

import { ComponentDocsError, fail } from "../core/errors.ts";
import type { Canary } from "../core/scan.ts";
import { FOOTPRINT_ASSET_BASE } from "../core/site.ts";
import type { PublicViewModel } from "../core/view-model.ts";
import { sha256 } from "../footprint-previews/hash.ts";
import { PREVIEW_FORMAT_VERSION } from "../footprint-previews/manifest.ts";
import type { CircuitProjectPaths } from "../provider/v1/paths.ts";
import { assertPathWithinBase } from "../provider/v1/references.ts";

export type PublicCanonicalHash = {
  readonly footprintName: string;
  readonly footprintPath: string;
  readonly sha256: string;
};

type Input = {
  readonly declared: readonly string[];
  readonly model: PublicViewModel;
  // distRoot is independent of the source preview root: docs.dist is configurable.
  readonly paths: Pick<
    CircuitProjectPaths,
    "projectRoot" | "footprintLibraryRoot" | "footprintPreviewRoot" | "distRoot"
  >;
};

async function containedBytes(root: string, name: string, projectRoot?: string): Promise<Buffer> {
  const path = join(root, name);
  try {
    const canonicalRoot = await realpath(root);
    const canonicalFile = await realpath(path);
    assertPathWithinBase(
      canonicalRoot, canonicalFile, "PATH_CONTAINMENT",
      "public canonical asset escapes its allowed root", { path },
    );
    if (projectRoot !== undefined) {
      assertPathWithinBase(
        await realpath(projectRoot), canonicalFile, "PATH_CONTAINMENT",
        "public canonical asset escapes the project root", { path },
      );
    }
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail("PATH_CONTAINMENT", "public canonical asset must be a regular non-symlink file", { path });
    }
    return await readFile(canonicalFile);
  } catch (error) {
    if (error instanceof ComponentDocsError) throw error;
    fail("PUBLICATION_POLICY", "public canonical asset is missing or unreadable", {
      path,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function derivePublicCanonicalHashes(
  { declared, model, paths }: Input,
): Promise<readonly PublicCanonicalHash[]> {
  if (declared.length === 0) return [];

  const previews = declared.map((footprintName) => {
    if (
      footprintName === "" || /[/\\\0]/u.test(footprintName) ||
      footprintName === "." || footprintName === ".."
    ) {
      fail("PATH_CONTAINMENT", "public canonical footprint name must be a single filename stem", { footprintName });
    }
    const matches = model.packagePreviews.filter((entry) => entry.footprintName === footprintName);
    const preview = matches[0];
    if (matches.length !== 1 || preview === undefined) {
      fail("PUBLICATION_POLICY", "declared public canonical footprint must identify exactly one published package", {
        footprintName,
        matches: matches.length,
      });
    }
    return preview;
  });

  // zfb copies the public directory verbatim. SITE scans this built copy;
  // trusting a different source manifest would allow stale/altered dist output.
  // docs.dist can live outside the project data root (config.root).
  const manifestBytes = await containedBytes(
    paths.distRoot, `${FOOTPRINT_ASSET_BASE.slice(1)}manifest.json`,
  );
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    fail("PUBLICATION_POLICY", "built public footprint manifest is not valid JSON");
  }
  if (!object(manifest) || manifest.formatVersion !== PREVIEW_FORMAT_VERSION || !Array.isArray(manifest.packages)) {
    fail("PUBLICATION_POLICY", "built public footprint manifest has an invalid format");
  }
  const packages: readonly unknown[] = manifest.packages;
  const hashes: PublicCanonicalHash[] = [];
  for (const preview of previews) {
    const { footprintName, footprintPath } = preview;
    const digest = sha256(await containedBytes(
      paths.footprintLibraryRoot, `${footprintName}.kicad_mod`, paths.projectRoot,
    ));
    const matches = packages.filter((entry) => object(entry) && entry.footprintName === footprintName);
    const entry = matches[0];
    if (
      matches.length !== 1 || !object(entry) ||
      entry.footprintPath !== footprintPath || entry.canonicalInputSha256 !== digest
    ) {
      fail(
        "PUBLICATION_POLICY",
        "built public footprint manifest does not prove the canonical footprint path and digest",
        { footprintName },
      );
    }
    hashes.push({ footprintName, footprintPath, sha256: digest });
  }
  return hashes;
}

/** Only the denied key `sha256` qualifies; equal evidence text remains a canary. */
export function subtractPublicCanonicalHashes(
  canaries: readonly Canary[],
  hashes: readonly PublicCanonicalHash[],
): { kept: Canary[]; withheld: Canary[] } {
  const digests = new Set(hashes.map((hash) => hash.sha256));
  const kept: Canary[] = [];
  const withheld: Canary[] = [];
  for (const canary of canaries) {
    (canary.path.endsWith(".sha256") && digests.has(canary.normalized) ? withheld : kept).push(canary);
  }
  return { kept, withheld };
}
