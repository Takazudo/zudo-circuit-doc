/** Shared body of the placeholder command modules that later sub-issues replace. */

import { EXIT, type CommandContext, type CommandMeta, type CommandModule } from "./command.ts";

export function notImplementedMessage(meta: Pick<CommandMeta, "name" | "trackedIn">): string {
  return `${meta.name}: not implemented yet (tracked in #${meta.trackedIn})`;
}

/** A command that parses its declared arguments, then prints the not-implemented line and exits 2. */
export function stubCommand(meta: CommandMeta): CommandModule {
  return {
    meta,
    run: async (context: CommandContext) => {
      context.io.stderr.write(`${notImplementedMessage(meta)}\n`);
      return EXIT.USAGE;
    },
  };
}
