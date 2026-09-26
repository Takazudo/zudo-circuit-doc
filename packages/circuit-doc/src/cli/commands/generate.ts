/**
 * `zudo-circuit-doc generate [--watch]`: runs the pipeline with the packaged
 * validator and writes `docs.generatedContent` plus `docs.preflight`.
 *
 * Runs BEFORE `zfb build` (the project's `build` script orders it), so the
 * content snapshot the site takes already contains this output.
 */

import { createProjectValidator } from "../../config/map.ts";
import { EXIT, flag, type CommandContext, type CommandModule } from "../command.ts";
import { reportFailure, runOnce, summarize, writeReport } from "../run.ts";
import { startGenerateWatch } from "../watch.ts";

export const command: CommandModule = {
  meta: {
    name: "generate",
    summary: "validate the evidence and write the generated component pages and preflight report",
    flags: [{ name: "--watch", description: "regenerate on evidence, selection or config changes" }],
    exitCodes: [
      { code: EXIT.PASS, meaning: "generated (watch: stopped cleanly)" },
      { code: EXIT.FAILED, meaning: "validation, projection or emit failed" },
      { code: EXIT.USAGE, meaning: "usage or config error" },
    ],
  },
  run,
};

async function run(context: CommandContext): Promise<number> {
  const { io } = context;
  if (flag(context.args, "--watch")) return watchUntilAborted(context);

  try {
    const project = await context.loadProject();
    const result = await runOnce(project, "generate", createProjectValidator(project, io.env));
    await writeReport(project, result.report);

    io.stdout.write(`${summarize(result.report)}\n`);
    if (!project.config.cad.enabled && project.selection.expect.packages === 0 && project.selection.recordIds.length > 0) {
      io.stdout.write("references      no footprint or 3D model is published: cad disabled (expect.packages = 0)\n");
    }
    const emitted = result.emitted;
    if (emitted !== null) {
      io.stdout.write(
        `pages           ${emitted.written.length} written, ${emitted.unchanged.length} unchanged, ${emitted.removed.length} removed\n`,
      );
      const root = project.label(project.paths.generatedRoot);
      for (const path of emitted.written) io.stdout.write(`  + ${root}/${path}\n`);
      for (const path of emitted.removed) io.stdout.write(`  - ${root}/${path}\n`);
    }
    io.stdout.write(`preflight       ${project.label(project.paths.preflightFile)}\n`);
    return EXIT.PASS;
  } catch (error) {
    return reportFailure(error, io.stderr);
  }
}

async function watchUntilAborted(context: CommandContext): Promise<number> {
  const { io } = context;
  let watcher;
  try {
    watcher = await startGenerateWatch({
      load: (options) => context.loadProject(options),
      env: io.env,
      stdout: io.stdout,
      stderr: io.stderr,
    });
  } catch (error) {
    return reportFailure(error, io.stderr);
  }

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      io.signal?.removeEventListener("abort", stop);
      resolve();
    };
    if (io.signal?.aborted === true) return stop();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    io.signal?.addEventListener("abort", stop, { once: true });
  });
  watcher.close();
  await watcher.scheduler.idle();
  return EXIT.PASS;
}
