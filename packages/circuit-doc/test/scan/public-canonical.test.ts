import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";

import { ComponentDocsError } from "../../src/core/errors.ts";
import { harvestCanaries } from "../../src/core/scan.ts";
import { safeText } from "../../src/core/text.ts";
import { sha256 } from "../../src/footprint-previews/hash.ts";
import { derivePublicCanonicalHashes, subtractPublicCanonicalHashes } from "../../src/scan/public-canonical.ts";
import { fixtureModel } from "../fixtures/view-model-fixtures.ts";

let scratch = "";
let count = 0;
before(async () => { scratch = await mkdtemp(join(tmpdir(), "public-canonical-")); });
after(async () => { await rm(scratch, { recursive: true, force: true }); });

const footprintName = "TEST_FOOTPRINT";
const footprintPath = "cad/library/TEST_FOOTPRINT.kicad_mod";
const bytes = Buffer.from('(footprint "TEST_FOOTPRINT"\n  (version 20241229))\n');
const digest = sha256(bytes);
const entry = { footprintName, footprintPath, canonicalInputSha256: digest };
const manifest = { formatVersion: 1, packages: [entry] };
const t = (value: string) => safeText(value, { field: "fixture" });

async function fixture() {
  const configRoot = join(scratch, `project-${++count}`);
  const projectRoot = join(configRoot, "data");
  const paths = {
    projectRoot,
    footprintLibraryRoot: join(projectRoot, "cad/library"),
    footprintPreviewRoot: join(configRoot, "doc/public/assets/component-previews/footprints"),
    // Deliberately independent of doc/public and outside the project data root.
    distRoot: join(configRoot, "published/custom-site"),
  };
  const builtManifest = join(paths.distRoot, "assets/component-previews/footprints/manifest.json");
  const sourceManifest = join(paths.footprintPreviewRoot, "manifest.json");
  for (const dir of [paths.footprintLibraryRoot, paths.footprintPreviewRoot, dirname(builtManifest)]) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(join(projectRoot, footprintPath), bytes);
  await writeFile(sourceManifest, JSON.stringify(manifest));
  await writeFile(builtManifest, JSON.stringify(manifest));
  const model = {
    ...fixtureModel(),
    packagePreviews: [{
      packageId: t("test-package"), footprintName: t(footprintName), footprintPath: t(footprintPath),
      recordIds: null, modelPath: null, offset: null, rotation: null, scale: null,
    }],
  };
  return { paths, model, declared: [footprintName], builtManifest, sourceManifest };
}

async function rejectsClosed(promise: Promise<unknown>, code = "PUBLICATION_POLICY") {
  await assert.rejects(promise, (error: unknown) => error instanceof ComponentDocsError && error.code === code);
}

