/**
 * The publication-safety scan on the BUILT site (port of upstream
 * `scan-artifacts.ts`, generalized: see the epic #1 planning note
 * `planning/explore/led-engine.md` EU8 (removed from the tree in #34; in git history), and the module doc on `core/scan.ts` for why a naive substring search
 * does not work).
 *
 * Every other check in this feature runs against structured data: the matrix
 * refuses a field, the branded types refuse an unsanitised string, preflight
 * counts what was emitted. This one runs against bytes, after the MDX
 * compiler, the HTML minifier, the search indexer and the `llms.txt` writer
 * have each had a turn — none of which this feature owns, and any of which
 * could reintroduce something the projection correctly withheld.
 *
 * A missing `dist/` is a hard failure (`ADAPTER_CONTRACT`), never a skip: a
 * safety check that quietly no-ops on missing input is the exact shape of a
 * gate that has silently stopped working.
 *
 * Three classes of assertion, and all three run every time:
 *
 *   NEGATIVE  no value reachable only through a denied provider key appears in
 *             any artifact (`assertNoLeaks`, both tiers);
 *   POSITIVE  the fields the contract promises a reader are still there —
 *             skipped only in **declared-empty mode** (zero published
 *             records), where there is nothing to promise;
 *   SHAPE     hydration payloads, the sitemap and page/search coverage stay
 *             what they are supposed to be — these never skip, because they
 *             hold whether or not any record is published.
 *
 * OWNED vs SITE mirrors upstream: OWNED is the full canary set against
 * artifacts this feature writes; SITE is the same dist tree (plus an optional
 * `--agent-skill` mirror) against the canaries no OTHER content source already
 * publishes (`subtractPublishedElsewhere` against the project's own authored
 * docs, outside the generated component tree).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { fail } from "../core/errors.ts";
import { byCodeUnit } from "../core/ids.ts";
import {
  assertNoLeaks,
  assertPositiveControls,
  assertRequiredRoutes,
  readScanTargets,
  scanTargets,
  subtractPublishedElsewhere,
  type Canary,
  type ScanResult,
  type ScanTarget,
} from "../core/scan.ts";
import { GENERATED_ROUTE_PREFIX } from "../core/site.ts";
import type { PublicRecord, PublicViewModel } from "../core/view-model.ts";
import type { CircuitProjectPaths } from "../provider/v1/paths.ts";
import type { ScanPolicy } from "./policy.ts";

export type Control = { readonly label: string; readonly value: string };

type Surface = { readonly name: string; readonly targets: readonly ScanTarget[] };

export type ArtifactScanInput = {
  readonly policy: ScanPolicy;
  readonly paths: Pick<CircuitProjectPaths, "distRoot" | "generatedRoot" | "preflightFile">;
  /** Resolved `config.docs.root`; the authored-content subtraction corpus lives under it. */
  readonly docsRoot: string;
  /** From `readCanaries(paths)` — the full denied-value canary set. */
  readonly canaries: readonly Canary[];
  /** Already validated and projected (`readEvidenceIndex` + `projectIndex`). */
  readonly model: PublicViewModel;
  /** `--agent-skill <dir>`, or `null` when not passed. */
  readonly agentSkillRoot: string | null;
};

export type ArtifactScanReport = {
  /** Human-readable lines, in report order; `SKIP:`-prefixed lines mark declared-empty skips. */
  readonly lines: readonly string[];
};

/**
 * Object keys that would mean the evidence graph itself had been serialised
 * into a browser hydration payload. Every one is a view-model leaf name
 * (`core/view-model.ts`) — none is part of a UI chrome's own vocabulary
 * (navigation tree, table of contents, theme toggle) — so a hit is
 * unambiguous regardless of which provider populated the model.
 */
export const EVIDENCE_MODEL_KEYS: readonly string[] = [
  "factId",
  "sourceId",
  "coverageId",
  "interactionId",
  "pinMapId",
  "recordId",
  "ruleId",
  "provenance",
  "verdict",
  "conditions",
  "blockingFactIds",
  "evidenceExtract",
  "sha256",
  "reviewedBy",
  "authoritativeUrl",
  "alternateAuthoritativeUrl",
  "physicalPdfPageIndex",
  "positivePrompts",
  "negativePrompts",
];

/**
 * Credential shapes that must never ship in a deploy artifact. The build has
 * no business reading a secret at all, so any hit is a real finding.
 */
