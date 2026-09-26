// @takazudo/zudo-circuit-doc/islands — side-effect module that statically
// imports every package island root (zudo-sg `islands.ts` pattern).
//
// zfb's scanner enters this package only through a bare import from host
// source, and inside the package follows relative imports only, never bare
// self-imports — so these edges must stay relative. Hosts import it once from
// a `pages/` file (`import "@takazudo/zudo-circuit-doc/islands";`). On zfb
// >= 2.18 the virtual chrome-bindings module may already make the islands
// reachable; the explicit seed keeps discovery independent of that.
//
// Keep the list in sync with the `"use client"` roots the MDX components wrap
// in `<Island>`.

import "./islands/footprint-preview-island.tsx";
import "./islands/package-model-viewer-island.tsx";
