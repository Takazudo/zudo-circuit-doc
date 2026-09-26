/** Config loading for commands: `circuit.config.ts` -> validated, resolved, mapped project. */

import { loadCircuitConfig } from "../config/load.ts";
import { configRelative, mapCircuitConfig, type CircuitProjectMapping } from "../config/map.ts";
import { resolveCircuitConfig } from "../config/resolve.ts";

export type LoadedProject = CircuitProjectMapping & {
  /** Absolute path of the loaded config file. */
  readonly configPath: string;
  /** Config-relative, forward-slash label for a project path (never an absolute path in messages). */
  readonly label: (path: string) => string;
};

/**
 * The project's own script names. Hints name these rather than the package
 * bin, so a message tells the user what to type in *their* project.
 */
export const PROJECT_COMMANDS = {
  generate: "pnpm circuit:generate",
  check: "pnpm circuit:check",
  doctor: "pnpm circuit:doctor",
  build: "pnpm build",
  models: "pnpm exec zudo-circuit-doc models",
  previews: "pnpm previews:generate",
} as const;

export async function loadProject(options: {
  readonly cwd: string;
  readonly configPath?: string;
  readonly fresh?: boolean;
}): Promise<LoadedProject> {
  const loaded = await loadCircuitConfig({
    cwd: options.cwd,
    configPath: options.configPath,
    fresh: options.fresh,
  });
  const resolved = resolveCircuitConfig(loaded.config, loaded.configDir);
  const mapping = await mapCircuitConfig(resolved);
  return {
    ...mapping,
    configPath: loaded.configPath,
    label: (path: string) => configRelative(resolved, path),
  };
}
