/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { Island } from "@takazudo/zfb";
import { FootprintPreviewIsland } from "../islands/footprint-preview-island.tsx";

export type FootprintPreviewProps = {
  readonly assetUrl: string;
  readonly footprintName: string;
};

/** SSR-safe footprint preview with a static direct-link fallback. */
export function FootprintPreview(props: FootprintPreviewProps) {
  return (
    <Island when="visible">
      <FootprintPreviewIsland {...props} />
    </Island>
  );
}
