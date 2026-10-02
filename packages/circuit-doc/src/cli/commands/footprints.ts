/**
 * `zudo-circuit-doc footprints check|generate` (issue #20; replaces the #18
 * stub). Keeps both exports the stub declared: `command`, and
 * `checkFootprintsStep`, which `check` (commands/check.ts) calls as its own
 * footprints step — that caller already special-cases CAD-disabled +
 * `expect.packages === 0`, so `checkFootprintsStep` only needs to handle
 * every state it can still be called with, including CAD-enabled zero-package
 * projects.
 */

import type { PreviewRendererConfig } from "../../config/define.ts";
import { fail } from "../../core/errors.ts";
import { checkFootprintPreviews } from "../../footprint-previews/check.ts";
import { isDockerAvailable, isImagePresent, pullImage, realDockerRunner } from "../../footprint-previews/docker.ts";
import { generateFootprintPreviews } from "../../footprint-previews/generate.ts";
import { footprintSelectionsFromIndex } from "../../footprint-previews/selection.ts";
import { readEvidenceIndex } from "../../provider/v1/index.ts";
import { EXIT, flag, type CliIo, type CommandContext, type CommandModule } from "../command.ts";
import type { LoadedProject } from "../project.ts";
import { reportFailure } from "../run.ts";

export const command: CommandModule = {
  meta: {
    name: "footprints",
    summary: "generate (Docker + KiCad) or check the footprint preview SVGs",
    positionals: [{ name: "action", description: "generate or check", required: true, choices: ["generate", "check"] }],
    flags: [{ name: "--pull", description: "generate: pull the pinned KiCad image when it is absent" }],
    exitCodes: [
      { code: EXIT.PASS, meaning: "previews generated / up to date" },
      { code: EXIT.FAILED, meaning: "previews are out of date or unsafe" },
      { code: EXIT.USAGE, meaning: "usage/config error" },
      { code: EXIT.NOT_RUN, meaning: "not run: Docker is required for generate (check does not need it)" },
    ],
  },
  run,
};

async function run(context: CommandContext): Promise<number> {
  const { io, args } = context;
  let project: LoadedProject;
  try {
    project = await context.loadProject();
  } catch (error) {
    return reportFailure(error, io.stderr);
  }

  const action = args.positionals[0];
  if (action === "check") return checkFootprintsStep(project, io);
  if (action === "generate") return runGenerate(project, io, flag(args, "--pull"));
  io.stderr.write(`footprints: unknown action ${JSON.stringify(action)}\n`);
  return EXIT.USAGE;
}

/** `check`'s footprints step (offline, Docker-free). */
export async function checkFootprintsStep(project: LoadedProject, io: CliIo): Promise<number> {
  try {
    const index = await readEvidenceIndex({ paths: project.paths, selection: project.selection, reference: project.reference });
    const selections = footprintSelectionsFromIndex(index, project.selection);
    await checkFootprintPreviews({
      selections,
      footprintMasterRoot: project.paths.footprintMasterRoot,
      footprintLibraryRoot: project.paths.footprintLibraryRoot,
      previewRoot: project.paths.footprintPreviewRoot,
      renderer: rendererOf(project),
      publishMembership: project.matrix["reference.package.recordIds"] === "PUBLISH",
    });
    io.stdout.write(
      selections.length === 0
        ? "ok: 0 selected footprints; nothing to check\n"
        : `${selections.length} committed footprint previews are current and safe\n`,
    );
    return EXIT.PASS;
  } catch (error) {
    return reportFailure(error, io.stderr);
  }
}

async function runGenerate(project: LoadedProject, io: CliIo, pull: boolean): Promise<number> {
  try {
    const index = await readEvidenceIndex({ paths: project.paths, selection: project.selection, reference: project.reference });
    const selections = footprintSelectionsFromIndex(index, project.selection);
    const runDocker = realDockerRunner;

    if (selections.length > 0) {
      if (!(await isDockerAvailable(runDocker))) {
        io.stderr.write("not run: Docker is required for footprint preview generation (check does not need it)\n");
        return EXIT.NOT_RUN;
      }
      const image = requireRenderer(project).image;
      if (!(await isImagePresent(runDocker, image))) {
        if (pull) {
          io.stdout.write(`pulling ${image}\n`);
          await pullImage(runDocker, image);
        } else {
          io.stderr.write(`not run: pinned image ${image} is not present locally; run \`docker pull ${image}\` or pass --pull\n`);
          return EXIT.NOT_RUN;
        }
      }
    }

    const manifest = await generateFootprintPreviews({
      selections,
      footprintMasterRoot: project.paths.footprintMasterRoot,
      footprintLibraryRoot: project.paths.footprintLibraryRoot,
      previewRoot: project.paths.footprintPreviewRoot,
      renderer: rendererOf(project),
      publishMembership: project.matrix["reference.package.recordIds"] === "PUBLISH",
      runDocker,
    });
    io.stdout.write(
      `generated ${manifest.packages.length} footprint previews in ${project.label(project.paths.footprintPreviewRoot)}\n`,
    );
    return EXIT.PASS;
  } catch (error) {
    return reportFailure(error, io.stderr);
  }
}

/** `undefined` is only ever valid when zero packages are selected (see `generate.ts`/`check.ts`). */
function rendererOf(project: LoadedProject): PreviewRendererConfig | undefined {
  return project.config.cad.enabled ? project.config.cad.previewRenderer : undefined;
}

/**
 * Used only where a nonzero package count already proved CAD is enabled
 * (`readCircuitReferenceContract` fails `ADAPTER_CONTRACT` before resolving
 * any package while CAD is disabled) — `fail` here is defense in depth, not a
 * reachable path.
 */
function requireRenderer(project: LoadedProject): PreviewRendererConfig {
  if (!project.config.cad.enabled) fail("ADAPTER_CONTRACT", "footprint preview generation requires CAD to be enabled");
  return project.config.cad.previewRenderer;
}
