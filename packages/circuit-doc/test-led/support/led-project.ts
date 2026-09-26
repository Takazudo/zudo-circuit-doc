/**
 * Shared LED-corpus test harness (#26).
 *
 * Every `test-led/*.test.ts` file copies `fixtures/led/` into a fresh
 * `mkdtemp` scratch directory before loading it, so no test in this suite ever
 * touches — let alone mutates — the committed corpus under `fixtures/led/**`.
 * The scratch copy is then loaded through the real #9 config loader and #18
 * config-to-project mapping (`loadProject`), exactly as the built CLI does.
 *
 * `pnpm build` must have already run (the real Python validator is resolved
 * from the packaged `dist/`) and `pnpm fixtures:led:materialize` must have
 * materialized STEP — `assertLedStepMaterialized` fails fast, with the exact
 * remedy, rather than letting a test skip silently or fail with a confusing
 * ENOENT deep inside the reference contract.
 *
 * Not a `*.test.ts` file, so `node --test` does not pick it up as a suite.
 */

import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// A plain relative import of the repo's own build tooling: this file never
// imports anything used to VALIDATE fixtures/led, only to check it is ready.
// `sync-led-fixture.mjs` is plain JS with no type declarations of its own.
// @ts-expect-error TS7016: no declaration file for this untyped .mjs script.
import { checkFixture } from "../../../../scripts/sync-led-fixture.mjs";
import { loadProject, type LoadedProject } from "../../src/cli/project.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The repo root, four directories up from `test-led/support/`. */
export const REPO_ROOT = resolve(__dirname, "../../../..");

/** The committed, hash-locked LED regression corpus. Read-only from here. */
export const LED_FIXTURE_DIR = join(REPO_ROOT, "fixtures/led");

/**
 * Fails fast, before any test in a file runs, when STEP has not been
 * materialized — never a partial run, never a silent skip (acceptance
 * criterion of #26).
 */
export function assertLedStepMaterialized(): void {
  const result = checkFixture({ fixtureDir: LED_FIXTURE_DIR });
  if (!result.ok) {
    throw new Error(
      `fixtures/led lock check failed:\n${result.problems.map((problem: string) => `  ${problem}`).join("\n")}`,
    );
  }
  if (result.materializedCount < result.materializedTotal) {
    throw new Error(
      `STEP is not materialized (${result.materializedCount}/${result.materializedTotal} files); ` +
        "run `pnpm fixtures:led:materialize` (optionally --from-git $HOME/repos/circuits/zudo-led-lamp) first",
    );
  }
}

export type LedScratch = {
  /** The scratch copy's root — also where `circuit.config.ts` lives. */
  readonly dir: string;
  cleanup(): void;
};

/** Copies `fixtures/led/` into a fresh `mkdtemp` directory. */
export function copyLedFixture(): LedScratch {
  assertLedStepMaterialized();
  const dir = mkdtempSync(join(tmpdir(), "led-corpus-test-"));
  cpSync(LED_FIXTURE_DIR, dir, { recursive: true });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Loads the scratch copy through the real config loader (#9) and mapping (#18). */
export async function loadLedProject(scratchDir: string): Promise<LoadedProject> {
  return loadProject({ cwd: scratchDir });
}

/** Copies the fixture and loads it in one step; most tests only need this. */
export async function setUpLedProject(): Promise<LedScratch & { readonly project: LoadedProject }> {
  const scratch = copyLedFixture();
  const project = await loadLedProject(scratch.dir);
  return { ...scratch, project };
}
