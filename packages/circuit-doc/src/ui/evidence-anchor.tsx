/** @jsxRuntime automatic */
/** @jsxImportSource preact */

/**
 * A stable in-page link target for a record, source, fact, coverage domain,
 * interaction or pin map.
 *
 * Why a component instead of a heading: heading anchors are derived from
 * heading TEXT, so rewording a heading silently breaks every external link to
 * it. Evidence IDs never change once published, so anchoring on the ID keeps
 * `…/records/al8860mp-13/#fact-al8860-vin-absolute-max` valid across
 * rewording. The generator emits these; `id` always comes from a provider ID
 * that matched `SLUG_PATTERN`.
 *
 * SSR-only by design — it is not an island and hydrates nothing, so the page
 * remains complete with JavaScript disabled.
 *
 * Known, non-suppressed false positive (#33): zfb's source-level link
 * checker statically scans MDX source text for literal `id="..."` strings,
 * so it cannot see the `id` this component renders at build time and warns
 * "broken link: #<id>" for every generated page that links to one of its own
 * anchors. The build-time HTML scan (`doc check:links --strict-anchors
 * --strict-broken`, run against the actual built output) finds the anchor
 * and passes — this is a zfb source-scan gap, not a real broken link. Do not
 * suppress the warning by renaming the component or inlining a literal
 * `id="..."`; both would defeat the point documented above.
 */

import type { JSX } from "preact";

export type EvidenceAnchorProps = {
  id: string;
};

export function EvidenceAnchor({ id }: EvidenceAnchorProps): JSX.Element {
  return <span class="zcd-evidence-anchor" id={id} aria-hidden="true" />;
}
