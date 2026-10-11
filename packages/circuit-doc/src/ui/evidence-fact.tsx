/** @jsxRuntime automatic */
/** @jsxImportSource @takazudo/zfb/zudo-react */

import type { Child, Description } from "@takazudo/zfb/zudo-react";

/** Groups one complete fact while leaving its Markdown claims visible in SSR. */
export type EvidenceFactProps = {
  children?: Child;
};

export function EvidenceFact({ children }: EvidenceFactProps): Description {
  return <div class="zcd-evidence-fact">{children}</div>;
}
