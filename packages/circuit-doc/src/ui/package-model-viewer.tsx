/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { Island } from "@takazudo/zfb";
import { PackageModelViewerIsland } from "../islands/package-model-viewer-island.tsx";

export type PackageModelViewerProps = { readonly descriptor: string };

/** SSR-safe MDX binding. Its island child is seeded by `@takazudo/zudo-circuit-doc/islands`. */
export function PackageModelViewer(props: PackageModelViewerProps) {
  return (
    <Island when="visible">
      <PackageModelViewerIsland {...props} />
    </Island>
  );
}
