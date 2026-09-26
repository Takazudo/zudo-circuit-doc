/**
 * A fake `DockerRunner` (spec item 5: "injectable, so tests can use a fake").
 * It never spawns a process: it reads the export request's temp mount
 * straight off the `--mount type=bind,src=<dir>,dst=/work` argument and writes
 * one SVG per staged `.kicad_mod`, so `generateFootprintPreviews` runs
 * end-to-end without Docker or KiCad.
 *
 * Not a `*.test.ts` file, so `node --test` does not pick it up as a suite.
 */

import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DockerRunner } from "../../src/footprint-previews/docker.ts";
import { fixtureSvg } from "./fixture.ts";

export function fakeDockerRunner(version: string): DockerRunner {
  return async (args: readonly string[]) => {
    const mountArg = args.find((value) => value.startsWith("type=bind,src="));
    if (args.at(-1) === "--version") return { stdout: `${version}\n`, stderr: "" };
    if (args.includes("export")) {
      if (mountArg === undefined) throw new Error(`fake docker: no --mount in ${args.join(" ")}`);
      const mount = mountArg.slice("type=bind,src=".length).split(",")[0] as string;
      const libraryRoot = join(mount, "preview.pretty");
      const exportRoot = join(mount, "export");
      const names = (await readdir(libraryRoot)).filter((name) => name.endsWith(".kicad_mod"));
      for (const name of names) {
        const footprintName = name.slice(0, -".kicad_mod".length);
        await writeFile(join(exportRoot, `${footprintName}.svg`), fixtureSvg(footprintName), "utf8");
      }
      return { stdout: "", stderr: "" };
    }
    throw new Error(`fake docker: unexpected args ${args.join(" ")}`);
  };
}
