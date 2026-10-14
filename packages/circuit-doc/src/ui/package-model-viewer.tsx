/** @jsxRuntime automatic */
/** @jsxImportSource @takazudo/zfb/zudo-react */

import { Island } from "@takazudo/zfb";
import { PackageModelViewerIsland } from "../islands/package-model-viewer-island.tsx";

export type PackageModelViewerProps = { readonly descriptor: string };

/** SSR-safe MDX binding. Its island child is seeded by `@takazudo/zudo-circuit-doc/islands`. */
export function PackageModelViewer(props: PackageModelViewerProps) {
  // The published scanner supports component-map entries whose fixed
  // Island boundary is nested in a Fragment (the MDX components recipe).
  return (
    <>
      <Island when="visible">
        <PackageModelViewerIsland {...props} />
      </Island>
    </>
  );
}
