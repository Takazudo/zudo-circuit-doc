/**
 * `ScanPolicy`: the project-specific numbers and route lists the publication
 * scanner (`artifacts.ts`), the public-scope check (`public-scope.ts`) and the
 * built-output reference checker (`built-references.ts`) run against.
 *
 * Everything LED hard-coded into `scan-artifacts.ts` (upstream, see
 * `_temp-resource/1-circuit-doc-seed/planning/explore/led-engine.md` EU8) lives
 * here instead, as either a config override (`ScanPolicyConfig`, `scan` in
 * `circuit.config.ts`) or a value derived from the resolved config and
 * `core/site.ts`. A project supplies nothing and gets a generic, proportional
 * policy (see `deriveFloors` in `artifacts.ts`); the LED fixture config (#23)
 * restores the exact upstream floors (100/60/100/150, `expectedWithheld: 6`,
 * `positiveControlRecord: "al8860mp-13"`) as overrides.
 */

import type { ScanPolicyConfig } from "../config/define.ts";
import {
  CATALOG_ROUTE,
  COMPONENTS_ROUTE,
  INTEGRATION_ROUTE,
  RECORDS_ROUTE,
} from "../core/site.ts";

/** Named dist artifacts the scanner and public-scope check reason about. */
export type ScanArtifactNames = {
  readonly searchIndex: string;
  readonly llms: string;
  readonly llmsFull: string;
  /** Matches `sitemap.xml`, `sitemap-index.xml`, a sharded `sitemap-0.xml`, … */
  readonly sitemapPattern: RegExp;
  /** zudo-doc's asset viewer route prefix (`assetViewerRoutePrefix`, default `files`). */
  readonly assetViewerRoutePrefix: string;
};

export const DEFAULT_SCAN_ARTIFACT_NAMES: ScanArtifactNames = {
  searchIndex: "search-index.json",
  llms: "llms.txt",
  llmsFull: "llms-full.txt",
  sitemapPattern: /(?:^|\/)sitemap[^/]*\.xml$/u,
  assetViewerRoutePrefix: "/files/",
};

export type ScanPolicy = {
  /** `null` means: derive a proportional floor at scan time (see `artifacts.ts`). */
  readonly minimumOwnedCanaries: number | null;
  readonly minimumOwnedFiles: number | null;
  readonly minimumSiteCanaries: number | null;
  readonly minimumSiteFiles: number | null;
  /** `null` means: report the withheld count, do not assert an exact value. */
  readonly expectedWithheld: number | null;
  /** A record slug, or `"auto"` to pick one deterministically (see `pickPositiveControlRecord`). */
  readonly positiveControlRecord: string | "auto";
  /** Route fragments the `--agent-skill` corpus must contain; empty when `docs.agentResources` is off. */
  readonly requiredAgentRoutes: readonly string[];
  /** Dist-relative labels of the section pages the projection always emits, even at zero records. */
  readonly sectionPages: readonly string[];
  readonly artifacts: ScanArtifactNames;
};

/**
 * Route fragments a docs-to-agent mirror must contain, derived from
 * `core/site.ts` rather than duplicated as literals (upstream `EU8`:
 * `REQUIRED_AGENT_ROUTES`, hard-coded at `scan-artifacts.ts:152-157`).
 */
function requiredAgentRoutes(): readonly string[] {
  return [`${COMPONENTS_ROUTE}index.`, CATALOG_ROUTE, INTEGRATION_ROUTE, RECORDS_ROUTE];
}

/**
 * The dist-relative HTML labels the projection's section pages always build
 * at, whether or not any record is selected (upstream `SECTION_PAGES`).
 * `readScanTargets(distRoot, "dist")` labels every file `dist/<relative path>`,
 * so these are exactly the labels `assertPageCoverage` looks for.
 */
function sectionPages(): readonly string[] {
  return [
    `dist${COMPONENTS_ROUTE}index.html`,
    `dist${CATALOG_ROUTE}index.html`,
    `dist${RECORDS_ROUTE}index.html`,
    `dist${INTEGRATION_ROUTE}index.html`,
  ];
}

export function buildScanPolicy(
  config: ScanPolicyConfig | null,
  options: { readonly agentResources: boolean },
): ScanPolicy {
  return {
    minimumOwnedCanaries: config?.minimumOwnedCanaries ?? null,
    minimumOwnedFiles: config?.minimumOwnedFiles ?? null,
    minimumSiteCanaries: config?.minimumSiteCanaries ?? null,
    minimumSiteFiles: config?.minimumSiteFiles ?? null,
    expectedWithheld: config?.expectedWithheld ?? null,
    positiveControlRecord: config?.positiveControlRecord ?? "auto",
    requiredAgentRoutes: options.agentResources ? requiredAgentRoutes() : [],
    sectionPages: sectionPages(),
    artifacts: DEFAULT_SCAN_ARTIFACT_NAMES,
  };
}
