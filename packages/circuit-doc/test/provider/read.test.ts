/**
 * Path containment and symlink refusal on the provider read path.
 *
 * These run against a scratch root, through the same functions every provider
 * read is built from.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { ComponentDocsError } from "../../src/core/errors.ts";
import { assertContainedUnder, readContainedJson } from "../../src/provider/v1/read.ts";
import { readInventory } from "../../src/provider/v1/evidence.ts";
import { projectPaths, type CircuitProjectPaths } from "../../src/provider/v1/paths.ts";
import { FIXTURE_LAYOUT, fixtureInventory } from "../fixtures/provider-fixtures.ts";

let scratch = "";
let root = "";
let project: CircuitProjectPaths;

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "component-docs-read-"));
  root = join(scratch, "skills");
  await mkdir(join(root, "bundle"), { recursive: true });
  await writeFile(join(root, "bundle", "data.json"), '{"schema_version":1}\n', "utf8");
  await writeFile(join(scratch, "outside.json"), '{"secret":true}\n', "utf8");

  // A project-shaped tree, standing in for the real evidence upstream read.
  project = projectPaths(join(scratch, "project"), FIXTURE_LAYOUT);
  await mkdir(join(project.inventoryFile, ".."), { recursive: true });
  await writeFile(project.inventoryFile, `${JSON.stringify(fixtureInventory())}\n`, "utf8");
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("containment", () => {
  it("accepts a path under the root", () => {
    assert.equal(
      assertContainedUnder("/a/b", "/a/b/c/d.json"),
      join("/a/b", "c", "d.json"),
    );
  });

  it("refuses the root itself", () => {
    rejectsContainment(() => assertContainedUnder("/a/b", "/a/b"));
  });

  it("refuses a sibling whose name merely starts with the root", () => {
    // The reason containment is compared segment-wise, not by string prefix.
    rejectsContainment(() => assertContainedUnder("/a/b", "/a/bc/d.json"));
  });

  it("refuses traversal back out of the root", () => {
    rejectsContainment(() => assertContainedUnder("/a/b", "/a/b/../../etc/passwd"));
    rejectsContainment(() => assertContainedUnder("/a/b", "/a/b/x/../../../y.json"));
  });

  it("refuses an unrelated absolute path", () => {
    rejectsContainment(() => assertContainedUnder("/a/b", "/etc/passwd"));
  });

  it("applies the same rule to a project's bundles root", () => {
    const { bundlesRoot, inventoryFile } = project;
    rejectsContainment(() => assertContainedUnder(bundlesRoot, join(bundlesRoot, "..", "..", "package.json")));
    rejectsContainment(() => assertContainedUnder(bundlesRoot, "/etc/passwd"));
    assert.equal(assertContainedUnder(bundlesRoot, inventoryFile), inventoryFile);
  });
});

describe("symlink refusal", () => {
  it("reads a contained regular file", async () => {
    assert.deepEqual(await readContainedJson(root, join(root, "bundle", "data.json")), {
      schema_version: 1,
    });
  });

  it("refuses a symlinked leaf", async () => {
    const link = join(root, "bundle", "escape.json");
    await symlink(join(scratch, "outside.json"), link);
    await rejectsPath(() => readContainedJson(root, link), /crosses a symlink/u);
    await rm(link);
  });

  it("refuses a symlinked intermediate directory", async () => {
    await mkdir(join(scratch, "elsewhere"), { recursive: true });
    await writeFile(join(scratch, "elsewhere", "data.json"), "{}\n", "utf8");
    const link = join(root, "linked");
    await symlink(join(scratch, "elsewhere"), link);
    await rejectsPath(() => readContainedJson(root, join(link, "data.json")), /crosses a symlink/u);
    await rm(link);
  });

  it("refuses a symlinked root", async () => {
    const linkedRoot = join(scratch, "linked-root");
    await symlink(root, linkedRoot);
    await rejectsPath(
      () => readContainedJson(linkedRoot, join(linkedRoot, "bundle", "data.json")),
      /root is a symlink/u,
    );
    await rm(linkedRoot);
  });

  it("refuses a traversing read before it touches the disk", async () => {
    await rejectsPath(
      () => readContainedJson(root, join(root, "..", "outside.json")),
      /escapes the skills root/u,
    );
  });
});

describe("unreadable provider files", () => {
  it("reports a missing file by its path inside the root, not its absolute path", async () => {
    await assert.rejects(
      () => readContainedJson(root, join(root, "bundle", "absent.json")),
      (error: unknown) => {
        assert.ok(error instanceof ComponentDocsError);
        assert.equal(error.code, "ADAPTER_CONTRACT");
        assert.equal(error.detail.path, "bundle/absent.json");
        return true;
      },
    );
  });

  it("reports invalid JSON without echoing the file's contents", async () => {
    const broken = join(root, "bundle", "broken.json");
    await writeFile(broken, '{"unterminated": ', "utf8");
    await assert.rejects(
      () => readContainedJson(root, broken),
      (error: unknown) => {
        assert.ok(error instanceof ComponentDocsError);
        assert.equal(error.code, "ADAPTER_CONTRACT");
        assert.equal(error.detail.path, "bundle/broken.json");
        assert.equal(String(error.detail.reason).includes("unterminated"), false);
        return true;
      },
    );
    await rm(broken);
  });

  it("still reads a project's inventory", async () => {
    const inventory = await readInventory(project.bundlesRoot, project.inventoryFile);
    assert.equal(inventory.schema_version, 1);
  });
});

function rejectsContainment(run: () => unknown): void {
  assert.throws(
    run,
    (error: unknown) =>
      error instanceof ComponentDocsError && error.code === "PATH_CONTAINMENT",
  );
}

async function rejectsPath(run: () => Promise<unknown>, message: RegExp): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof ComponentDocsError);
    assert.equal(error.code, "PATH_CONTAINMENT");
    assert.match(error.message, message);
    return true;
  });
}
