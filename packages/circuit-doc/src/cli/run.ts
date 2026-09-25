/**
 * The one generation body `generate`, `check` and the watcher share. `check`
 * only refuses to write: a check that exercised a different path could pass
 * while the real generator produced something else.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ValidationOutcome, ValidationRunner } from "../core/adapter.ts";
import { ComponentDocsError } from "../core/errors.ts";
import { runPipeline, type PipelineResult } from "../core/pipeline.ts";
import type { PreflightReport } from "../core/publication.ts";
import { ConfigError } from "../config/errors.ts";
import { createCircuitAdapter } from "../provider/v1/index.ts";
import { UsageError } from "./args.ts";
import { EXIT, type Writer } from "./command.ts";
import type { LoadedProject } from "./project.ts";

export type RunMode = "generate" | "check";

export async function runOnce(
  project: LoadedProject,
  mode: RunMode,
  validator: ValidationRunner,
): Promise<PipelineResult> {
  const adapter = createCircuitAdapter({
    paths: project.paths,
    selection: project.selection,
    matrix: project.matrix,
    validator,
    integrationOwnerSkill: project.integrationOwnerSkill,
    reference: project.reference,
  });
  return runPipeline(adapter, {
    generatedRoot: project.paths.generatedRoot,
    dryRun: mode === "check",
    render: project.render,
  });
}

/** A validator that replays one already-obtained outcome, so a run never invokes Python twice. */
export function replayValidator(outcome: ValidationOutcome): ValidationRunner {
  return async () => outcome;
}

/** Deterministic: sorted, no timestamps, trailing newline, so it can be diffed. */
export function serializeReport(report: PreflightReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export async function writeReport(project: LoadedProject, report: PreflightReport): Promise<void> {
  await mkdir(dirname(project.paths.preflightFile), { recursive: true });
  await writeFile(project.paths.preflightFile, serializeReport(report), "utf8");
}

export function summarize(report: PreflightReport): string {
  const denied = report.fields.filter((field) => field.decision === "DENY");
  const withheld = denied.reduce((sum, field) => sum + field.withheld, 0);
  const allowedUrls = report.urls.filter((entry) => entry.decision === "ALLOW").length;

  return [
    `provider        ${report.provider.id} (contract v${report.provider.contractVersion})`,
    `view model      v${report.viewModelVersion}`,
    `records         ${report.records.selected} selected of ${report.records.available} available`,
    `sources         ${report.sources.selected} selected of ${report.sources.available} available, ${report.sources.linkable} linkable`,
    `fields          ${report.fields.length - denied.length} publish, ${denied.length} deny (${withheld} values withheld)`,
    `urls            ${allowedUrls} allowed of ${report.urls.length} considered`,
    ...Object.entries(report.counts).map(([key, value]) => `${key.padEnd(15)} ${value}`),
  ].join("\n");
}

/** Print a failure and return its exit code: config/usage -> 2, check failures -> 1. */
export function reportFailure(error: unknown, stderr: Writer): number {
  if (error instanceof ConfigError) {
    stderr.write(`${error.message}\n`);
    return EXIT.USAGE;
  }
  if (error instanceof UsageError) {
    stderr.write(`usage error: ${error.message}\n`);
    return EXIT.USAGE;
  }
  if (error instanceof ComponentDocsError) {
    stderr.write(`${error.message}\n`);
    for (const [key, value] of Object.entries(error.detail)) {
      if (Array.isArray(value)) {
        stderr.write(`  ${key}:\n`);
        for (const entry of value) stderr.write(`    ${entry}\n`);
      } else {
        stderr.write(`  ${key}: ${String(value)}\n`);
      }
    }
    return EXIT.FAILED;
  }
  stderr.write(`${(error as Error).stack ?? String(error)}\n`);
  return EXIT.FAILED;
}
