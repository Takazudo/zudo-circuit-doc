/**
 * Representative pages come from `--representatives <json>` or the project's
 * own `circuit.config.ts` `browserSmoke.representatives` — never from a
 * hard-coded LED list (spec item 2). "RECORD" (the page exercised by the
 * dialog/interaction/SPA/forced-failure checks) is the first representative
 * whose built page publishes a component-references section with a model.
 * "AWAY" is always the catalog route.
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { Representative } from "./types.ts";

/** The rendered marker that proves a built record page has a footprint+model reference section (see `ui/component-references.tsx`). */
const REFERENCES_MARKER = "zcd-component-references";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function problem(message: string): never {
  throw new Error(`--representatives: ${message}`);
}

/** Validates the `{representatives: [...]}` shape shared with `config/schema.ts`'s `BROWSER_SMOKE_SHAPE`. */
export function parseRepresentatives(value: unknown): readonly Representative[] {
  if (!isPlainObject(value) || !Array.isArray(value.representatives)) {
    problem('must be a JSON object shaped {"representatives": [...]}');
  }
  return value.representatives.map((entry, index) => {
    if (!isPlainObject(entry)) problem(`representatives[${index}] must be an object`);
    const { kind, path, slug, identity, availability } = entry;
    for (const [field, fieldValue] of [
      ["kind", kind],
      ["path", path],
      ["slug", slug],
      ["identity", identity],
    ] as const) {
      if (typeof fieldValue !== "string" || fieldValue === "") {
        problem(`representatives[${index}].${field} must be a non-empty string`);
      }
    }
    if (availability !== undefined && typeof availability !== "string") {
      problem(`representatives[${index}].availability must be a string`);
    }
    return {
      kind: kind as string,
      path: path as string,
      slug: slug as string,
      identity: identity as string,
      ...(availability === undefined ? {} : { availability: availability as string }),
    };
  });
}

/** Reads and validates a `--representatives <json>` file. */
export async function readRepresentativesFile(path: string, cwd: string): Promise<readonly Representative[]> {
  const absolute = resolve(cwd, path);
  let raw: string;
  try {
    raw = await readFile(absolute, "utf8");
  } catch (error) {
    throw new Error(`--representatives: cannot read ${path}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`--representatives: ${path} is not valid JSON: ${(error as Error).message}`);
  }
  return parseRepresentatives(parsed);
}

/** The built page for `representative.path` contains a published component-references section. */
export async function hasPublishedReferences(distRoot: string, representative: Representative): Promise<boolean> {
  const relative = representative.path.replace(/^\/+/u, "").replace(/\/+$/u, "");
  const file = join(distRoot, relative, "index.html");
  try {
    const html = await readFile(file, "utf8");
    return html.includes(REFERENCES_MARKER);
  } catch {
    return false;
  }
}

export type ResolvedRepresentatives = {
  readonly all: readonly Representative[];
  /** The subset of `all` whose built page publishes a component-references section, in declared order. */
  readonly withReferences: readonly Representative[];
  /** RECORD: the first of `withReferences` with a model, or `undefined` when none do. */
  readonly record: Representative | undefined;
};

/**
 * Every representative is checked, not only the first: the per-viewport/theme
 * pass (`run.ts`) inspects every representative that has references, and only
 * the single deep-interaction pass (dialogs, SPA, forced failures, reload,
 * long tables, source-detail expansion) needs one page — RECORD.
 */
export async function resolveRepresentatives(
  distRoot: string,
  representatives: readonly Representative[],
): Promise<ResolvedRepresentatives> {
  const withReferences: Representative[] = [];
  for (const representative of representatives) {
    if (await hasPublishedReferences(distRoot, representative)) withReferences.push(representative);
  }
  let record: Representative | undefined;
  for (const representative of withReferences) {
    const relative = representative.path.replace(/^\/+/u, "").replace(/\/+$/u, "");
    const html = await readFile(join(distRoot, relative, "index.html"), "utf8");
    if (!html.includes('data-model-unavailable="true"')) {
      record = representative;
      break;
    }
  }
  return { all: representatives, withReferences, record };
}
