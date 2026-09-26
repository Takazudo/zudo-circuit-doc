/**
 * `zudo-circuit-doc check-built`: the built-output reference checker —
 * replaces the #18 stub wholesale (#19).
 */

import { PublicationPolicy } from "../../core/publication.ts";
import { createProjectValidator } from "../../config/map.ts";
import { projectIndex, readEvidenceIndex } from "../../provider/v1/index.ts";
import { checkBuiltReferences } from "../../scan/built-references.ts";
import { EXIT, type CommandContext, type CommandModule } from "../command.ts";
import { reportFailure } from "../run.ts";

export const command: CommandModule = {
  meta: {
    name: "check-built",
    summary: "check the built site's component pages, previews and models against the selection",
    exitCodes: [
      { code: EXIT.PASS, meaning: "built output matches the selection" },
      { code: EXIT.FAILED, meaning: "built output is missing or has unexpected component artifacts" },
      { code: EXIT.USAGE, meaning: "usage/config error" },
    ],
  },
  run,
};

async function run(context: CommandContext): Promise<number> {
  const { io } = context;
  try {
    const project = await context.loadProject();
    const validation = await createProjectValidator(project, io.env)();
    if (!validation.ok) {
      if (validation.stderr !== "") io.stderr.write(`${validation.stderr.trimEnd()}\n`);
      io.stderr.write("check-built: the canonical validator must pass before the built site can be trusted\n");
      return EXIT.FAILED;
    }

    const index = await readEvidenceIndex({
      paths: project.paths,
      selection: project.selection,
      reference: project.reference,
    });
    const policy = new PublicationPolicy(project.matrix, project.selection);
    const model = projectIndex(index, policy, { integrationOwnerSkill: project.integrationOwnerSkill });

    const report = await checkBuiltReferences({ distRoot: project.paths.distRoot, model });
    io.stdout.write(
      `built component references passed: ${report.records} record(s), ${report.footprints} footprint SVG(s), ${report.models} model(s); catalog viewer-free\n`,
    );
    return EXIT.PASS;
  } catch (error) {
    return reportFailure(error, io.stderr);
  }
}
