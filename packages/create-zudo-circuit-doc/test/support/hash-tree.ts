import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Hashes a directory tree's structure and byte content, so a test can prove
 * a tree is byte-for-byte unchanged (used by the collision test, spec
 * acceptance: "collision -> exit 1 with an unchanged tree").
 */
export function hashTree(rootDir: string): string {
  const hash = createHash("sha256");

  function walk(dir: string, relPath: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const entryRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        hash.update(`dir:${entryRelPath}\n`);
        walk(entryPath, entryRelPath);
      } else {
        const stat = fs.statSync(entryPath);
        hash.update(`file:${entryRelPath}:mode=${stat.mode.toString(8)}\n`);
        hash.update(fs.readFileSync(entryPath));
      }
    }
  }

  walk(rootDir, "");
  return hash.digest("hex");
}