describe("derivePublicCanonicalHashes", () => {
  it("does not read model or paths for an empty declaration (CAD is unnecessary)", async () => {
    const unreadable = new Proxy({}, { get() { throw new Error("must not be read"); } });
    const input = { declared: [], model: unreadable, paths: unreadable } as unknown as Parameters<typeof derivePublicCanonicalHashes>[0];
    assert.deepEqual(await derivePublicCanonicalHashes(input), []);
  });

  it("hashes canonical bytes, supports null membership/model and uses configured dist", async () => {
    const input = await fixture();
    // Only the built copy proves what SITE scans; the source copy is not used.
    await rm(input.sourceManifest);
    Object.defineProperty(input.model.packagePreviews[0], "recordIds", {
      get() { throw new Error("package membership must not be read"); },
    });
    assert.deepEqual(await derivePublicCanonicalHashes(input), [{ footprintName, footprintPath, sha256: digest }]);
  });

  it("rejects an undeclared package and ambiguous published package entries", async () => {
    const input = await fixture();
    await rejectsClosed(derivePublicCanonicalHashes({ ...input, declared: ["UNKNOWN"] }));
    await rejectsClosed(derivePublicCanonicalHashes({
      ...input, model: { ...input.model, packagePreviews: [...input.model.packagePreviews, ...input.model.packagePreviews] },
    }));
  });

  for (const [label, replacement] of [
    ["digest mismatch", { ...manifest, packages: [{ ...entry, canonicalInputSha256: "f".repeat(64) }] }],
    ["path mismatch", { ...manifest, packages: [{ ...entry, footprintPath: "another.kicad_mod" }] }],
    ["name mismatch", { ...manifest, packages: [{ ...entry, footprintName: "OTHER" }] }],
    ["missing package", { ...manifest, packages: [] }],
    ["duplicate package", { ...manifest, packages: [entry, entry] }],
    ["invalid shape", { packages: null }],
    ["null manifest", null],
  ] as const) {
    it(`rejects built manifest ${label} despite an unchanged valid source manifest`, async () => {
      const input = await fixture();
      await writeFile(input.builtManifest, JSON.stringify(replacement));
      await rejectsClosed(derivePublicCanonicalHashes(input));
    });
  }

  it("rejects stale canonical bytes instead of deriving the digest from the manifest", async () => {
    const input = await fixture();
    await writeFile(join(input.paths.projectRoot, footprintPath), "different canonical bytes");
    await rejectsClosed(derivePublicCanonicalHashes(input));
  });

  it("rejects missing or malformed built manifests despite valid source provenance", async () => {
    const input = await fixture();
    await writeFile(input.builtManifest, "not JSON");
    await rejectsClosed(derivePublicCanonicalHashes(input));
    await rm(input.builtManifest);
    await rejectsClosed(derivePublicCanonicalHashes(input));
  });

  it("rejects missing and non-regular footprint files", async () => {
    const input = await fixture();
    const file = join(input.paths.projectRoot, footprintPath);
    await rm(file);
    await rejectsClosed(derivePublicCanonicalHashes(input));
    await mkdir(file);
    await rejectsClosed(derivePublicCanonicalHashes(input), "PATH_CONTAINMENT");
  });

  it("rejects a symlink to a regular file inside the library", async () => {
    const input = await fixture();
    const file = join(input.paths.projectRoot, footprintPath);
    const target = join(input.paths.footprintLibraryRoot, "other.kicad_mod");
    await writeFile(target, bytes);
    await rm(file);
    await symlink(target, file);
    await rejectsClosed(derivePublicCanonicalHashes(input), "PATH_CONTAINMENT");
  });

  it("rejects a library root symlink escaping the project", async () => {
    const input = await fixture();
    const outside = join(scratch, `outside-${count}`);
    await mkdir(outside);
    await writeFile(join(outside, `${footprintName}.kicad_mod`), bytes);
    await rm(input.paths.footprintLibraryRoot, { recursive: true });
    await symlink(outside, input.paths.footprintLibraryRoot);
    await rejectsClosed(derivePublicCanonicalHashes(input), "PATH_CONTAINMENT");
  });

  it("rejects escaping names even when present in the projected package set", async () => {
    const input = await fixture();
    for (const name of ["../escape", "/escape", "nested/footprint", "..\\escape"]) {
      const preview = input.model.packagePreviews[0]!;
      await rejectsClosed(derivePublicCanonicalHashes({
        ...input, declared: [name], model: { ...input.model, packagePreviews: [{ ...preview, footprintName: t(name) }] },
      }), "PATH_CONTAINMENT");
    }
  });

  it("rejects a symlinked built manifest", async () => {
    const input = await fixture();
    await rm(input.builtManifest);
    await symlink(input.sourceManifest, input.builtManifest);
    await rejectsClosed(derivePublicCanonicalHashes(input), "PATH_CONTAINMENT");
  });
});

describe("subtractPublicCanonicalHashes", () => {
  it("subtracts only exact normalized matches at the exact sha256 key without mutating the input", () => {
    const canaries = harvestCanaries([
      { sha256: digest },
      { identity_extract_sha256: digest },
      { evidence_extract: digest },
      { sha256: `${digest}extra` },
      { sha256: digest.slice(0, -1) },
      { sha256: sha256("different canonical footprint") },
    ], { deniedKeys: ["sha256", "identity_extract_sha256", "evidence_extract"] });
    const hashCanary = canaries.find((canary) => canary.path.endsWith(".sha256") && canary.normalized === digest)!;
    assert.equal(canaries.length, 6);
    const otherKeys = ["sha256.extra", "sha256x"].map((key) => ({ ...hashCanary, path: `sources.0.${key}` }));
    const input = [...canaries, ...otherKeys];
    const original = [...input];
    const result = subtractPublicCanonicalHashes(input, [{ ...entry, sha256: digest }]);
    assert.deepEqual(result.withheld, [hashCanary]);
    assert.deepEqual(result.kept, input.filter((canary) => canary !== hashCanary));
    assert.deepEqual(input, original);
    assert.deepEqual(subtractPublicCanonicalHashes(input, []), { kept: input, withheld: [] });
  });
});
