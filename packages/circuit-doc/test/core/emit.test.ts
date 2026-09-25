import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { ComponentDocsError } from "../../src/core/errors.ts";
import { assertContained, diffAgainstDisk, emit } from "../../src/core/emit.ts";
import { GENERATED_MARKER, buildPage, isGeneratedContents } from "../../src/core/page.ts";
import { LEGACY_MARKERS, applyGeneratedMarker } from "../../src/core/page.ts";
import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { paragraph, text } from "../../src/core/mdx.ts";
import { literal } from "../../src/core/text.ts";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "component-docs-emit-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function page(relativePath: string, body: string) {
  return buildPage(
    relativePath,
    {
      title: literal("Title"),
      description: literal("Description"),
      sidebarPosition: 1,
    },
    [paragraph([text(literal(body))])],
  );
}

describe("assertContained", () => {
  it("accepts a child path", () => {
    assert.equal(
      assertContained("/a/b", "/a/b/c/d.mdx", "test"),
      "/a/b/c/d.mdx",
    );
  });

  it("rejects a sibling that merely shares a prefix", () => {
    assert.throws(
      () => assertContained("/a/b", "/a/bc/d.mdx", "test"),
      (error: unknown) =>
        error instanceof ComponentDocsError && error.code === "PATH_CONTAINMENT",
    );
  });

  it("rejects traversal", () => {
    assert.throws(
      () => assertContained("/a/b", "/a/b/../../etc/passwd", "test"),
      (error: unknown) =>
        error instanceof ComponentDocsError && error.code === "PATH_CONTAINMENT",
    );
  });

  it("rejects the root itself", () => {
    assert.throws(() => assertContained("/a/b", "/a/b", "test"), ComponentDocsError);
  });
});

describe("buildPage", () => {
  it("marks generated output", () => {
    const built = page("index.mdx", "hello");
    assert.ok(built.contents.startsWith(`---\n${GENERATED_MARKER}\n`));
    assert.ok(isGeneratedContents(built.contents));
  });

  it("JSON-encodes frontmatter so evidence cannot break out of the block", () => {
    const built = buildPage(
      "index.mdx",
      {
        title: literal('He said "---" and: {x}'),
        description: literal("d"),
        sidebarPosition: 0,
      },
      [],
    );
    assert.match(built.contents, /^title: "He said \\"---\\" and: \{x\}"$/mu);
    // Exactly two fence lines: the open and the close of the frontmatter block.
    assert.equal(built.contents.split("\n").filter((line) => line === "---").length, 2);
  });

  it("rejects a path shape outside the owned tree's naming rules", () => {
    for (const bad of ["../escape.mdx", "/abs.mdx", "Upper.mdx", "index.md", "a//b.mdx"]) {
      assert.throws(
        () => page(bad, "x"),
        (error: unknown) =>
          error instanceof ComponentDocsError && error.code === "PATH_CONTAINMENT",
        `expected ${bad} to be rejected`,
      );
    }
  });
});

