/**
 * `zudo-circuit-doc models [--check]`: publishes the selected WRL models into
 * `<docs.publicRoot>/assets/component-previews/models/`, planned only from a
 * validated, freshness-checked evidence index (#15). `--check` writes nothing.
 */

import { fail } from "../../core/errors.ts";
import { PublicationPolicy } from "../../core/publication.ts";
import { createProjectValidator } from "../../config/map.ts";
import { publishModelAssets } from "../../provider/v1/model-assets.ts";
import { EXIT, flag, type CommandContext, type CommandModule } from "../command.ts";
import { PROJECT_COMMANDS } from "../project.ts";
import { reportFailure } from "../run.ts";

export const command: CommandModule = {
  meta: {
    name: "models",
    summary: "publish (or --check) the selected 3D model previews",
    flags: [{ name: "--check", description: "report drift without writing" }],
    exitCodes: [
      { code: EXIT.PASS, meaning: "models published / up to date" },
      { code: EXIT.FAILED, meaning: "validation failed or the published models are out of date" },
      { code: EXIT.USAGE, meaning: "usage or config error" },
    ],
  },
  run,
};

async function run(context: CommandContext): Promise<number> {
  const { io } = context;
  const dryRun = flag(context.args, "--check");
  try {
    const project = await context.loadProject();
    const validation = await createProjectValidator(project, io.env)();
    if (!validation.ok && validation.stderr !== "") io.stderr.write(`${validation.stderr.trimEnd()}\n`);
    const result = await publishModelAssets(
      {
        paths: project.paths,
        selection: project.selection,
        reference: project.reference,
        policy: new PublicationPolicy(project.matrix, project.selection),
        validation,
      },
      dryRun,
    );
    io.stdout.write(
      `models          ${result.expected} selected; ${result.written.length} written, ${result.unchanged.length} unchanged\n`,
    );
    if (result.drift.length > 0) {
      const root = project.label(project.paths.modelPublicRoot);
      fail("GENERATED_DRIFT", `published model assets are out of date; run \`${PROJECT_COMMANDS.models}\``, {
        root,
        drift: result.drift,
      });
    }
    return EXIT.PASS;
  } catch (error) {
    return reportFailure(error, io.stderr);
  }
}
