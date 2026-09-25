/**
 * Ownership guard for the footprint preview root (issue #20, spec item 4).
 *
 * Upstream replaced its whole preview root unconditionally
 * (`rm -rf PREVIEW_ROOT`). That is safe only because the directory is
 * exclusively generated; as a package, a project could point the config at
 * the wrong directory, so `generate` proves ownership before it deletes
 * anything: the root may contain only `manifest.json` and `*.svg` files, or
 * not exist at all. Anything else fails with the exact list of files it did
 * not expect, instead of deleting them.
 */

import { lstat, readdir } from "node:fs/promises";

import { fail } from "../core/errors.ts";

function isOwnedEntry(name: string): boolean {
  return name === "manifest.json" || name.endsWith(".svg");
}

export async function assertOwnedPreviewRoot(root: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail("PATH_CONTAINMENT", "footprint preview root must be a real directory", { path: root });
  }
  const unexpected = entries
    .filter((entry) => !(entry.isFile() && isOwnedEntry(entry.name)))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en"));
  if (unexpected.length > 0) {
    fail(
      "PATH_CONTAINMENT",
      "footprint preview root contains files it does not own; refusing to delete it",
      { path: root, unexpected },
    );
  }
}