describe("emit", () => {
  it("writes, then reports unchanged on a second run (idempotent)", async () => {
    const plan = { root, pages: [page("index.mdx", "hello")] };

    const first = await emit(plan);
    assert.deepEqual(first.written, ["index.mdx"]);

    const second = await emit(plan);
    assert.deepEqual(second.written, []);
    assert.deepEqual(second.unchanged, ["index.mdx"]);

    const onDisk = await readFile(join(root, "index.mdx"), "utf8");
    assert.equal(onDisk, plan.pages[0]?.contents);
  });

  it("removes its own stale output", async () => {
    await emit({ root, pages: [page("index.mdx", "a"), page("gone.mdx", "b")] });
    const result = await emit({ root, pages: [page("index.mdx", "a")] });
    assert.deepEqual(result.removed, ["gone.mdx"]);
  });

  it("refuses to delete a hand-authored file found in the owned tree", async () => {
    await emit({ root, pages: [page("index.mdx", "a")] });
    await writeFile(join(root, "hand-written.mdx"), "---\ntitle: mine\n---\n\nkeep me\n", "utf8");

    await assert.rejects(
      emit({ root, pages: [page("index.mdx", "a")] }),
      (error: unknown) =>
        error instanceof ComponentDocsError && error.code === "PATH_CONTAINMENT",
    );
    assert.match(await readFile(join(root, "hand-written.mdx"), "utf8"), /keep me/u);
  });

  it("refuses to walk a symlink inside the owned tree", async () => {
    await mkdir(join(root, "sub"), { recursive: true });
    await symlink("/etc", join(root, "sub", "escape"));

    await assert.rejects(
      emit({ root, pages: [page("index.mdx", "a")] }),
      (error: unknown) =>
        error instanceof ComponentDocsError && error.code === "PATH_CONTAINMENT",
    );
  });

  it("writes nested pages", async () => {
    const result = await emit({ root, pages: [page("records/al8860mp-13.mdx", "x")] });
    assert.deepEqual(result.written, ["records/al8860mp-13.mdx"]);
  });

  /**
   * These assert on the OUTSIDE directory, not on the rejection.
   *
   * Before the path-walk guard, both cases already rejected — but from the
   * pruning walk at the very end of `emit`, which runs after the page has been
   * written. So "it throws PATH_CONTAINMENT" passed while the bytes had already
   * landed in the link target. The escape is only actually closed if the
   * outside directory stays empty.
   */
  describe("a symlink on the path out of the owned tree", () => {
    it("writes nothing outside when an intermediate directory is a symlink", async () => {
      const outside = await mkdtemp(join(tmpdir(), "component-docs-outside-"));
      try {
        await symlink(outside, join(root, "records"));

        await assert.rejects(
          emit({ root, pages: [page("records/escaped.mdx", "payload")] }),
          (error: unknown) =>
            error instanceof ComponentDocsError && error.code === "PATH_CONTAINMENT",
        );
        assert.deepEqual(await readdir(outside), [], "a page was written outside the owned root");
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });

    it("writes nothing outside when the root itself is a symlink", async () => {
      const outside = await mkdtemp(join(tmpdir(), "component-docs-outside-"));
      const linkedRoot = join(root, "linked-root");
      try {
        await symlink(outside, linkedRoot);

        await assert.rejects(
          emit({ root: linkedRoot, pages: [page("index.mdx", "payload")] }),
          (error: unknown) =>
            error instanceof ComponentDocsError && error.code === "PATH_CONTAINMENT",
        );
        assert.deepEqual(await readdir(outside), [], "a page was written outside the owned root");
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });

    it("refuses a drift check that would read through a symlinked parent", async () => {
      // `check:components` decides whether committed output is stale. Reading
      // through a symlink would compare against a file this generator does not
      // own and could report "up to date" for content it never wrote.
      const outside = await mkdtemp(join(tmpdir(), "component-docs-outside-"));
      try {
        await symlink(outside, join(root, "records"));

        await assert.rejects(
          diffAgainstDisk({ root, pages: [page("records/escaped.mdx", "payload")] }),
          (error: unknown) =>
            error instanceof ComponentDocsError && error.code === "PATH_CONTAINMENT",
        );
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });
});

describe("diffAgainstDisk", () => {
  it("reports nothing when the tree matches", async () => {
    const plan = { root, pages: [page("index.mdx", "a")] };
    await emit(plan);
    assert.deepEqual(await diffAgainstDisk(plan), []);
  });

  it("reports a missing, a changed and a stale page", async () => {
    await emit({ root, pages: [page("index.mdx", "a"), page("stale.mdx", "b")] });
    const drift = await diffAgainstDisk({
      root,
      pages: [page("index.mdx", "changed"), page("new.mdx", "c")],
    });
    assert.deepEqual(drift, ["changed: index.mdx", "missing: new.mdx", "stale: stale.mdx"]);
  });

  it("writes nothing", async () => {
    await diffAgainstDisk({ root, pages: [page("index.mdx", "a")] });
    await assert.rejects(readFile(join(root, "index.mdx"), "utf8"));
  });
});

// --- #10 emit ownership preflight -------------------------------------------

const LED_MARKER =
  "# GENERATED by doc/component-docs — do not edit; run `pnpm generate:components`";

function markedPage(relativePath: string, body: string, generatedMarker: string) {
  return buildPage(
    relativePath,
    { title: literal("Title"), description: literal("Description"), sidebarPosition: 1 },
    [paragraph([text(literal(body))])],
    { generatedMarker },
  );
}

/** Path, size, mtime and sha256 of every entry under `dir`, so any write or removal shows up. */
async function snapshotTree(dir: string): Promise<string[]> {
  const lines: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const stats = await lstat(path);
      if (entry.isDirectory()) {
        lines.push(`dir ${path}`);
        stack.push(path);
      } else {
        const hash = createHash("sha256").update(await readFile(path)).digest("hex");
        lines.push(`file ${path} ${stats.size} ${stats.mtimeMs} ${hash}`);
      }
    }
  }
  return lines.sort();
}

function isContainment(paths: readonly string[]) {
  return (error: unknown) =>
    error instanceof ComponentDocsError &&
    error.code === "PATH_CONTAINMENT" &&
    JSON.stringify(error.detail.paths) === JSON.stringify(paths);
}

describe("generated marker", () => {
  it("defaults to the package-neutral marker", () => {
    assert.equal(
      GENERATED_MARKER,
      "# GENERATED by @takazudo/zudo-circuit-doc — do not edit; run `zudo-circuit-doc generate`",
    );
  });

  it("keeps the exact LED marker as a legacy marker", () => {
    assert.ok(LEGACY_MARKERS.includes(LED_MARKER));
  });

  it("recognizes the current, default and legacy markers but not an unmarked file", () => {
    const custom = "# GENERATED by my-project";
    assert.ok(isGeneratedContents(markedPage("a.mdx", "x", custom).contents, custom));
    assert.ok(isGeneratedContents(page("a.mdx", "x").contents, custom));
    assert.ok(isGeneratedContents(markedPage("a.mdx", "x", LED_MARKER).contents));
    assert.ok(!isGeneratedContents(markedPage("a.mdx", "x", custom).contents));
    assert.ok(!isGeneratedContents("---\ntitle: mine\n---\n"));
  });

  it("writes a configured marker as line 2", () => {
    assert.ok(markedPage("a.mdx", "x", LED_MARKER).contents.startsWith(`---\n${LED_MARKER}\n`));
  });

  it("rejects a marker that is not a single-line YAML comment", () => {
    for (const bad of ["GENERATED", "# a\ntitle: x", "# a\r", "#no-space", "# "]) {
      assert.throws(
        () => markedPage("a.mdx", "x", bad),
        (error: unknown) => error instanceof ComponentDocsError && error.code === "UNSAFE_VALUE",
        `expected ${JSON.stringify(bad)} to be rejected`,
      );
    }
  });

  it("re-marks a default page byte-identically to building it with that marker", () => {
    assert.equal(
      applyGeneratedMarker(page("a.mdx", "x"), LED_MARKER).contents,
      markedPage("a.mdx", "x", LED_MARKER).contents,
    );
    const unchanged = page("a.mdx", "x");
    assert.equal(applyGeneratedMarker(unchanged, GENERATED_MARKER), unchanged);
  });
});

describe("emit ownership preflight", () => {
  it("OUT-01: a hand-authored file at a generated target fails the whole emit and changes no byte", async () => {
    await emit({ root, pages: [page("index.mdx", "old"), page("records/a.mdx", "old")] });
    await writeFile(join(root, "records", "b.mdx"), "---\ntitle: mine\n---\n\nhand\n", "utf8");
    const before = await snapshotTree(root);

    await assert.rejects(
      emit({
        root,
        pages: [
          page("index.mdx", "new"),
          page("records/a.mdx", "new"),
          page("records/b.mdx", "generated"),
          page("records/c.mdx", "added"),
        ],
      }),
      isContainment(["records/b.mdx"]),
    );
    assert.deepEqual(await snapshotTree(root), before);
  });

  it("a stray hand-authored .mdx plus pending writes writes nothing", async () => {
    await emit({ root, pages: [page("index.mdx", "old"), page("gone.mdx", "old")] });
    await writeFile(join(root, "stray.mdx"), "---\ntitle: stray\n---\n\nstray\n", "utf8");
    const before = await snapshotTree(root);

    await assert.rejects(
      emit({ root, pages: [page("index.mdx", "new"), page("nested/new.mdx", "new")] }),
      isContainment(["stray.mdx"]),
    );
    // Neither the pending write, the new directory, nor the removal of gone.mdx happened.
    assert.deepEqual(await snapshotTree(root), before);
  });

  it("lists every conflicting path, not just the first", async () => {
    await mkdir(join(root, "sub"), { recursive: true });
    await writeFile(join(root, "index.mdx"), "hand target\n", "utf8");
    await writeFile(join(root, "sub", "stray.mdx"), "hand stray\n", "utf8");
    await writeFile(join(root, "notes.txt"), "not mdx\n", "utf8");
    const before = await snapshotTree(root);

    await assert.rejects(
      emit({ root, pages: [page("index.mdx", "a")] }),
      isContainment(["index.mdx", "notes.txt", "sub/stray.mdx"]),
    );
    assert.deepEqual(await snapshotTree(root), before);
  });

  it("reports a non-.mdx stray in the generated root", async () => {
    await emit({ root, pages: [page("index.mdx", "a")] });
    await writeFile(join(root, "_category_.json"), "{}\n", "utf8");

    await assert.rejects(
      emit({ root, pages: [page("index.mdx", "a")] }),
      isContainment(["_category_.json"]),
    );
    assert.deepEqual(await diffAgainstDisk({ root, pages: [page("index.mdx", "a")] }), [
      "conflict: _category_.json",
    ]);
  });

  it("check mode reports the conflict without writing", async () => {
    await emit({ root, pages: [page("index.mdx", "a")] });
    await writeFile(join(root, "records.mdx"), "hand target\n", "utf8");
    await writeFile(join(root, "stray.mdx"), "hand stray\n", "utf8");
    const before = await snapshotTree(root);

    const drift = await diffAgainstDisk({
      root,
      pages: [page("index.mdx", "changed"), page("records.mdx", "generated")],
    });
    assert.deepEqual(drift, ["changed: index.mdx", "conflict: records.mdx", "conflict: stray.mdx"]);
    assert.deepEqual(await snapshotTree(root), before);
  });

  it("accepts a legacy-marker tree and regenerates it under a legacy-marker config", async () => {
    const legacy = (path: string, body: string) => markedPage(path, body, LED_MARKER);
    await emit({ root, pages: [legacy("index.mdx", "old"), legacy("gone.mdx", "old")], generatedMarker: LED_MARKER });

    const plan = { root, pages: [legacy("index.mdx", "new")], generatedMarker: LED_MARKER };
    assert.deepEqual(await diffAgainstDisk(plan), ["changed: index.mdx", "stale: gone.mdx"]);
    const result = await emit(plan);
    assert.deepEqual(result.written, ["index.mdx"]);
    assert.deepEqual(result.removed, ["gone.mdx"]);
    assert.equal(await readFile(join(root, "index.mdx"), "utf8"), plan.pages[0]?.contents);
    assert.deepEqual(await diffAgainstDisk(plan), []);
  });

  it("regenerates a legacy-marker tree under the default marker", async () => {
    await emit({ root, pages: [markedPage("index.mdx", "a", LED_MARKER)], generatedMarker: LED_MARKER });

    const result = await emit({ root, pages: [page("index.mdx", "a")] });
    assert.deepEqual(result.written, ["index.mdx"]);
    assert.ok((await readFile(join(root, "index.mdx"), "utf8")).startsWith(`---\n${GENERATED_MARKER}\n`));
  });

  it("OUT-02: generating twice produces identical bytes and no writes", async () => {
    const plan = {
      root,
      pages: [page("index.mdx", "a"), page("records/index.mdx", "b"), page("records/x.mdx", "c")],
    };
    await emit(plan);
    const before = await snapshotTree(root);

    const second = await emit(plan);
    assert.deepEqual(second.written, []);
    assert.deepEqual(second.removed, []);
    assert.deepEqual(second.unchanged, ["index.mdx", "records/index.mdx", "records/x.mdx"]);
    assert.deepEqual(await snapshotTree(root), before);
  });

  it("OUT-03: check-only mode reports drift and never writes", async () => {
    await emit({ root, pages: [page("index.mdx", "a"), page("stale.mdx", "b")] });
    const before = await snapshotTree(root);

    const drift = await diffAgainstDisk({
      root,
      pages: [page("index.mdx", "changed"), page("records/new.mdx", "c")],
    });
    assert.deepEqual(drift, ["changed: index.mdx", "missing: records/new.mdx", "stale: stale.mdx"]);
    assert.deepEqual(await snapshotTree(root), before);
  });

  it("check-only mode on a missing root creates nothing", async () => {
    const missing = join(root, "not-yet");
    assert.deepEqual(await diffAgainstDisk({ root: missing, pages: [page("index.mdx", "a")] }), [
      "missing: index.mdx",
    ]);
    await assert.rejects(lstat(missing));
  });
});
