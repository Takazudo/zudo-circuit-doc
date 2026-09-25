/**
 * The `zudo-circuit-doc` dispatcher. No top-level side effects: `bin/` calls
 * `main()` and sets the exit code; tests call it in-process with their own io.
 */

import { parseCommandArgs, parseGlobalArgs, UsageError } from "./args.ts";
import { EXIT, type CliIo, type CommandModule } from "./command.ts";
import { COMMANDS } from "./commands/index.ts";
import { BIN_NAME, renderCommandHelp, renderRootHelp } from "./help.ts";
import { packageInfo } from "./package-info.ts";
import { loadProject } from "./project.ts";

export function defaultIo(): CliIo {
  return { cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr };
}

export async function main(
  argv: readonly string[],
  io: CliIo = defaultIo(),
  commands: readonly CommandModule[] = COMMANDS,
): Promise<number> {
  let parsedGlobal;
  try {
    parsedGlobal = parseGlobalArgs(argv);
  } catch (error) {
    io.stderr.write(`${BIN_NAME}: ${(error as Error).message}\n`);
    return EXIT.USAGE;
  }
  const { configPath, help, version, rest } = parsedGlobal;
  const metas = commands.map((entry) => entry.meta);

  if (version) {
    io.stdout.write(`${packageInfo().version}\n`);
    return EXIT.PASS;
  }
  const [name, ...commandArgv] = rest;
  if (name === undefined) {
    io[help ? "stdout" : "stderr"].write(renderRootHelp(metas, packageInfo().version));
    return help ? EXIT.PASS : EXIT.USAGE;
  }
  const selected = commands.find((entry) => entry.meta.name === name);
  if (selected === undefined) {
    io.stderr.write(`${BIN_NAME}: unknown command ${JSON.stringify(name)}\n\n${renderRootHelp(metas, packageInfo().version)}`);
    return EXIT.USAGE;
  }
  if (help) {
    io.stdout.write(renderCommandHelp(selected.meta));
    return EXIT.PASS;
  }

  let args;
  try {
    args = parseCommandArgs(selected.meta, commandArgv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.stderr.write(`${BIN_NAME} ${name}: ${error.message}\n\n${renderCommandHelp(selected.meta)}`);
    return EXIT.USAGE;
  }

  return selected.run({
    io,
    args,
    configPath,
    loadProject: (options = {}) => loadProject({ cwd: io.cwd, configPath, fresh: options.fresh }),
  });
}
