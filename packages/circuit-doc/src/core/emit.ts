/**
 * Writing the exclusively-owned generated tree.
 *
 * The generator owns exactly one directory and never reaches outside it. It
 * does not `rm -rf` that directory either. `emit` runs in four passes:
 *
 *   1. plan     — resolve every target and every leftover, touching nothing
 *   2. validate — collect EVERY ownership conflict; any conflict aborts here,
 *                 before a single byte changes
 *   3. write    — this run's pages
 *   4. remove   — the pre-validated leftovers
 *
 * A conflict is a file under the owned root that this generator did not write:
 * a target or a leftover `.mdx` without a generated marker, or any non-`.mdx`
 * file. That is the case where someone hand-authored content into a generated
 * tree, and overwriting or deleting it silently would be the worst possible
 * outcome — as would failing half-way through with some pages already written.
 */

import { mkdir, lstat, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { fail } from "./errors.ts";
import { byCodeUnit } from "./ids.ts";
import { GENERATED_MARKER, isGeneratedContents, type GeneratedPage } from "./page.ts";

export type EmitPlan = {
  /** Absolute path of the exclusively-owned generated root. */
  readonly root: string;
  readonly pages: readonly GeneratedPage[];
  /** Marker this run writes; defaults to `GENERATED_MARKER`. Legacy markers are always recognized. */
  readonly generatedMarker?: string;
};

export type EmitResult = {
  readonly written: readonly string[];
  readonly removed: readonly string[];
  readonly unchanged: readonly string[];
};

/**
 * Assert that `candidate` resolves inside `root`. String prefixes are not
 * enough (`/a/bc` starts with `/a/b`), so compare on path segments.
 */
export function assertContained(root: string, candidate: string, what: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);

  // `relative` returns an absolute path when the two live on different Windows
  // drives, and "" when they are the same path — neither is a contained child.
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail("PATH_CONTAINMENT", `${what} escapes its owned root`, {
      what,
      root: resolvedRoot,
      candidate: resolvedCandidate,
    });
  }
  return resolvedCandidate;
}

/**
 * Refuse to traverse a symlink. Checked with `lstat` per path so a symlinked
 * directory in the middle of a walk cannot redirect reads or writes outside
 * the tree we believe we are in.
 */
