/**
 * The route and asset-URL conventions this generator publishes under.
 *
 * `/docs/components/` is fixed for v1 (epic #1, Config contract), and so is the
 * asset base under it — both are duplicated by hand today across render,
 * link-check and the descriptor guards, and a hand-duplicated constant is a
 * constant that can drift. This module is the one place that writes the
 * strings down; everything else imports them.
 *
 * `render/shared.ts:49-78,682`, `links.ts` and the descriptor regexes in
 * `model-descriptor.ts`/`reference-descriptor.ts` all consume this module —
 * see each file for how. The descriptor regex PATTERNS built from the asset
 * bases below are unchanged from before this module existed (v1 descriptor
 * contract): only where the base string is written down moved.
 */

import { fragmentRoute, route, type Route } from "./mdx.ts";
import type { Anchor, Slug } from "./ids.ts";

// --- routes ------------------------------------------------------------

export const COMPONENTS_ROUTE: Route = route("/docs/components/");
export const CATALOG_ROUTE: Route = route("/docs/components/catalog/");
export const RECORDS_ROUTE: Route = route("/docs/components/records/");
export const INTEGRATION_ROUTE: Route = route("/docs/components/integration/");

/**
 * The route prefix the generated tree owns. `links.ts` uses this to decide
 * whether a link target is one of this run's own pages (and therefore must be
 * proven to resolve) or a destination outside the generated tree.
 */
export const GENERATED_ROUTE_PREFIX = "/docs/components/";

/** `/docs/components/records/<slug>/`, optionally at one anchor inside it. */
export function recordRoute(slug: Slug, fragment?: Anchor): Route {
  return route(`/docs/components/records/${slug}/`, fragment);
}

/** One rule's, or one conditioned calculation's, place on the integration page. */
export function integrationRoute(fragment: Anchor): Route {
  return route("/docs/components/integration/", fragment);
}

/** The record's entry on the catalog page. */
export function catalogEntryRoute(fragment: Anchor): Route {
  return route("/docs/components/catalog/", fragment);
}

/** A destination inside the page currently being rendered. */
export function samePage(fragment: Anchor): Route {
  return fragmentRoute(fragment);
}

/**
 * The hub above `/docs/claude-skills/` and `/docs/claude-md/`.
 *
 * Reached through the sixth header item's dropdown rather than a header entry
 * of its own; the landing page also links to it so the raw agent-resource tree
 * stays reachable by navigation, not only by search or a remembered URL.
 */
export const AGENT_RESOURCES_HUB_ROUTE: Route = route("/docs/claude/");

/**
 * The raw agent resource a record's evidence actually lives in.
 *
 * The doc site publishes every `.claude/skills/<name>/SKILL.md` at this route
 * (`claudeResources` in `zfb.config.ts`), so this links the projection back to
 * the thing it is a projection OF. It is deliberately a link and not a copy:
 * the bundle is the source of truth and the generated pages must not restate
 * it. Suppressed site-wide by `RenderOptions.agentResources` (see
 * `render/shared.ts`) for a project that has not wired `claudeResources` up.
 */
export function agentResourceRoute(ownerSkill: string): Route {
  return route(`/docs/claude-skills/${ownerSkill}/`);
}

// --- asset bases ---------------------------------------------------------

/**
 * Where a footprint preview SVG is published, root-absolute.
 *
 * Root-absolute because `zudo-doc`'s `base` is required to stay `/` (epic #1);
 * a project that changed it would break every reference here regardless of how
 * this constant is spelled, so this module does not attempt to make the value
 * configurable — only to stop it being copied by hand.
 */
export const FOOTPRINT_ASSET_BASE = "/assets/component-previews/footprints/";

/** Where a component's WRL preview model is published, root-absolute. */
export const MODEL_ASSET_BASE = "/assets/component-previews/models/";