export const CREDENTIAL_PATTERNS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: "PEM private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u },
  { label: "AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/u },
  { label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}/u },
  { label: "Cloudflare API token assignment", pattern: /CLOUDFLARE_API_TOKEN\s*[:=]\s*["'][^"']+/u },
  {
    label: "generic secret assignment",
    pattern: /\b(?:api[_-]?key|secret|password|passwd)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/iu,
  },
  { label: "Authorization: Bearer header", pattern: /Authorization["'\s:]+Bearer\s+[A-Za-z0-9._-]{20,}/u },
];

const REPORTED_LIMIT = 20;

/**
 * `readScanTargets` throws on an absent root; here that is not a usage
 * mistake but an ordinary zero-state (a fresh project's dist or generated-
 * content root before its first build/generate) — so it is treated as "no
 * files there yet" rather than propagated as a raw filesystem error. The
 * caller decides what "no files there" MEANS (a hard failure for `dist`, or
 * legitimately empty for a declared-empty generated-content tree).
 */
async function readScanTargetsOrMissing(root: string, labelPrefix: string): Promise<readonly ScanTarget[]> {
  try {
    return await readScanTargets(root, labelPrefix);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function runArtifactScan(input: ArtifactScanInput): Promise<ArtifactScanReport> {
  const { policy, paths, model, canaries } = input;
  const declaredEmpty = model.records.length === 0;
  const lines: string[] = [];

  const distTargets = await readScanTargetsOrMissing(paths.distRoot, "dist");
  if (distTargets.length === 0) {
    fail("ADAPTER_CONTRACT", "dist is empty; run the site build before scanning", {
      dist: paths.distRoot,
    });
  }
  const agentTargets =
    input.agentSkillRoot === null ? [] : await readScanTargets(input.agentSkillRoot, "agent-skill");

  if (input.agentSkillRoot !== null) {
    if (policy.requiredAgentRoutes.length === 0) {
      lines.push("SKIP: docs-to-agent required-route check (docs.agentResources is off)");
    } else {
      assertRequiredRoutes(
        agentTargets,
        policy.requiredAgentRoutes,
        `docs-to-agent corpus at ${input.agentSkillRoot}`,
      );
    }
  }

  // --- OWNED tier: full canary set, artifacts this feature writes ----------
  const owned = await ownedSurfaces(paths, policy, distTargets, agentTargets);
  assertOwnedSurfacesNonVacuous(owned, model);
  const ownedResult = scanTargets(owned.flatMap((surface) => surface.targets), canaries);
  const ownedFloors = deriveFloors(policy, "owned", model);
  // The leak check (`hits.length === 0`) always runs; only the non-vacuity
  // floors are what declared-empty legitimately has nothing to assert about.
  assertNoLeaks(ownedResult, ownedFloors);
  if (declaredEmpty && policy.minimumOwnedCanaries === null && policy.minimumOwnedFiles === null) {
    lines.push("SKIP: OWNED-tier non-vacuity floors (declared-empty: no published records)");
  }
  lines.push(
    `OWNED tier             ${ownedResult.canaries} canaries x ${ownedResult.filesScanned} artifacts, 0 hits`,
    ...owned.map((surface) => surfaceReport(surface, canaries)),
  );

  if (declaredEmpty) {
    lines.push("SKIP: positive controls (declared-empty: no published records)");
  } else {
    const controlRecord = pickPositiveControlRecord(model, policy.positiveControlRecord);
    if (controlRecord === null) {
      fail("ADAPTER_CONTRACT", "no published record satisfies scan.positiveControlRecord");
    }
    const controls = buildPositiveControls(controlRecord);
    const discovery = buildDiscoveryControls(controlRecord);
    for (const surface of owned) {
      if (surface.name === "preflight report") continue;
      if (surface.targets.length === 0) continue;
      assertPositiveControls(
        surface.targets,
        surface.name === "search + llms slices" ? discovery : controls,
        surface.name,
      );
    }
    lines.push(
      `positive controls      ${controls.length} per full-text surface, ${discovery.length} on discovery surfaces (record ${controlRecord.identity.slug})`,
    );
  }

  // --- SITE tier: canaries no other content source publishes ---------------
  const contentTargets = (await readScanTargetsOrMissing(join(input.docsRoot, "src/content/docs"), "content")).filter(
    (target) => !target.label.startsWith(`content${GENERATED_ROUTE_PREFIX}`),
  );
  const siteCanaries = subtractPublishedElsewhere(canaries, contentTargets);
  const withheld = canaries.length - siteCanaries.length;
  if (policy.expectedWithheld !== null && withheld !== policy.expectedWithheld) {
    fail("PUBLICATION_POLICY", "the number of canaries withheld from the SITE tier changed", {
      expected: policy.expectedWithheld,
      actual: withheld,
      why: "another content source started or stopped publishing a denied-only value; review the change, then update scan.expectedWithheld",
    });
  }
  const siteTargets = [...distTargets, ...agentTargets];
  const siteResult = scanTargets(siteTargets, siteCanaries);
  const siteFloors = deriveFloors(policy, "site", model);
  assertNoLeaks(siteResult, siteFloors);
  if (declaredEmpty && policy.minimumSiteCanaries === null && policy.minimumSiteFiles === null) {
    lines.push("SKIP: SITE-tier non-vacuity floors (declared-empty: no published records)");
  }
  lines.push(
    "",
    `SITE tier              ${siteResult.canaries} canaries x ${siteResult.filesScanned} artifacts, 0 hits`,
    `                       ${withheld} canary/canaries withheld (published by another content source)`,
    `                       ${siteResult.filesSkippedBinary} binary artifact(s) not text-scanned`,
  );

  const llmsFull = distTargets.filter((target) => target.label === `dist/${policy.artifacts.llmsFull}`);
  if (llmsFull.length === 0) {
    fail("PUBLICATION_POLICY", `dist/${policy.artifacts.llmsFull} is missing`);
  }
  if (declaredEmpty) {
    lines.push("SKIP: llms-full.txt positive controls (declared-empty: no published records)");
  } else {
    const controlRecord = pickPositiveControlRecord(model, policy.positiveControlRecord);
    if (controlRecord !== null) {
      assertPositiveControls(llmsFull, buildPositiveControls(controlRecord), policy.artifacts.llmsFull);
    }
  }

  const payloads = assertNoEvidenceGraphHydration(distTargets);
  assertCredentialFree(distTargets);
  assertSitemapUnchanged(distTargets, policy);
  const pages = assertPageCoverage(model, distTargets, policy);
  const searchable = assertSearchIndex(distTargets, model, policy);

  lines.push(
    "",
    `built pages            ${pages} under ${GENERATED_ROUTE_PREFIX}`,
    `searchable records     ${searchable} entries in ${policy.artifacts.searchIndex}`,
    `hydration payloads     ${payloads} checked, none carrying evidence-model keys`,
    input.agentSkillRoot === null
      ? "docs-to-agent          not scanned (pass --agent-skill <dir>)"
      : `docs-to-agent          ${agentTargets.length} file(s) scanned at ${input.agentSkillRoot}`,
  );

  return { lines };
}

// --- surfaces ----------------------------------------------------------

async function ownedSurfaces(
  paths: Pick<CircuitProjectPaths, "generatedRoot" | "preflightFile">,
  policy: ScanPolicy,
  distTargets: readonly ScanTarget[],
  agentTargets: readonly ScanTarget[],
): Promise<readonly Surface[]> {
  return [
    { name: "generated MDX", targets: await readScanTargetsOrMissing(paths.generatedRoot, "content") },
    { name: "preflight report", targets: [await preflightTarget(paths.preflightFile)] },
    {
      name: "built component pages",
      targets: distTargets.filter((target) => target.label.startsWith(`dist${GENERATED_ROUTE_PREFIX}`)),
    },
    { name: "search + llms slices", targets: componentSlices(distTargets, policy) },
    {
      name: "docs-to-agent components",
      targets: agentTargets.filter((target) => target.label.includes(GENERATED_ROUTE_PREFIX)),
    },
  ];
}

async function preflightTarget(preflightFile: string): Promise<ScanTarget> {
  try {
    return { label: "preflight.json", text: await readFile(preflightFile, "utf8") };
  } catch (error) {
    fail("ADAPTER_CONTRACT", "preflight report is missing; run generate before scanning", {
      path: preflightFile,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The parts of the two shared discovery artifacts that describe generated
 * routes. Both mix this feature's output with the rest of the site, so the
 * component rows are lifted out and held to the OWNED standard.
 */
function componentSlices(distTargets: readonly ScanTarget[], policy: ScanPolicy): readonly ScanTarget[] {
  const slices: ScanTarget[] = [];
  const componentsPrefix = GENERATED_ROUTE_PREFIX; // "/docs/components/"

  const searchIndex = distTargets.find((target) => target.label === `dist/${policy.artifacts.searchIndex}`);
  if (searchIndex?.text != null) {
    const entries = JSON.parse(searchIndex.text) as readonly { url: string }[];
    slices.push({
      label: `dist/${policy.artifacts.searchIndex} (component entries)`,
      text: JSON.stringify(entries.filter((entry) => entry.url.includes(componentsPrefix))),
    });
  }

  const llms = distTargets.find((target) => target.label === `dist/${policy.artifacts.llms}`);
  if (llms?.text != null) {
    slices.push({
      label: `dist/${policy.artifacts.llms} (component lines)`,
      text: llms.text
        .split("\n")
        .filter((line) => line.includes(componentsPrefix.slice(0, -1)))
        .join("\n"),
    });
  }

  return slices;
}

// --- positive/discovery controls, derived from the projection -------------

/**
 * Pick the published record that maximizes how many classes of positive
 * control it can supply — a fact with a unit and conditions, a fact with a
 * verdict, an OPEN coverage domain, a linked source, a pin-map row — so
 * `"auto"` exercises as much of the contract as this corpus allows. Ties break
 * on slug so the choice is deterministic. Every published record can always
 * supply the identity-only controls (`buildPositiveControls` degrades
 * gracefully), so this never fails as long as at least one record is
 * published.
 */
export function pickPositiveControlRecord(
  model: PublicViewModel,
  requested: string | "auto",
): PublicRecord | null {
  if (model.records.length === 0) return null;
  if (requested !== "auto") {
    const found = model.records.find((record) => record.identity.slug === requested);
    if (found === undefined) {
      fail("ADAPTER_CONTRACT", "scan.positiveControlRecord names a record that is not published", {
        slug: requested,
      });
    }
    return found;
  }
  const scored = model.records.map((record) => ({ record, score: controlScore(record) }));
  scored.sort(
    (left, right) =>
      right.score - left.score || byCodeUnit(left.record.identity.slug, right.record.identity.slug),
  );
  return scored[0]?.record ?? null;
}

function controlScore(record: PublicRecord): number {
  let score = 0;
  if (record.facts.some((fact) => fact.unit !== "" && fact.conditions !== "")) score += 1;
  if (record.facts.some((fact) => fact.verdict !== "")) score += 1;
  if (record.coverage.some((domain) => domain.status === "OPEN")) score += 1;
  if (record.sources.some((source) => source.url !== null)) score += 1;
  if (record.pinMaps[0]?.pins[0]?.function !== undefined) score += 1;
  return score;
}

function control(label: string, value: string): Control | null {
  return value === "" ? null : { label, value };
}

/**
 * Positive controls: one value per field class the acceptance criteria name.
 * Identity is always present on a published record; the rest degrade to
 * "absent" (never to an empty-string control, which would match every
 * artifact vacuously) when this particular record does not carry that class.
 */
export function buildPositiveControls(record: PublicRecord): readonly Control[] {
  const controls: (Control | null)[] = [
    control("identity: MPN", record.identity.mpn),
    control("identity: orderable ID", record.identity.lcsc),
    control("identity: manufacturer", record.identity.manufacturer),
    control("identity: package", record.identity.packageName),
    control("identity: function", record.identity.function),
    control("identity: owner skill", record.identity.ownerSkill),
  ];

  const factWithUnit = record.facts.find((fact) => fact.unit !== "" && fact.conditions !== "");
  if (factWithUnit !== undefined) {
    controls.push(
      control("fact: unit", factWithUnit.unit),
      control("fact: conditions", factWithUnit.conditions),
      control("fact: locator", factWithUnit.locator),
    );
  }
  const factWithVerdict = record.facts.find((fact) => fact.verdict !== "");
  if (factWithVerdict !== undefined) {
    controls.push(
      control("fact: provenance", factWithVerdict.provenance),
      control("fact: verdict", factWithVerdict.verdict),
    );
  }
  const openDomain = record.coverage.find((domain) => domain.status === "OPEN");
  if (openDomain !== undefined) {
    controls.push(control("coverage: status", openDomain.status), control("coverage: reason", openDomain.reason));
  }
  const linkedSource = record.sources.find((source) => source.url !== null);
  if (linkedSource !== undefined) {
    controls.push(
      control("source: document title", linkedSource.documentTitle),
      control("source: availability", linkedSource.availability),
      control("source: locator", linkedSource.locator),
      control("source: link", linkedSource.url as string),
    );
  }
  const containerRow = record.pinMaps[0]?.pins[0]?.function;
  if (containerRow !== undefined) controls.push(control("container content: pin function", containerRow));

  return controls.filter((entry): entry is Control => entry !== null);
}

/**
 * What discovery surfaces (search index, `llms.txt`) must carry: not a
 * fact's locator — both artifacts truncate or omit it — but what a reader
 * searches BY.
 */
export function buildDiscoveryControls(record: PublicRecord): readonly Control[] {
  return [
    control("discovery: MPN", record.identity.mpn),
    control("discovery: orderable ID", record.identity.lcsc),
    control("discovery: manufacturer", record.identity.manufacturer),
    control("discovery: function", record.identity.function),
  ].filter((entry): entry is Control => entry !== null);
}

// --- non-vacuity floors ------------------------------------------------

/**
 * Owned surfaces that MUST carry content once any record is published — the
 * independent, non-self-referential half of "every enabled surface must have
 * been scanned at least once" (item 1 of the spec). "search + llms slices" and
 * "docs-to-agent components" are conditionally enabled (the former mirrors
 * whatever `search-index.json`/`llms.txt` already contain, even when that is
 * an empty component slice; the latter only when `--agent-skill` is passed and
 * is covered instead by `assertRequiredRoutes`), so they are not asserted here.
 */
const SURFACES_REQUIRED_WHEN_PUBLISHED: ReadonlySet<string> = new Set([
  "generated MDX",
  "built component pages",
]);

/**
 * This is the real backstop against a vacuous scan (upstream measured this bug
 * live: an owned surface going empty — e.g. `generate` not having run before
 * `scan` — while the numeric floors below still passed because the OTHER
 * surfaces alone cleared them). A floor computed from the observed surfaces
 * cannot catch this, because the same surface going empty lowers both sides of
 * the comparison; only an unconditional per-surface assertion can.
 */
function assertOwnedSurfacesNonVacuous(owned: readonly Surface[], model: PublicViewModel): void {
  if (model.records.length === 0) return;
  const empty = owned
    .filter((surface) => SURFACES_REQUIRED_WHEN_PUBLISHED.has(surface.name) && surface.targets.length === 0)
    .map((surface) => surface.name);
  if (empty.length > 0) {
    fail(
      "PUBLICATION_POLICY",
      `${empty.length} owned surface(s) produced no content despite ${model.records.length} published record(s)`,
      { surfaces: empty },
    );
  }
}

/**
 * A config override (`scan.minimum*`) is used verbatim — that is how the LED
 * fixture (#23) restores the exact upstream floors (100/60/100/150).
 *
 * Absent an override, the floor is derived proportionally instead of being a
 * copy-pasted magic number: at least one canary once any record carries
 * denied evidence, and at least one file scanned. This is deliberately a weak
 * backstop, not a re-proof of the exact corpus size (`corpus`-level tests own
 * that) — `assertOwnedSurfacesNonVacuous` above is what actually proves a
 * surface did not go silently empty.
 */
function deriveFloors(
  policy: ScanPolicy,
  tier: "owned" | "site",
  model: PublicViewModel,
): { readonly canaries: number; readonly files: number } {
  const configuredCanaries = tier === "owned" ? policy.minimumOwnedCanaries : policy.minimumSiteCanaries;
  const configuredFiles = tier === "owned" ? policy.minimumOwnedFiles : policy.minimumSiteFiles;
  const publishedFloor = model.records.length > 0 ? 1 : 0;
  return {
    canaries: configuredCanaries ?? publishedFloor,
    files: configuredFiles ?? publishedFloor,
  };
}

function surfaceReport(surface: Surface, canaries: readonly Canary[]): string {
  const result = scanTargets(surface.targets, canaries);
  return `  ${surface.name.padEnd(24)} ${String(result.filesScanned).padStart(4)} scanned, ${String(
    result.filesSkippedBinary,
  ).padStart(2)} binary, ${result.hits.length} hit(s)`;
}

// --- shape assertions ----------------------------------------------------

function hydrationPayloads(targets: readonly ScanTarget[]): readonly { label: string; json: string }[] {
  const payloads: { label: string; json: string }[] = [];
  for (const target of targets) {
    if (target.text === null || !target.label.endsWith(".html")) continue;
    for (const match of target.text.matchAll(/data-props='([^']*)'/gu)) {
      payloads.push({ label: target.label, json: decodeAttribute(match[1] as string) });
    }
  }
  return payloads;
}

function decodeAttribute(value: string): string {
  return value
    .replace(/&#39;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}

function assertNoEvidenceGraphHydration(targets: readonly ScanTarget[]): number {
  const payloads = hydrationPayloads(targets);
  const offenders: string[] = [];
  for (const payload of payloads) {
    for (const key of EVIDENCE_MODEL_KEYS) {
      if (payload.json.includes(`"${key}"`)) offenders.push(`${payload.label} <- "${key}"`);
    }
  }
  if (offenders.length > 0) {
    fail("PUBLICATION_POLICY", `${offenders.length} hydration payload(s) carry evidence-model keys`, {
      offenders: [...new Set(offenders)].slice(0, REPORTED_LIMIT),
    });
  }
  return payloads.length;
}

function assertCredentialFree(targets: readonly ScanTarget[]): void {
  const offenders: string[] = [];
  for (const target of targets) {
    if (target.text === null) continue;
    for (const { label, pattern } of CREDENTIAL_PATTERNS) {
      if (pattern.test(target.text)) offenders.push(`${target.label} <- ${label}`);
    }
  }
  if (offenders.length > 0) {
    fail("PUBLICATION_POLICY", `${offenders.length} deploy artifact(s) look like they carry a credential`, {
      offenders: offenders.slice(0, REPORTED_LIMIT),
    });
  }
}

function assertSitemapUnchanged(targets: readonly ScanTarget[], policy: ScanPolicy): void {
  const populated = targets.filter(
    (target) =>
      policy.artifacts.sitemapPattern.test(target.label) &&
      typeof target.text === "string" &&
      /<url>/u.test(target.text),
  );
  if (populated.length > 0) {
    fail("PUBLICATION_POLICY", "sitemap has entries; enabling it is a separate publication decision", {
      offenders: populated.map((target) => target.label),
    });
  }
}

/**
 * One built HTML page per published record, plus the section pages — in
 * declared-empty mode the expected set IS the section pages, so this
 * naturally implements item 2 of the spec ("require the section pages and
 * zero record pages") without a separate code path.
 */
function assertPageCoverage(model: PublicViewModel, targets: readonly ScanTarget[], policy: ScanPolicy): number {
  const pages = new Set(
    targets
      .filter((target) => target.label.startsWith(`dist${GENERATED_ROUTE_PREFIX}`))
      .filter((target) => target.label.endsWith("/index.html"))
      .map((target) => target.label),
  );

  const expected = new Set<string>(policy.sectionPages);
  for (const record of model.records) {
    expected.add(`dist${GENERATED_ROUTE_PREFIX}records/${record.identity.slug}/index.html`);
  }

  const missing = [...expected].filter((page) => !pages.has(page)).sort(byCodeUnit);
  if (missing.length > 0) {
    fail("PUBLICATION_POLICY", `${missing.length} generated page(s) did not build`, {
      missing: missing.slice(0, REPORTED_LIMIT),
    });
  }
  const unexpected = [...pages].filter((page) => !expected.has(page)).sort(byCodeUnit);
  if (unexpected.length > 0) {
    fail("PUBLICATION_POLICY", "the built tree has pages the projection did not produce", {
      built: String(pages.size),
      projected: String(expected.size),
      unexpected: unexpected.slice(0, REPORTED_LIMIT),
    });
  }
  return pages.size;
}

function assertSearchIndex(targets: readonly ScanTarget[], model: PublicViewModel, policy: ScanPolicy): number {
  const target = targets.find((entry) => entry.label === `dist/${policy.artifacts.searchIndex}`);
  if (target?.text === undefined || target.text === null) {
    fail("PUBLICATION_POLICY", `dist/${policy.artifacts.searchIndex} is missing`);
  }
  const entries = JSON.parse(target.text) as readonly { url: string; description?: string }[];
  const componentEntries = entries.filter((entry) => entry.url.includes(GENERATED_ROUTE_PREFIX));
  const missing = model.records.filter(
    (record) => !componentEntries.some((entry) => entry.url.endsWith(`/records/${record.identity.slug}`)),
  );
  if (missing.length > 0) {
    fail("PUBLICATION_POLICY", `${missing.length} record(s) are not searchable`, {
      missing: missing.map((record) => record.identity.slug).slice(0, REPORTED_LIMIT),
    });
  }
  return componentEntries.length;
}
