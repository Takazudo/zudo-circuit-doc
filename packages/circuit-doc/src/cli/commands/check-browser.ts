/**
 * `zudo-circuit-doc check-browser`: browser smoke of the built site in system
 * Chrome — replaces the #18 stub wholesale (#27, ADR-017).
 *
 * A dependency-free CDP client over Node's global `WebSocket` drives headless
 * Chrome against a plain `node:http` static server for `--dist`. It proves
 * what a TypeScript compile cannot: islands actually hydrate, the footprint
 * and model dialogs work, viewers dispose and remount across client
 * navigation, static content survives with no JS, and forced model/WebGL
 * failures show honest states.
 */

import { resolve } from "node:path";

import { CATALOG_ROUTE } from "../../core/site.ts";
import { findChromeBinary } from "../../browser-smoke/chrome.ts";
import { readRepresentativesFile } from "../../browser-smoke/representatives.ts";
import { runBrowserSmoke } from "../../browser-smoke/run.ts";
import type { Representative } from "../../browser-smoke/types.ts";
import { EXIT, flag, flagValue, type CommandContext, type CommandMeta, type CommandModule } from "../command.ts";
import { reportFailure } from "../run.ts";

const meta: CommandMeta = {
  name: "check-browser",
  summary: "browser smoke of the built site in system Chrome (islands, viewers, no-JS fallback)",
  flags: [
    { name: "--dist", kind: "value", valueName: "<dir>", description: "built site directory (default: docs.dist)" },
    {
      name: "--representatives",
      kind: "value",
      valueName: "<json>",
      description: "representative pages (default: config browserSmoke.representatives)",
    },
    { name: "--chrome", kind: "value", valueName: "<bin>", description: "Chrome binary (default: $CHROME_BIN)" },
    { name: "--shell-assertions", description: "also assert the zudo-doc shell DOM" },
    { name: "--search-assertions", description: "also assert search and llms output" },
  ],
  exitCodes: [
    { code: EXIT.PASS, meaning: "every browser check passed" },
    { code: EXIT.FAILED, meaning: "a browser check failed" },
    { code: EXIT.USAGE, meaning: "usage/config error" },
    { code: EXIT.NOT_RUN, meaning: "not run: Chrome not found (set CHROME_BIN)" },
  ],
};

export const command: CommandModule = { meta, run };

async function run(context: CommandContext): Promise<number> {
  const { io, args } = context;
  let loaded;
  try {
    loaded = await context.loadProject();
  } catch (error) {
    return reportFailure(error, io.stderr);
  }

  const chromeBin = await findChromeBinary(flagValue(args, "--chrome"), io.env);
  if (chromeBin === null) {
    io.stderr.write("not run: Chrome not found (set CHROME_BIN)\n");
    return EXIT.NOT_RUN;
  }

  let representatives: readonly Representative[];
  const representativesFlag = flagValue(args, "--representatives");
  try {
    representatives =
      representativesFlag !== undefined
        ? await readRepresentativesFile(representativesFlag, io.cwd)
        : (loaded.config.browserSmoke?.representatives ?? []);
  } catch (error) {
    io.stderr.write(`${(error as Error).message}\n`);
    return EXIT.USAGE;
  }

  const distFlag = flagValue(args, "--dist");
  const distRoot = distFlag === undefined ? loaded.paths.distRoot : resolve(io.cwd, distFlag);

  try {
    const report = await runBrowserSmoke({
      distRoot,
      representatives,
      awayRoute: CATALOG_ROUTE,
      chromeBin,
      shellAssertions: flag(args, "--shell-assertions"),
      searchAssertions: flag(args, "--search-assertions"),
      generatedRoot: loaded.paths.generatedRoot,
    });
    for (const line of report.lines) io.stdout.write(`${line}\n`);
    return EXIT.PASS;
  } catch (error) {
    return reportFailure(error, io.stderr);
  }
}
