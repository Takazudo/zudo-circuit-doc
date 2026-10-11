/** @jsxRuntime automatic */
/** @jsxImportSource @takazudo/zfb/zudo-react */

import { Island } from "@takazudo/zfb";
import { FootprintPreviewIsland } from "../islands/footprint-preview-island.tsx";

export type FootprintPreviewProps = {
  readonly assetUrl: string;
  readonly footprintName: string;
};

/** SSR-safe footprint preview with a static direct-link fallback. */
export function FootprintPreview(props: FootprintPreviewProps) {
  // The published scanner supports component-map entries whose fixed
  // Island boundary is nested in a Fragment (the MDX components recipe).
  return (
    <>
      <Island when="visible">
        <FootprintPreviewIsland {...props} />
      </Island>
    </>
  );
}
