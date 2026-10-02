/** Deterministic publication of the manifest-selected, validated WRL models. */

import { copyFile, lstat, mkdir, readdir, readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

import type { ValidationOutcome } from "../../core/adapter.ts";
import { assertNotSymlink, assertPathNotSymlinked } from "../../core/emit.ts";
import { fail } from "../../core/errors.ts";
import { byCodeUnit } from "../../core/ids.ts";
import type { PublicationPolicy } from "../../core/publication.ts";
import { readEvidenceIndex, type EvidenceIndexOptions } from "./index.ts";
import { assertPathWithinBase, assertSafePreviewAssetName } from "./references.ts";

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

/**
 * The extra proof model publication needs beyond plain evidence reading: the
 * canonical validator's own outcome (so the CLI's already-run check gates
 * this too, instead of publishing against unvalidated data), and the policy
 * used to assert the selection is fresh before a single file is planned.
 */
export type ModelAssetPlanOptions = EvidenceIndexOptions & {
  readonly policy: PublicationPolicy;
  readonly validation: ValidationOutcome;
};

export async function buildModelAssetPlan(
  options: ModelAssetPlanOptions,
): Promise<readonly ModelAssetPlanEntry[]> {
  const { policy, validation } = options;
  if (!validation.ok) {
    fail("VALIDATION_FAILED", "model publication requires a passing canonical validator run", {
      command: validation.command,
      exitCode: validation.exitCode,
    });
  }
  const index = await readEvidenceIndex(options);
  // Fatal when the committed selection names something the provider lost, or
  // the corpus size moved — the same freshness gate `projectIndex` runs, but
  // model publication is a separate CLI path that never calls it otherwise.
  policy.assertSelectionFresh(
    index.records.map((entry) => entry.record.record_id),
    index.sourceIds,
    index.integrationRules.length,
  );

  const packages = index.references?.packages;
  if (packages === undefined) {
    fail("ADAPTER_CONTRACT", "model publication requires a validated reference contract");
  }
  // Defense in depth: `readCircuitReferenceContract` already enforced this
  // same lock while building `index.references`, so a mismatch here would
  // mean that contract was bypassed.
  const expectedPackages = options.selection.expect.packages;
  if (expectedPackages !== undefined && packages.length !== expectedPackages) {
    fail("ADAPTER_CONTRACT", `model publication requires exactly ${expectedPackages} selected packages`, {
      expected: expectedPackages,
      actual: packages.length,
    });
  }

  const pathBase = options.reference?.footprintPathBase ?? options.paths.projectRoot;
  const names = new Set<string>();
  const entries: ModelAssetPlanEntry[] = [];
  for (const descriptor of packages) {
    if (descriptor.modelPath === null) continue;
    const name = basename(descriptor.modelPath);
    assertSafePreviewAssetName(name, descriptor.recordIds[0] ?? descriptor.packageId);
    if (extname(name).toLowerCase() !== ".wrl" || names.has(name)) {
      fail("ADAPTER_CONTRACT", "selected model names must be unique WRL basenames", { name });
    }
    names.add(name);
    entries.push({
      name,
      source: containedRepositoryFile(pathBase, descriptor.modelPath),
    });
  }
  return entries.sort((a, b) => byCodeUnit(a.name, b.name));
}

export async function publishModelAssets(
  options: ModelAssetPlanOptions,
  dryRun: boolean,
): Promise<ModelAssetResult> {
  const plan = await buildModelAssetPlan(options);
  return syncModelAssets(plan, options.paths.projectRoot, options.paths.modelPublicRoot, dryRun);
}

export async function syncModelAssets(
  plan: readonly ModelAssetPlanEntry[],
  projectRoot: string,
  outputRoot: string,
  dryRun: boolean,
): Promise<ModelAssetResult> {
  // Walk only from the project root down to the output root — never from the
  // filesystem root — so an ancestor symlink above the project (macOS
  // `/tmp` -> `/private/tmp`, or a symlinked checkout) does not fail a
  // publish that never reads or writes through it.
  await assertPathNotSymlinked(projectRoot, outputRoot);
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

function containedRepositoryFile(root: string, path: string): string {
  const base = resolve(root);
  const target = resolve(base, path);
  assertPathWithinBase(base, target, "PATH_CONTAINMENT", "selected model escapes its path base", { path });
  return target;
}

function containedPublicTarget(outputRoot: string, name: string): string {
  const base = resolve(outputRoot);
  const target = resolve(base, name);
  assertPathWithinBase(base, target, "PATH_CONTAINMENT", "published model escapes its output root", { name });
  return target;
}

async function listPublishedFiles(outputRoot: string) {
  try {
    return await readdir(outputRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
