/**
 * The public-scope check (ADR-018). PUB-03: a raw evidence/CAD file under
 * `doc/public/` fails; an allowlist entry with a `reason` passes; the
 * generator-owned `assets/component-previews/**` escape works without one.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { ComponentDocsError } from "../../src/core/errors.ts";
import type { PublicationAssets } from "../../src/config/map.ts";
import { checkPublicScope, findPublicScopeViolations } from "../../src/scan/public-scope.ts";

const EMPTY_ASSETS: PublicationAssets = { schema_version: 1, assets: [] };

let scratch = "";

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "circuit-doc-public-scope-"));
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function root(name: string): Promise<string> {
  const path = join(scratch, name);
  await mkdir(path, { recursive: true });
  return path;
}

function rejectsWith(promise: Promise<unknown>, code: string): Promise<void> {
  return assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ComponentDocsError);
    assert.equal(error.code, code);
    return true;
  });
}

describe("PUB-03: a raw evidence/CAD file under docs.publicRoot", () => {
  it("fails on a bare PDF", async () => {
    const publicRoot = await root("pdf-fails");
    await writeFile(join(publicRoot, "datasheet.pdf"), "%PDF-1.4 fixture");
    await rejectsWith(checkPublicScope({ publicRoot, assets: EMPTY_ASSETS }), "PUBLICATION_POLICY");
  });

  it("passes once the exact path is listed in publication.assets", async () => {
    const publicRoot = await root("pdf-allowlisted");
    await writeFile(join(publicRoot, "datasheet.pdf"), "%PDF-1.4 fixture");
    const assets: PublicationAssets = {
      schema_version: 1,
      assets: [{ path: "datasheet.pdf", reason: "deliberately mirrored for offline review" }],
    };
    const violations = await checkPublicScope({ publicRoot, assets });
    assert.deepEqual(violations, []);
  });

  it("fails on every other restricted evidence/CAD extension", async () => {
    const publicRoot = await root("every-extension");
    const names = [
      "board.step",
      "board.stp",
      "part.kicad_mod",
      "part.kicad_sym",
      "board.kicad_pcb",
      "board.kicad_sch",
      "archive.zip",
      "archive.7z",
      "evidence.json",
    ];
    for (const name of names) await writeFile(join(publicRoot, name), "fixture bytes");
    const violations = await findPublicScopeViolations(publicRoot, EMPTY_ASSETS);
    assert.equal(violations.length, names.length);
  });

  it("does not flag an ordinary, unrestricted file type", async () => {
    const publicRoot = await root("ordinary-file");
    await writeFile(join(publicRoot, "logo.png"), "fixture bytes");
    const violations = await findPublicScopeViolations(publicRoot, EMPTY_ASSETS);
    assert.deepEqual(violations, []);
  });

  it("fails on every mesh/3D, Gerber, drill, KiCad project, and BOM extension", async () => {
    const publicRoot = await root("fabrication-extensions");
    const names = [
      "board.stl",
      "board.3mf",
      "board.obj",
      "board.glb",
      "board.gltf",
      "board.gbr",
      "board.gtl",
      "board.gbl",
      "board.gto",
      "board.gbo",
      "board.gts",
      "board.gbs",
      "board.gtp",
      "board.gbp",
      "board.gko",
      "board.gm1",
      "board.drl",
      "board.xln",
      "board.kicad_pro",
      "board.kicad_prl",
      "bom.csv",
    ];
    for (const name of names) await writeFile(join(publicRoot, name), "fixture bytes");
    const violations = await findPublicScopeViolations(publicRoot, EMPTY_ASSETS);
    assert.equal(violations.length, names.length);
  });

  it("passes a Gerber file once allowlisted with a reason", async () => {
    const publicRoot = await root("gerber-allowlisted");
    await writeFile(join(publicRoot, "board.gtl"), "fixture bytes");
    const assets: PublicationAssets = {
      schema_version: 1,
      assets: [{ path: "board.gtl", reason: "deliberately mirrored for a fab-house review" }],
    };
    const violations = await findPublicScopeViolations(publicRoot, assets);
    assert.deepEqual(violations, []);
  });
});

describe("generator-owned assets/component-previews/** is exempt without an allowlist entry", () => {
  it("passes an SVG and a WRL under component-previews", async () => {
    const publicRoot = await root("previews-exempt");
    await mkdir(join(publicRoot, "assets/component-previews/footprints"), { recursive: true });
    await mkdir(join(publicRoot, "assets/component-previews/models"), { recursive: true });
    await writeFile(join(publicRoot, "assets/component-previews/footprints/pkg-a.svg"), "<svg/>");
    await writeFile(join(publicRoot, "assets/component-previews/models/pkg-a.wrl"), "#VRML V2.0 utf8");
    await writeFile(join(publicRoot, "assets/component-previews/footprints/manifest.json"), "{}");
    const violations = await findPublicScopeViolations(publicRoot, EMPTY_ASSETS);
    assert.deepEqual(violations, []);
  });

  it("still fails a raw JSON evidence bundle placed OUTSIDE component-previews", async () => {
    const publicRoot = await root("json-outside-previews");
    await mkdir(join(publicRoot, "assets"), { recursive: true });
    await writeFile(join(publicRoot, "assets/manifest.json"), "{}");
    const violations = await findPublicScopeViolations(publicRoot, EMPTY_ASSETS);
    assert.deepEqual(violations.map((entry) => entry.path), ["assets/manifest.json"]);
  });
});

describe("WRL/SVG outside component-previews also require an allowlist entry", () => {
  it("fails a hand-placed SVG elsewhere on the public root", async () => {
    const publicRoot = await root("svg-elsewhere");
    await mkdir(join(publicRoot, "icons"), { recursive: true });
    await writeFile(join(publicRoot, "icons/logo.svg"), "<svg/>");
    const violations = await findPublicScopeViolations(publicRoot, EMPTY_ASSETS);
    assert.deepEqual(violations.map((entry) => entry.path), ["icons/logo.svg"]);
  });

  it("passes once that SVG is allowlisted with a reason", async () => {
    const publicRoot = await root("svg-elsewhere-allowlisted");
    await mkdir(join(publicRoot, "icons"), { recursive: true });
    await writeFile(join(publicRoot, "icons/logo.svg"), "<svg/>");
    const assets: PublicationAssets = {
      schema_version: 1,
      assets: [{ path: "icons/logo.svg", reason: "hand-authored site logo, not evidence" }],
    };
    const violations = await findPublicScopeViolations(publicRoot, assets);
    assert.deepEqual(violations, []);
  });
});

describe("a symlinked path under docs.publicRoot is never allowed", () => {
  it("fails even when the symlink target would itself be fine", async () => {
    const publicRoot = await root("symlink-fails");
    await writeFile(join(publicRoot, "real.png"), "fixture bytes");
    await symlink(join(publicRoot, "real.png"), join(publicRoot, "alias.png"));
    const violations = await findPublicScopeViolations(publicRoot, EMPTY_ASSETS);
    assert.deepEqual(violations.map((entry) => entry.path), ["alias.png"]);
  });
});

describe("an absent docs.publicRoot is not a crash", () => {
  it("reports zero violations", async () => {
    const violations = await findPublicScopeViolations(join(scratch, "does-not-exist"), EMPTY_ASSETS);
    assert.deepEqual(violations, []);
  });
});
