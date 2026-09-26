/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { ComponentChildren, JSX } from "preact";

/** Groups one complete fact while leaving its Markdown claims visible in SSR. */
export type EvidenceFactProps = {
  children?: ComponentChildren;
};

export function EvidenceFact({ children }: EvidenceFactProps): JSX.Element {
  return <div class="zcd-evidence-fact">{children}</div>;
}
