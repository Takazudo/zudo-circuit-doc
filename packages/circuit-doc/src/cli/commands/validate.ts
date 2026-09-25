/**
 * `zudo-circuit-doc validate [--online | --refresh-source ID…] [--json]`: the
 * canonical Python validator on its own. Offline unless `--online` or
 * `--refresh-source` is given explicitly (ADR-019) — agent operations, never
 * part of a build.
 */

import { UsageError } from "../args.ts";
import { EXIT, flag, flagValues, type CommandContext, type CommandModule, type Writer } from "../command.ts";
import { reportFailure } from "../run.ts";
import { runValidateCommand } from "../../validate/runner.ts";

export const command: CommandModule = {
  meta: {
    name: "validate",
    summary: "run the canonical evidence validator (offline unless asked)",
    flags: [
      { name: "--online", description: "re-download and hash-check every source (VOLATILE-HTML sources are skipped)" },
      {
        name: "--refresh-source",
        kind: "values",
        valueName: "<id>",
        description: "re-download and hash-check only these source IDs",
      },
      { name: "--json", description: "print one JSON result object" },
    ],
    exitCodes: [
      { code: EXIT.PASS, meaning: "the evidence satisfies the contract" },
      { code: EXIT.FAILED, meaning: "validation failed (or Python is missing/too old)" },
      { code: EXIT.USAGE, meaning: "usage or config error" },
    ],
  },
  run,
};

async function run(context: CommandContext): Promise<number> {
  const { io, args } = context;
  const online = flag(args, "--online");
  const refreshSources = flagValues(args, "--refresh-source");
  try {
    if (online && refreshSources.length > 0) {
      throw new UsageError("--online and --refresh-source are mutually exclusive");
    }
    const project = await context.loadProject();
    return await runValidateCommand(project.validatorInput, {
      online,
      refreshSources,
      json: flag(args, "--json"),
      pythonMinVersion: project.pythonMinVersion,
      env: io.env,
      stdout: streamOf(io.stdout),
      stderr: streamOf(io.stderr),
    });
  } catch (error) {
    return reportFailure(error, io.stderr);
  }
}

function streamOf(writer: Writer): Pick<NodeJS.WritableStream, "write"> {
  return {
    write: (chunk: string | Uint8Array) => {
      writer.write(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    },
  } as Pick<NodeJS.WritableStream, "write">;
}
