#!/usr/bin/env node
// Rebuilds the project-library copies of the vendored KiCad SOIC-8 assets from
// the unmodified imports in this directory. Deterministic; see README.md.
//
//   node footprints/vendor/kicad-soic8/derive.mjs [--check]
//
// Exit codes: 0 derived (or --check: up to date), 1 input hash mismatch or stale output.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "SOIC-8_3.9x4.9mm_P1.27mm";
const LIBRARY = "example-minimal-circuit-lib";
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../../..");
const kicadRoot = path.join(projectRoot, "footprints/kicad");

// Receipt hashes of the files taken from kicad-footprints@9.0.9 and kicad-packages3D@8.0.9.
const INPUTS = {
  [`${NAME}.kicad_mod`]: "623e154d907cd3e49387a81775898feee35c4ed5fd3317865ad11c322f72adfb",
  [`${NAME}.wrl`]: "2b84645ac35f878381da69ebf467feab9e5f054922c809c1b28a1586dd4e462d",
};

const ORIGINAL_MODEL = `(model "\${KICAD9_3DMODEL_DIR}/Package_SO.3dshapes/${NAME}.step"`;
const PROJECT_MODEL = `(model "\${KIPRJMOD}/../../footprints/kicad/${LIBRARY}.3dshapes/${NAME}.wrl"`;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function readInput(name) {
  const bytes = readFileSync(path.join(here, name));
  if (sha256(bytes) !== INPUTS[name]) throw new Error(`${name}: sha256 differs from the receipt`);
  return bytes.toString("utf8");
}

function replaceOnce(text, from, to, label) {
  const parts = text.split(from);
  if (parts.length !== 2) throw new Error(`${label}: expected exactly one occurrence of ${from}`);
  return parts.join(to);
}

// Each `material USE <name>` gets the body of its `DEF` inlined; geometry and material
// values are unchanged. Optional now that the publication policy accepts material-only
// USE, but kept so the committed copy matches its recorded hash.
function inlineMaterials(wrl) {
  const bodies = new Map();
  for (const [, name, body] of wrl.matchAll(/material DEF (\S+) Material \{([^}]*)\}/gu)) bodies.set(name, body);
  if (bodies.size === 0) throw new Error("wrl: no DEF materials found");
  return wrl.replace(/material USE (\S+) /gu, (_, name) => {
    const body = bodies.get(name);
    if (body === undefined) throw new Error(`wrl: USE of undefined material ${name}`);
    return `material Material {${body}} `;
  });
}

const footprint = replaceOnce(readInput(`${NAME}.kicad_mod`), ORIGINAL_MODEL, PROJECT_MODEL, "footprint");
const model = inlineMaterials(readInput(`${NAME}.wrl`));

const outputs = [
  [path.join(kicadRoot, `${NAME}.kicad_mod`), footprint],
  [path.join(kicadRoot, `${LIBRARY}.pretty`, `${NAME}.kicad_mod`), footprint],
  [path.join(kicadRoot, `${LIBRARY}.3dshapes`, `${NAME}.wrl`), model],
];

const check = process.argv.includes("--check");
let stale = 0;
for (const [file, contents] of outputs) {
  const relative = path.relative(projectRoot, file);
  if (check) {
    let current = null;
    try {
      current = readFileSync(file, "utf8");
    } catch {}
    if (current !== contents) {
      console.error(`stale: ${relative}`);
      stale += 1;
    }
    continue;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
  console.log(`${sha256(contents)}  ${relative}`);
}
if (stale > 0) process.exit(1);
if (check) console.log(`ok: ${outputs.length} derived files are current`);
