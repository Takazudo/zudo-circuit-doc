"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { useEffect, useRef, useState } from "preact/hooks";

import { decodeModelDescriptor } from "../core/model-descriptor.ts";
import { PreviewEnlargeDialog } from "./preview-enlarge-dialog.tsx";
import { setViewerState } from "./viewer-state.ts";

export type PackageModelViewerIslandProps = { readonly descriptor: string };

type ViewerInstance = "inline" | "dialog";

export function PackageModelViewerIsland({ descriptor: encoded }: PackageModelViewerIslandProps) {
  const descriptor = decodeModelDescriptor(encoded);
  const returnFocusRef = useRef<HTMLElement>(null);
  const [isDialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <ModelViewerSurface
        encoded={encoded}
        instance="inline"
        onEnlarge={(target) => {
          returnFocusRef.current = target;
          setDialogOpen(true);
        }}
      />
      <PreviewEnlargeDialog
        isOpen={isDialogOpen}
        onClose={() => setDialogOpen(false)}
        returnFocusRef={returnFocusRef}
        title={`Interactive 3D view of shared footprint package ${descriptor.packageLabel}`}
        variant="model"
      >
        {isDialogOpen && <ModelViewerSurface encoded={encoded} instance="dialog" />}
      </PreviewEnlargeDialog>
    </>
  );
}

function ModelViewerSurface({
  encoded,
  instance,
  onEnlarge,
}: {
  readonly encoded: string;
  readonly instance: ViewerInstance;
  readonly onEnlarge?: (target: HTMLElement) => void;
}) {
  const descriptor = decodeModelDescriptor(encoded);
  const rootRef = useRef<HTMLElement>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;
    const abort = new AbortController();
    setViewerState(root, "loading", "Loading interactive package model…");

    void import("./viewer-runtime.ts")
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
          setViewerState(
            root,
            "error",
            "The interactive package model could not be displayed. The package reference on this page is still available.",
          );
        }
      });

    return () => {
      disposed = true;
      abort.abort();
      cleanup?.();
    };
  }, [encoded]);

  return (
    <figure
      ref={rootRef}
      className="zcd-model-viewer"
      data-component-model-viewer-root=""
      data-model-url={descriptor.modelUrl}
      data-model-viewer-instance={instance}
      data-viewer-state="no-js"
      aria-label={`Interactive 3D view of shared footprint package ${descriptor.packageLabel}`}
    >
      {instance === "inline" && <figcaption className="zcd-model-viewer__caption">
        <strong>Shared footprint package:</strong> {descriptor.packageLabel}. <a href={descriptor.modelUrl}>Open model file</a>
      </figcaption>}
      <div className="zcd-model-viewer__viewport-frame">
        <div
          className="zcd-model-viewer__viewport"
          data-model-viewer-viewport=""
          tabIndex={instance === "inline" ? 0 : -1}
          aria-label={`Interactive 3D view of shared footprint package ${descriptor.packageLabel}`}
          onPointerDown={instance === "inline" ? (event) => {
            pointerStart.current = { x: event.clientX, y: event.clientY };
          } : undefined}
          onClick={instance === "inline" ? (event) => {
            const start = pointerStart.current;
            pointerStart.current = null;
            if (start !== null && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
            if (rootRef.current?.dataset.viewerState === "ready") onEnlarge?.(event.currentTarget);
          } : undefined}
          onKeyDown={instance === "inline" ? (event) => {
            if ((event.key === "Enter" || event.key === " ") && rootRef.current?.dataset.viewerState === "ready") {
              event.preventDefault();
              onEnlarge?.(event.currentTarget);
            }
          } : undefined}
        />
        {onEnlarge !== undefined && (
          <button
            type="button"
            className="zcd-preview-enlarge-button"
            data-component-preview-enlarge="model"
            aria-label={`Enlarge 3D preview for ${descriptor.packageLabel}`}
            title={`Enlarge 3D preview for ${descriptor.packageLabel}`}
            onClick={(event) => onEnlarge(event.currentTarget)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
              <path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" />
            </svg>
          </button>
        )}
      </div>
      <p className="zcd-model-viewer__status" data-model-viewer-status="" role="status" aria-live="polite">
        Interactive inspection requires JavaScript and WebGL. The package identity remains available in this page.
      </p>
      {instance === "inline" && <p className="zcd-model-viewer__notice">
        This geometry represents a shared footprint package and may not exactly match the manufacturer part.
      </p>}
    </figure>
  );
}

PackageModelViewerIsland.displayName = "PackageModelViewerIsland";
