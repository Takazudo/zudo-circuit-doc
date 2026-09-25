#!/usr/bin/env node
// Guard: the published shape of @takazudo/zudo-circuit-doc (zudo-sg
// check-package-shape.mjs precedent). Run after `build`:
//   1. Every literal `exports` target exists on disk.
//   2. Every `exports` condition object lists `types` before `default`.
//   3. `files` covers the package boundary entries.
//   4. Every `dist/islands/*.js` island root still starts with "use client"
//      (zfb registers islands per file; a lost directive means no hydration).
//   5. No `dist/**/*.js` import specifier ends in `.ts`/`.tsx` (Node refuses
//      type stripping under node_modules). Declaration files are exempt.
//   6. `styles.css` and `dist/islands.d.ts` exist.
//
// Usage: node scripts/check-package-shape.mjs   (exit 1 on any violation)

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(PKG_ROOT, "dist");
const manifest = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));

const REQUIRED_FILES = ["bin", "dist", "python", "templates", "contract", "styles.css", "README.md", "LICENSE"];
const REQUIRED_PATHS = ["styles.css", "dist/islands.d.ts"];
// Island roots are the modules wrapped in `<Island>`; helpers the roots import
// (viewer-runtime, viewer-state) are plain modules and carry no directive.
const ISLAND_ROOTS = ["footprint-preview-island.js", "package-model-viewer-island.js", "preview-enlarge-dialog.js"];

const errors = [];

function walk(subpath, node) {
  if (typeof node === "string") {
    if (!node.startsWith("./")) errors.push(`exports["${subpath}"] target "${node}" must start with "./"`);
    else if (!node.includes("*") && !existsSync(join(PKG_ROOT, node))) {
      errors.push(`exports["${subpath}"] target "${node}" does not exist (run the package build first)`);
    }
    return;
  }
  if (node && typeof node === "object") {
    const keys = Object.keys(node);
    if (keys.includes("types") && keys.includes("default") && keys.indexOf("types") > keys.indexOf("default")) {
      errors.push(`exports["${subpath}"] must list "types" before "default"`);
    }
    for (const value of Object.values(node)) walk(subpath, value);
    return;
  }
  errors.push(`exports["${subpath}"] has an invalid target`);
}

if (!manifest.exports || typeof manifest.exports !== "object") {
  errors.push("package.json has no exports map");
} else {
  for (const [subpath, target] of Object.entries(manifest.exports)) walk(subpath, target);
}

const files = Array.isArray(manifest.files) ? manifest.files : [];
for (const entry of REQUIRED_FILES) {
  if (!files.includes(entry)) errors.push(`files is missing "${entry}"`);
}

for (const path of REQUIRED_PATHS) {
  if (!existsSync(join(PKG_ROOT, path))) errors.push(`${path} does not exist (run the package build first)`);
}

function jsFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => join(entry.parentPath, entry.name));
}

const islandsDir = join(DIST, "islands");
const islandFiles = new Set(jsFiles(islandsDir).map((path) => relative(islandsDir, path)));
for (const root of ISLAND_ROOTS) {
  if (!islandFiles.has(root)) {
    errors.push(`dist/islands/${root} does not exist (run the package build first)`);
    continue;
  }
  const source = readFileSync(join(islandsDir, root), "utf8");
  if (!/^["']use client["'];?\s*\n/u.test(source)) {
    errors.push(`dist/islands/${root} does not start with "use client"`);
  }
}

// Static `from "…"`, bare side-effect `import "…"`, and dynamic `import("…")`.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])([^"'\n]+)\1/gu;
for (const file of jsFiles(DIST)) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[2];
    if (/\.tsx?$/u.test(specifier)) {
      errors.push(`${relative(PKG_ROOT, file)} imports "${specifier}" (a .ts/.tsx specifier survived the build)`);
    }
  }
}

if (errors.length > 0) {
  console.error("check:shape FAILED for @takazudo/zudo-circuit-doc:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
const count = Object.keys(manifest.exports).length;
console.log(
  `OK — @takazudo/zudo-circuit-doc package shape (${count} exports resolved, ${ISLAND_ROOTS.length} "use client" island roots, no .ts specifiers in dist JS).`,
);
