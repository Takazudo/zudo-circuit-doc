// Stub (#18); replaced wholesale by #20 (footprint preview tooling). The
// replacement keeps both exports: `command`, and `checkFootprintsStep`, which
// `check` calls as its footprints step.
import { EXIT, type CliIo } from "../command.ts";
import type { LoadedProject } from "../project.ts";
import { notImplementedMessage, stubCommand } from "../stub.ts";

export const command = stubCommand({
  name: "footprints",
  summary: "generate (Docker + KiCad) or check the footprint preview SVGs",
  positionals: [{ name: "action", description: "generate or check", required: true, choices: ["generate", "check"] }],
  flags: [{ name: "--pull", description: "generate: pull the pinned KiCad image when it is absent" }],
  exitCodes: [
    { code: EXIT.PASS, meaning: "previews generated / up to date" },
    { code: EXIT.FAILED, meaning: "previews are out of date or unsafe" },
    { code: EXIT.USAGE, meaning: "usage/config error, or not implemented yet" },
    { code: EXIT.NOT_RUN, meaning: "not run: Docker is required for generate" },
  ],
  trackedIn: 20,
});

/**
 * `check`'s footprints step (offline, Docker-free). `check` itself answers the
 * zero state (CAD disabled and `expect.packages` 0) without calling this.
 */
export async function checkFootprintsStep(_project: LoadedProject, io: CliIo): Promise<number> {
  io.stderr.write(`${notImplementedMessage(command.meta)}\n`);
  return EXIT.USAGE;
}
