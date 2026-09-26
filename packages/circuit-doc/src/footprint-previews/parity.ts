/**
 * Dual-location footprint inventory parity (ported from zudo-led-lamp
 * `doc/component-docs/footprint-previews/parity.ts`).
 *
 * Keeps the authoring copy (`cad.footprintMasterRoot`) and KiCad's `.pretty`
 * resolution copy (`cad.footprintLibraryRoot`) byte-identical. Preview hashes
 * intentionally use the resolution copy, so this guard is what makes a
 * source-only edit in the documented master directory fail closed.
 */

import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { fail } from "../core/errors.ts";

export async function assertFootprintLibraryParity(masterRoot: string, libraryRoot: string): Promise<void> {
  const masterNames = await footprintNames(masterRoot);
  const libraryNames = await footprintNames(libraryRoot);
  if (JSON.stringify(masterNames) !== JSON.stringify(libraryNames)) {
    fail("ADAPTER_CONTRACT", "dual-location footprint inventory differs", {
      master: masterNames,
      library: libraryNames,
    });
  }
  for (const name of masterNames) {
    const masterPath = join(masterRoot, name);
    const libraryPath = join(libraryRoot, name);
    await assertRegularFile(masterPath, `master footprint ${name}`);
    await assertRegularFile(libraryPath, `library footprint ${name}`);
    const [master, library] = await Promise.all([readFile(masterPath), readFile(libraryPath)]);
    if (!master.equals(library)) {
      fail("ADAPTER_CONTRACT", `dual-location footprint bytes differ: ${name}`, { name });
    }
  }
}

async function footprintNames(root: string): Promise<string[]> {
  let rootStat;
  try {
    rootStat = await lstat(root);
  } catch (error) {
    fail("ADAPTER_CONTRACT", "footprint root is missing", { root, reason: (error as Error).message });
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    fail("PATH_CONTAINMENT", "footprint root must be a real directory", { root });
  }
  return (await readdir(root))
    .filter((name) => name.endsWith(".kicad_mod"))
    .sort((a, b) => a.localeCompare(b, "en"));
}

async function assertRegularFile(path: string, label: string): Promise<void> {
  const fileStat = await lstat(path);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    fail("PATH_CONTAINMENT", `${label} must be a regular non-symlink file`, { path });
  }
}