export async function assertNotSymlink(path: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      fail("PATH_CONTAINMENT", `${path} is a symlink`, { path });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * Refuse a symlink anywhere on the walk from `root` down to `target`.
 *
 * `assertContained` is **lexical**: it proves the resolved string sits under the
 * root, not that walking there stays inside it. `mkdir -p`, `writeFile` and
 * `lstat` all follow an intermediate symlink, so checking only the leaf lets a
 * symlinked `records/` redirect a write outside the owned tree entirely — and
 * the pruning walk at the end of `emit` notices only *after* the bytes have
 * landed. Reproduced before this was added: a symlinked `records/` wrote its
 * page into the link target and then raised PATH_CONTAINMENT, i.e. the error
 * arrived one write too late.
 *
 * Segments that do not exist yet are fine (`assertNotSymlink` no-ops on ENOENT)
 * — `mkdir` will create them as real directories.
 */
export async function assertPathNotSymlinked(root: string, target: string): Promise<void> {
  const resolvedRoot = resolve(root);
  await assertNotSymlink(resolvedRoot);

  let current = resolvedRoot;
  for (const segment of relative(resolvedRoot, resolve(target)).split(sep)) {
    if (segment === "") continue;
    current = join(current, segment);
    await assertNotSymlink(current);
  }
}

type PlannedTarget = {
  readonly page: GeneratedPage;
  readonly target: string;
  readonly existing: string | null;
};

type Ownership = {
  readonly root: string;
  readonly targets: readonly PlannedTarget[];
  /** Generated `.mdx` files under the root that this run does not produce. */
  readonly leftovers: readonly string[];
  /** Relative paths this generator does not own, sorted. */
  readonly conflicts: readonly string[];
};

/**
 * Read-only pass shared by `emit` and `diffAgainstDisk`: containment and
 * symlink refusal for every target, then an ownership verdict for every file
 * under the root. Creates no directory and writes nothing.
 */
async function planOwnership(plan: EmitPlan): Promise<Ownership> {
  const root = resolve(plan.root);
  const marker = plan.generatedMarker ?? GENERATED_MARKER;
  const targets: PlannedTarget[] = [];
  const conflicts: string[] = [];
  const owned = new Set<string>();

  await assertNotSymlink(root);

  for (const page of plan.pages) {
    const target = assertContained(root, join(root, page.relativePath), page.relativePath);
    owned.add(target);
    // Before any mkdir: mkdir -p happily traverses an existing symlinked
    // parent, so a check that runs afterwards has already let the directory be
    // created outside the owned tree.
    await assertPathNotSymlinked(root, target);
    const existing = await readIfPresent(target);
    if (existing !== null && existing !== page.contents && !isGeneratedContents(existing, marker)) {
      conflicts.push(page.relativePath);
    }
    targets.push({ page, target, existing });
  }

  const leftovers: string[] = [];
  const { mdx, other } = await walkTree(root);
  for (const path of mdx) {
    if (owned.has(path)) continue;
    const contents = await readIfPresent(path);
    if (contents === null) continue;
    if (isGeneratedContents(contents, marker)) leftovers.push(path);
    else conflicts.push(toPosix(root, path));
  }
  for (const path of other) conflicts.push(toPosix(root, path));

  return { root, targets, leftovers, conflicts: conflicts.sort(byCodeUnit) };
}

export async function emit(plan: EmitPlan): Promise<EmitResult> {
  const { root, targets, leftovers, conflicts } = await planOwnership(plan);

  if (conflicts.length > 0) {
    fail("PATH_CONTAINMENT", "files not written by this generator found inside the generated tree", {
      paths: conflicts,
      hint: `move them out of ${root} — this directory is generated and exclusively owned`,
    });
  }

  await mkdir(root, { recursive: true });

  const written: string[] = [];
  const unchanged: string[] = [];

  for (const { page, target, existing } of targets) {
    if (existing === page.contents) {
      unchanged.push(page.relativePath);
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await assertNotSymlink(target);
    await writeFile(target, page.contents, "utf8");
    written.push(page.relativePath);
  }

  const removed: string[] = [];
  for (const path of leftovers) {
    await rm(path);
    removed.push(toPosix(root, path));
  }

  return {
    written: written.sort(byCodeUnit),
    removed: removed.sort(byCodeUnit),
    unchanged: unchanged.sort(byCodeUnit),
  };
}

/** Compare a plan against what is on disk without touching anything. */
export async function diffAgainstDisk(plan: EmitPlan): Promise<readonly string[]> {
  // A symlinked parent would point the drift read at a file outside the owned
  // tree, so a drift check could report "up to date" against content this
  // generator does not own. `planOwnership` applies the same guard as the write
  // path, for the same reason.
  const { root, targets, leftovers, conflicts } = await planOwnership(plan);
  const conflicting = new Set(conflicts);
  const drift: string[] = conflicts.map((path) => `conflict: ${path}`);

  for (const { page, existing } of targets) {
    if (conflicting.has(page.relativePath)) continue;
    if (existing === null) drift.push(`missing: ${page.relativePath}`);
    else if (existing.replace(/\r\n/gu, "\n") !== page.contents) drift.push(`changed: ${page.relativePath}`);
  }
  for (const path of leftovers) drift.push(`stale: ${toPosix(root, path)}`);

  return drift.sort(byCodeUnit);
}

/** Depth-first walk of the owned tree, refusing to follow symlinks. */
async function walkTree(root: string): Promise<{ mdx: string[]; other: string[] }> {
  const mdx: string[] = [];
  const other: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        fail("PATH_CONTAINMENT", "symlink inside the generated tree", {
          path: toPosix(root, path),
        });
      }
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile() && entry.name.endsWith(".mdx")) mdx.push(path);
      else other.push(path);
    }
  }

  return { mdx, other };
}

function toPosix(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
