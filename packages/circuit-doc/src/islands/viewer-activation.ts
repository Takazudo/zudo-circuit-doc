import type { ModelViewerDescriptor } from "../core/model-descriptor.ts";
import { setViewerState } from "./viewer-state.ts";

type ViewerRuntime = Pick<typeof import("./viewer-runtime.ts"), "mountModelViewer">;

/** Own every pending stage, including a runtime import that cannot itself abort. */
export function activateModelViewer(
  root: HTMLElement,
  descriptor: ModelViewerDescriptor,
  loadRuntime: () => Promise<ViewerRuntime> = () => import("./viewer-runtime.ts"),
): () => void {
  let disposed = false;
  let cleanup: (() => void) | undefined;
  const abort = new AbortController();
  setViewerState(root, "loading", "Loading interactive package model…");

  void loadRuntime()
    .then(({ mountModelViewer }) => {
      if (disposed) throw new DOMException("Viewer disposed", "AbortError");
      return mountModelViewer(root, descriptor, abort.signal);
    })
    .then((mounted) => {
      if (disposed) mounted.dispose();
      else cleanup = () => mounted.dispose();
    })
    .catch(() => {
      if (!disposed) {
        setViewerState(root, "error", "The interactive package model could not be displayed. The package reference on this page is still available.");
      }
    });

  return () => {
    if (disposed) return;
    disposed = true;
    abort.abort();
    cleanup?.();
  };
}
