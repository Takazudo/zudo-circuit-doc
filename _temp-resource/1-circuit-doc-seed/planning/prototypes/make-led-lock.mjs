// Prototype: derive the fixtures/led path set from the pinned LED commit and emit a lock with sha256 + git blob sha1.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const [repo, commit] = [process.argv[2], process.argv[3]];
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { maxBuffer: 1 << 30 });
const tree = git("ls-tree", "-r", "-l", commit).toString().trim().split("\n").map((l) => {
  const [meta, path] = l.split("\t"); const [, , blob, size] = meta.split(/\s+/); return { path, blob, size: Number(size) };
});
const byPath = new Map(tree.map((e) => [e.path, e]));
const manifest = JSON.parse(git("show", `${commit}:doc/public/assets/component-previews/footprints/manifest.json`));
const want = new Set();
const prefixes = [".claude/skills/", "doc/public/assets/component-previews/", "doc/src/content/docs/components/"];
for (const e of tree) if (prefixes.some((p) => e.path.startsWith(p))) want.add(e.path);
for (const f of ["board_p_spec.py", "board_l_spec.py", "swd_adapter_spec.py", "verify_power_switch.py", "schgen_core.py", "sexp.py"]) want.add(`scripts/schgen/${f}`);
want.add("symbols/zudo-led-lamp.kicad_sym"); want.add("doc/component-docs/preflight.json");
for (const p of manifest.packages) {
  want.add(`footprints/kicad/${p.footprintName}.kicad_mod`); want.add(p.footprintPath);
  const text = git("show", `${commit}:${p.footprintPath}`).toString();
  const name = /\(model\s+"[^"]*\/([^/"]+)"/u.exec(text)[1];
  want.add(`footprints/kicad/zudo-led-lamp.3dshapes/${name}`); want.add(`footprints/kicad/zudo-led-lamp.3dshapes/${name.replace(/\.wrl$/u, ".step")}`);
}
const files = [...want].sort().map((path) => {
  const e = byPath.get(path); if (!e) throw new Error(`missing ${path}`);
  const bytes = git("cat-file", "blob", e.blob);
  const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (blob !== e.blob) throw new Error(`blob mismatch ${path}`);
  return { path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), gitBlob: blob };
});
const total = files.reduce((s, f) => s + f.size, 0);
process.stdout.write(JSON.stringify({ lockVersion: 1, source: { repository: "Takazudo/zudo-led-lamp", commit }, fileCount: files.length, totalBytes: total, files }, null, 2) + "\n");
