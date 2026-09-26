/**
 * `generate --watch`: development regeneration.
 *
 * Three properties matter and each is enforced here rather than assumed:
 *
 *   - SELF-OUTPUT EXCLUSION. The watch set is the evidence JSON under the
 *     bundles root plus the project's declared inputs (config, selection,
 *     assets, inventory, rules). The generated tree is never watched, and an
 *     event resolving inside it is dropped, so writing a page can never wake
 *     the watcher that wrote it.
 *   - DEBOUNCE. An editor save, or a `git checkout` touching many bundles,
 *     arrives as a burst of events; they collapse into one run.
 *   - SERIALIZATION. At most one generation runs at a time. Events arriving
 *     mid-run set a re-run flag instead of starting a second, overlapping
 *     writer.
 *
 * Every run reloads `circuit.config.ts` with a cache-busting import, so a
 * config edit takes effect without a restart; when it moves a watched path,
 * the watchers are re-armed on the new set.
 */

import { watch, type FSWatcher } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { ComponentDocsError } from "../core/errors.ts";
import { ConfigError } from "../config/errors.ts";
import { createProjectValidator } from "../config/map.ts";
import type { Writer } from "./command.ts";
import type { LoadedProject } from "./project.ts";
import { runOnce, summarize, writeReport } from "./run.ts";

export const DEBOUNCE_MS = 150;

export type Scheduler = {
  /** Note that something changed; runs after the debounce window settles. */
  readonly trigger: () => void;
  /** Resolves when no run is in flight and nothing is pending. */
  readonly idle: () => Promise<void>;
  readonly stop: () => void;
};

/**
 * Debounced, serialized scheduler. `task` never runs concurrently with itself;
 * triggers that arrive during a run cause exactly one follow-up run, not one
 * per trigger.
 */
export function createScheduler(
  task: () => Promise<void>,
  debounceMs = DEBOUNCE_MS,
  onError: (error: unknown) => void = (error) => process.stderr.write(`[circuit-doc] ${errorMessage(error)}\n`),
): Scheduler {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let pending = false;
  let stopped = false;
  let idleWaiters: (() => void)[] = [];

  const settle = (): void => {
    if (running || pending || timer !== null) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolveWaiter of waiters) resolveWaiter();
  };

  const run = async (): Promise<void> => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      await task();
    } catch (error) {
      // A watcher outlives its failures: an editor save can land mid-write and
      // leave JSON briefly unparsable. Report and wait for the next change.
      onError(error);
    } finally {
      running = false;
      if (pending && !stopped) {
        pending = false;
        void run();
      } else {
        pending = false;
        settle();
      }
    }
  };

  return {
    trigger(): void {
      if (stopped) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, debounceMs);
    },
    idle(): Promise<void> {
      return new Promise((resolveIdle) => {
        idleWaiters.push(resolveIdle);
        settle();
      });
    },
    stop(): void {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      settle();
    },
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof ConfigError || error instanceof ComponentDocsError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/** One `fs.watch` registration: a directory plus which changed names count. */
export type WatchTarget = {
  readonly dir: string;
  readonly recursive: boolean;
  /** `null` accepts any `.json` below `dir`; otherwise only these basenames directly in `dir`. */
  readonly names: ReadonlySet<string> | null;
};

/** The watch set for a project; never includes (or reaches into) the generated tree. */
export function watchTargets(project: LoadedProject): readonly WatchTarget[] {
  const generatedRoot = project.paths.generatedRoot;
  const targets: WatchTarget[] = [];
  if (!isInside(generatedRoot, project.paths.bundlesRoot)) {
    targets.push({ dir: project.paths.bundlesRoot, recursive: true, names: null });
  }

  const files = [
    project.configPath,
    project.config.publication.selection,
    project.config.publication.assets,
    project.paths.inventoryFile,
    project.paths.integrationRulesFile,
    project.config.docs.integrationGloss,
    project.config.publication.matrix,
  ].filter((path): path is string => path !== null);
  const byDir = new Map<string, Set<string>>();
  for (const file of files) {
    // Parent directories, not the files: editors save by rename, which
    // silently ends a watch on the file itself.
    const dir = dirname(file);
    if (isInside(generatedRoot, dir)) continue;
    const names = byDir.get(dir) ?? new Set<string>();
    names.add(basename(file));
    byDir.set(dir, names);
  }
  for (const [dir, names] of [...byDir].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    targets.push({ dir, recursive: false, names });
  }
  return targets;
}

function isInside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function targetsKey(targets: readonly WatchTarget[]): string {
  return JSON.stringify(targets.map((target) => [target.dir, target.recursive, [...(target.names ?? [])].sort()]));
}

export type GenerateWatchOptions = {
  /** (Re)loads the project; called with `fresh: true` on every run so config edits apply. */
  readonly load: (options: { readonly fresh: boolean }) => Promise<LoadedProject>;
  readonly env?: NodeJS.ProcessEnv;
  readonly stdout: Writer;
  readonly stderr: Writer;
  readonly debounceMs?: number;
};

export type GenerateWatch = {
  readonly scheduler: Scheduler;
  /** Currently armed targets. */
  readonly targets: () => readonly WatchTarget[];
  readonly close: () => void;
};

/** Initial generation (fails loudly), then watch and regenerate until `close()`. */
export async function startGenerateWatch(options: GenerateWatchOptions): Promise<GenerateWatch> {
  const { stdout, stderr } = options;
  let watchers: FSWatcher[] = [];
  let armed: readonly WatchTarget[] = [];
  let closed = false;
  let project = await options.load({ fresh: true });

  const initial = await runOnce(project, "generate", createProjectValidator(project, options.env));
  await writeReport(project, initial.report);
  stdout.write(`${summarize(initial.report)}\n`);

  const scheduler = createScheduler(
    async () => {
      project = await options.load({ fresh: true });
      const result = await runOnce(project, "generate", createProjectValidator(project, options.env));
      await writeReport(project, result.report);
      const written = result.emitted?.written.length ?? 0;
      const removed = result.emitted?.removed.length ?? 0;
      stdout.write(`[circuit-doc] regenerated: ${written} written, ${removed} removed\n`);
      arm(watchTargets(project));
    },
    options.debounceMs ?? DEBOUNCE_MS,
    (error) => stderr.write(`[circuit-doc] ${errorMessage(error)}\n`),
  );

  const closeWatchers = (): void => {
    for (const watcher of watchers) watcher.close();
    watchers = [];
  };

  function arm(targets: readonly WatchTarget[]): void {
    if (closed) return;
    if (targetsKey(targets) === targetsKey(armed)) return;
    closeWatchers();
    armed = targets;
    const generatedRoot = project.paths.generatedRoot;
    for (const target of targets) {
      const watcher = watch(target.dir, { recursive: target.recursive }, (_event, filename) => {
        if (filename === null) {
          scheduler.trigger();
          return;
        }
        const name = filename.toString();
        if (isInside(generatedRoot, join(target.dir, name))) return;
        if (target.names === null ? !name.endsWith(".json") : !target.names.has(name)) return;
        scheduler.trigger();
      });
      watcher.on("error", (error) => stderr.write(`[circuit-doc] watcher: ${errorMessage(error)}\n`));
      watchers.push(watcher);
    }
    stdout.write(`[circuit-doc] watching ${targets.map((target) => project.label(target.dir)).join(", ")}\n`);
  }

  arm(watchTargets(project));

  return {
    scheduler,
    targets: () => armed,
    close(): void {
      closed = true;
      scheduler.stop();
      closeWatchers();
    },
  };
}
