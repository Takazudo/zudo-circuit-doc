/**
 * `zudo-circuit-doc scan [--agent-skill <dir>]`: the post-build publication
 * scan — replaces the #18 stub wholesale (#19).
 *
 * Requires a passing canonical validator (like `models`/`check`): the scan
 * reasons about the projected view model, and projecting unvalidated data
 * would scan against something the build never actually promised to publish.
 */

import { PublicationPolicy } from "../../core/publication.ts";
import { createProjectValidator } from "../../config/map.ts";
import { readCanaries } from "../../provider/v1/canaries.ts";
import { projectIndex, readEvidenceIndex } from "../../provider/v1/index.ts";
import { runArtifactScan } from "../../scan/artifacts.ts";
import { buildScanPolicy } from "../../scan/policy.ts";
import { checkPublicScope } from "../../scan/public-scope.ts";
import { EXIT, flagValue, type CommandContext, type CommandMeta, type CommandModule } from "../command.ts";
import { reportFailure } from "../run.ts";

const meta: CommandMeta = {
  name: "scan",
  summary: "scan the built site for published evidence that should have been withheld",
  flags: [
    {
      name: "--agent-skill",
      kind: "value",
      valueName: "<dir>",
      description: "also scan this agent-skill mirror directory",
    },
  ],
  exitCodes: [
    { code: EXIT.PASS, meaning: "no leak found" },
    { code: EXIT.FAILED, meaning: "a withheld value or credential pattern reached the built output" },
    { code: EXIT.USAGE, meaning: "usage/config error" },
  ],
};

export const command: CommandModule = { meta, run };

async function run(context: CommandContext): Promise<number> {
  const { io } = context;
  const agentSkillRoot = flagValue(context.args, "--agent-skill") ?? null;
  try {
    const project = await context.loadProject();

    // ADR-018: nothing under docs.publicRoot may be a raw evidence/CAD file
    // outside the generator's own preview output or the deliberate-publication
    // allowlist. Checked first: it needs neither the validator's outcome nor a
    // built dist, so a public-scope regression is reported before anything else.
    await checkPublicScope({ publicRoot: project.paths.publicRoot, assets: project.assets });

    const validation = await createProjectValidator(project, io.env)();
    if (!validation.ok) {
      if (validation.stderr !== "") io.stderr.write(`${validation.stderr.trimEnd()}\n`);
      io.stderr.write("scan: the canonical validator must pass before the built site can be trusted\n");
      return EXIT.FAILED;
    }

    const index = await readEvidenceIndex({
      paths: project.paths,
      selection: project.selection,
      reference: project.reference,
    });
    const policy = new PublicationPolicy(project.matrix, project.selection);
    const model = projectIndex(index, policy, { integrationOwnerSkill: project.integrationOwnerSkill });

    const canaries = await readCanaries(project.paths, {
      matrix: project.matrix,
      integrationOwnerSkill: project.integrationOwnerSkill,
    });
    const scanPolicy = buildScanPolicy(project.config.scan, {
      agentResources: project.config.docs.agentResources,
    });

    const report = await runArtifactScan({
      policy: scanPolicy,
      paths: project.paths,
      docsRoot: project.config.docs.root,
      canaries,
      model,
      agentSkillRoot,
    });

    io.stdout.write(
      `${[
        "artifact scan: no denied value reached a published artifact",
        "public scope           ok: no raw evidence/CAD file is publicly reachable outside its allowlist",
        "",
        ...report.lines,
      ].join("\n")}\n`,
    );
    return EXIT.PASS;
  } catch (error) {
    return reportFailure(error, io.stderr);
  }
}
