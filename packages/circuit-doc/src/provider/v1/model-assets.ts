/** Deterministic publication of the manifest-selected, validated WRL models. */

import { copyFile, lstat, mkdir, readdir, readFile, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { fail } from "../../core/errors.ts";
import { assertNotSymlink } from "../../core/emit.ts";
import { byCodeUnit } from "../../core/ids.ts";
import { readEvidenceIndex, type EvidenceIndexOptions } from "./index.ts";
import { assertSafePreviewAssetName, UPSTREAM_EXPECTED_PACKAGES } from "./references.ts";

export type ModelAssetPlanEntry = {
  readonly name: string;
  readonly source: string;
};

export type ModelAssetResult = {
  readonly expected: number;
  readonly written: readonly string[];
  readonly unchanged: readonly string[];
  readonly removed: readonly string[];
  readonly drift: readonly string[];
};

export async function buildModelAssetPlan(
  options: EvidenceIndexOptions,
): Promise<readonly ModelAssetPlanEntry[]> {
  const expectedPackages = options.reference?.expectedPackages ?? UPSTREAM_EXPECTED_PACKAGES;
  const index = await readEvidenceIndex(options);
  const packages = index.references?.packages;
  if (packages === undefined || packages.length !== expectedPackages) {
    fail("ADAPTER_CONTRACT", `model publication requires exactly ${expectedPackages} selected packages`, {
      actual: packages?.length ?? 0,
    });
  }

  const names = new Set<string>();
  const entries: ModelAssetPlanEntry[] = [];
  for (const descriptor of packages) {
    const name = basename(descriptor.modelPath);
    assertSafePreviewAssetName(name, descriptor.recordIds[0] ?? descriptor.packageId);
    if (extname(name).toLowerCase() !== ".wrl" || names.has(name)) {
      fail("ADAPTER_CONTRACT", "selected model names must be unique WRL basenames", { name });
    }
    names.add(name);
    entries.push({
      name,
      source: containedRepositoryFile(options.paths.projectRoot, descriptor.modelPath),
    });
  }
  return entries.sort((a, b) => byCodeUnit(a.name, b.name));
}

export async function publishModelAssets(
  options: EvidenceIndexOptions,
  dryRun: boolean,
): Promise<ModelAssetResult> {
  const plan = await buildModelAssetPlan(options);
  return syncModelAssets(plan, options.paths.modelPublicRoot, dryRun);
}

export async function syncModelAssets(
  plan: readonly ModelAssetPlanEntry[],
  outputRoot: string,
  dryRun: boolean,
): Promise<ModelAssetResult> {
  await assertSafeOutputRoot(outputRoot);
  if (!dryRun) await mkdir(outputRoot, { recursive: true });

  const expected = new Set(plan.map((entry) => entry.name));
  const written: string[] = [];
  const unchanged: string[] = [];
  const removed: string[] = [];
  const drift: string[] = [];

  for (const entry of plan) {
    assertSafePreviewAssetName(entry.name, "model-publication");
    if (extname(entry.name).toLowerCase() !== ".wrl") {
      fail("PUBLICATION_POLICY", "only WRL files may be published as model previews", { name: entry.name });
    }
    const target = containedPublicTarget(outputRoot, entry.name);
    const sourceBytes = await readFile(entry.source);
    const targetStat = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (targetStat !== null && (!targetStat.isFile() || targetStat.isSymbolicLink())) {
      fail("PATH_CONTAINMENT", "published model must be a regular non-symlink file", {
        path: entry.name,
      });
    }
    const targetBytes = targetStat === null ? null : await readFile(target);
    if (targetBytes !== null && targetBytes.equals(sourceBytes)) {
      unchanged.push(entry.name);
    } else if (dryRun) {
      drift.push(`${targetBytes === null ? "missing" : "changed"}: ${entry.name}`);
    } else {
      await assertNotSymlink(target);
      await copyFile(entry.source, target);
      written.push(entry.name);
    }
  }

  for (const entry of await listPublishedFiles(outputRoot)) {
    if (expected.has(entry.name)) continue;
    if (entry.isSymbolicLink() || !entry.isFile()) {
      fail("PATH_CONTAINMENT", "model publication directory contains an unsafe entry", {
        path: entry.name,
      });
    }
    if (dryRun) {
      drift.push(`extra: ${entry.name}`);
    } else {
      // Deliberately refuse to delete unknown files here. Generated model assets
      // are binary and carry no ownership marker, so silent deletion is unsafe.
      fail("GENERATED_DRIFT", "model publication directory contains an extra file", {
        path: entry.name,
        hint: "remove the reviewed stale asset explicitly, then regenerate",
      });
    }
  }

  return {
    expected: plan.length,
    written: written.sort(byCodeUnit),
    unchanged: unchanged.sort(byCodeUnit),
    removed,
    drift: drift.sort(byCodeUnit),
  };
}

function containedRepositoryFile(projectRoot: string, path: string): string {
  const root = resolve(projectRoot);
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail("PATH_CONTAINMENT", "selected model escapes the repository", { path });
  }
  return target;
}

function containedPublicTarget(outputRoot: string, name: string): string {
  const target = resolve(outputRoot, name);
  const rel = relative(resolve(outputRoot), target);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail("PATH_CONTAINMENT", "published model escapes its output root", { name });
  }
  return target;
}

async function assertSafeOutputRoot(outputRoot: string): Promise<void> {
  const resolvedRoot = resolve(outputRoot);
  const segments = resolvedRoot.split(sep).filter(Boolean);
  let current = isAbsolute(resolvedRoot) ? sep : "";
  for (const segment of segments) {
    current = join(current, segment);
    await assertNotSymlink(current);
  }
  try {
    await realpath(outputRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function listPublishedFiles(outputRoot: string) {
  try {
    return await readdir(outputRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
