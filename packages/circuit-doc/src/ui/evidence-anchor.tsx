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
 * zfb's source-level `linkValidation` only registers literal `id`s on
 * intrinsic elements, never the `id` a component renders, so it reported
 * "broken link: #<id>" for every in-page evidence link (#33, #68). The host
 * `doc/zfb.config.ts` therefore turns that source-level check off; the
 * built-HTML scan (`doc check:links --strict-anchors --strict-broken`) finds
 * these anchors and remains the gate. Do not "fix" it by inlining a literal
 * `id="..."` in the generated MDX instead: that changes the byte-identical
 * generated-page contract for no gain.
 */

import type { JSX } from "preact";

export type EvidenceAnchorProps = {
  id: string;
};

export function EvidenceAnchor({ id }: EvidenceAnchorProps): JSX.Element {
  return <span class="zcd-evidence-anchor" id={id} aria-hidden="true" />;
}
