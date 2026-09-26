/**
 * `zudo-circuit-doc check`: read-only. Fails when anything committed differs
 * from what a fresh run would produce. In order:
 *
 *   1. the canonical validator;
 *   2. a dry-run generation diff (including ownership conflicts);
 *   3. the preflight report comparison;
 *   4. `models --check`;
 *   5. `footprints check`.
 *
 * The validator runs once; steps 2 and 4 replay its outcome. Every later step
 * still runs after one fails, so a single `check` reports every problem.
 */

import { readFile } from "node:fs/promises";

import type { ValidationOutcome } from "../../core/adapter.ts";
import { PublicationPolicy, type PreflightReport } from "../../core/publication.ts";
import { createProjectValidator } from "../../config/map.ts";
import { publishModelAssets } from "../../provider/v1/model-assets.ts";
import { EXIT, type CliIo, type CommandContext, type CommandModule } from "../command.ts";
import { PROJECT_COMMANDS, type LoadedProject } from "../project.ts";
import { replayValidator, reportFailure, runOnce, serializeReport, summarize } from "../run.ts";
import { checkFootprintsStep } from "./footprints.ts";

export const command: CommandModule = {
  meta: {
    name: "check",
    summary: "read-only: validator, generated-page drift, preflight, models and footprints",
    exitCodes: [
      { code: EXIT.PASS, meaning: "everything is up to date" },
      { code: EXIT.FAILED, meaning: "validation failed or generated output is out of date" },
      { code: EXIT.USAGE, meaning: "usage or config error (or a step that is not implemented yet)" },
      { code: EXIT.NOT_RUN, meaning: "a step could not run because an optional tool is missing" },
    ],
  },
  run,
};

type StepResult = { readonly name: string; readonly exitCode: number; readonly note: string };

async function run(context: CommandContext): Promise<number> {
  const { io } = context;
  let project: LoadedProject;
  try {
    project = await context.loadProject();
  } catch (error) {
    return reportFailure(error, io.stderr);
  }

  const results: StepResult[] = [];
  const step = (name: string, exitCode: number, note: string): void => {
    results.push({ name, exitCode, note });
    io.stdout.write(`${exitCode === EXIT.PASS ? "ok  " : "FAIL"} ${name}: ${note}\n`);
  };

  // 1. validator
  const validation = await createProjectValidator(project, io.env)();
  if (validation.stdout !== "") io.stdout.write(validation.stdout.endsWith("\n") ? validation.stdout : `${validation.stdout}\n`);
  if (!validation.ok) {
    if (validation.stderr !== "") io.stderr.write(validation.stderr.endsWith("\n") ? validation.stderr : `${validation.stderr}\n`);
    step("validate", validation.exitCode === EXIT.USAGE ? EXIT.USAGE : EXIT.FAILED, `validator exited ${validation.exitCode}`);
    return finish(results, io);
  }
  step("validate", EXIT.PASS, "canonical validator passed");

  // 2 + 3. generated pages and preflight
  const report = await generatedStep(project, validation, io, step);
  if (report !== null) await preflightStep(project, report, step);

  // 4. models
  await modelsStep(project, validation, io, step);

  // 5. footprints
  if (!project.config.cad.enabled && project.selection.expect.packages === 0) {
    step(
      "footprints",
      EXIT.PASS,
      "ok: zero selected footprints (cad disabled, expect.packages = 0: no footprint or 3D model is published)",
    );
  } else {
    const code = await checkFootprintsStep(project, io);
    step("footprints", code, code === EXIT.PASS ? "previews up to date" : `footprints check exited ${code}`);
  }

  return finish(results, io);
}

async function generatedStep(
  project: LoadedProject,
  validation: ValidationOutcome,
  io: CliIo,
  step: (name: string, exitCode: number, note: string) => void,
): Promise<PreflightReport | null> {
  try {
    const result = await runOnce(project, "check", replayValidator(validation));
    io.stdout.write(`${summarize(result.report)}\n`);
    const root = project.label(project.paths.generatedRoot);
    if (result.drift.length > 0) {
      reportDrift(io, "generated pages are out of date", result.drift.map((entry) => prefixPath(entry, root)));
      step("generated pages", EXIT.FAILED, `${result.drift.length} drifted; run \`${PROJECT_COMMANDS.generate}\``);
    } else {
      step("generated pages", EXIT.PASS, `${root} is up to date`);
    }
    return result.report;
  } catch (error) {
    step("generated pages", reportFailure(error, io.stderr), "generation failed");
    return null;
  }
}

async function preflightStep(
  project: LoadedProject,
  report: PreflightReport,
  step: (name: string, exitCode: number, note: string) => void,
): Promise<void> {
  const label = project.label(project.paths.preflightFile);
  const actual = await readFile(project.paths.preflightFile, "utf8").catch(() => null);
  if (actual === null) {
    step("preflight", EXIT.FAILED, `missing: ${label}; run \`${PROJECT_COMMANDS.generate}\``);
  } else if (actual !== serializeReport(report)) {
    step("preflight", EXIT.FAILED, `changed: ${label}; run \`${PROJECT_COMMANDS.generate}\``);
  } else {
    step("preflight", EXIT.PASS, `${label} is up to date`);
  }
}

async function modelsStep(
  project: LoadedProject,
  validation: ValidationOutcome,
  io: CliIo,
  step: (name: string, exitCode: number, note: string) => void,
): Promise<void> {
  try {
    const result = await publishModelAssets(
      {
        paths: project.paths,
        selection: project.selection,
        reference: project.reference,
        policy: new PublicationPolicy(project.matrix, project.selection),
        validation,
      },
      true,
    );
    const root = project.label(project.paths.modelPublicRoot);
    if (result.drift.length > 0) {
      reportDrift(io, "published model assets are out of date", result.drift.map((entry) => prefixPath(entry, root)));
      step("models", EXIT.FAILED, `${result.drift.length} drifted; run \`${PROJECT_COMMANDS.models}\``);
    } else {
      step("models", EXIT.PASS, `${result.expected} selected, up to date`);
    }
  } catch (error) {
    step("models", reportFailure(error, io.stderr), "model check failed");
  }
}

function reportDrift(io: CliIo, title: string, drift: readonly string[]): void {
  io.stderr.write(`[GENERATED_DRIFT] ${title}\n`);
  for (const entry of drift) io.stderr.write(`  ${entry}\n`);
}

/** `changed: index.mdx` -> `changed: doc/.../components/index.mdx` (config-relative). */
function prefixPath(entry: string, root: string): string {
  const at = entry.indexOf(": ");
  return at === -1 ? entry : `${entry.slice(0, at)}: ${root}/${entry.slice(at + 2)}`;
}

function finish(results: readonly StepResult[], io: CliIo): number {
  const codes = results.map((result) => result.exitCode);
  const exitCode = codes.includes(EXIT.FAILED)
    ? EXIT.FAILED
    : codes.includes(EXIT.USAGE)
      ? EXIT.USAGE
      : codes.includes(EXIT.NOT_RUN)
        ? EXIT.NOT_RUN
        : EXIT.PASS;
  io.stdout.write(
    exitCode === EXIT.PASS
      ? "check passed: generated output is up to date\n"
      : `check failed (exit ${exitCode}); fix the steps marked FAIL, then run \`${PROJECT_COMMANDS.check}\`\n`,
  );
  return exitCode;
}
