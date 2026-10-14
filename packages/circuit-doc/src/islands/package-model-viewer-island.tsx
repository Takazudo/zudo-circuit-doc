"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource @takazudo/zfb/zudo-react */

import { getScope, Show, signal, type Ref, type HTMLAttributes } from "@takazudo/zfb/zudo-react";

import { decodeModelDescriptor } from "../core/model-descriptor.ts";
import { PreviewEnlargeDialog } from "./preview-enlarge-dialog.tsx";
import { activateModelViewer } from "./viewer-activation.ts";

export type PackageModelViewerIslandProps = { readonly descriptor: string };

type ViewerInstance = "inline" | "dialog";

export function PackageModelViewerIsland({ descriptor: encoded }: PackageModelViewerIslandProps) {
  const descriptor = decodeModelDescriptor(encoded);
  const returnFocusRef: Ref<HTMLElement> = { current: null };
  const isDialogOpen = signal(false);

  return (
    <>
      <ModelViewerSurface
        encoded={encoded}
        instance="inline"
        onEnlarge={(target) => {
          returnFocusRef.current = target;
          isDialogOpen.value = true;
        }}
      />
      <PreviewEnlargeDialog
        isOpen={isDialogOpen}
        onClose={() => { isDialogOpen.value = false; }}
        returnFocusRef={returnFocusRef}
        title={`Interactive 3D view of shared footprint package ${descriptor.packageLabel}`}
        variant="model"
      >
        <Show when={isDialogOpen}>{() => <ModelViewerSurface encoded={encoded} instance="dialog" />}</Show>
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
  const rootRef: Ref<HTMLElement> = { current: null };
  let pointerStart: { x: number; y: number } | null = null;
  getScope().onActivate(() => {
    const root = rootRef.current;
    if (root === null) return;
    return activateModelViewer(root, descriptor);
  });

  // Listener props must be absent on the dialog surface. zudo-react validates
  // native listener keys during a Show mount, including keys set to undefined.
  const viewportListeners: HTMLAttributes<HTMLDivElement> = instance === "inline" ? {
    "on:pointerdown": (event) => {
      pointerStart = { x: event.clientX, y: event.clientY };
    },
    "on:click": (event) => {
      const start = pointerStart;
      pointerStart = null;
      if (start !== null && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
      if (rootRef.current?.dataset.viewerState === "ready") onEnlarge?.(event.currentTarget);
    },
    "on:keydown": (event) => {
      if ((event.key === "Enter" || event.key === " ") && rootRef.current?.dataset.viewerState === "ready") {
        event.preventDefault();
        onEnlarge?.(event.currentTarget);
      }
    },
  } : {};

  return (
    <figure
      ref={rootRef}
      class="zcd-model-viewer"
      data-component-model-viewer-root=""
      data-model-url={descriptor.modelUrl}
      data-model-viewer-instance={instance}
      data-viewer-state="no-js"
      aria-label={`Interactive 3D view of shared footprint package ${descriptor.packageLabel}`}
    >
      {instance === "inline" && <figcaption class="zcd-model-viewer__caption">
        <strong>Shared footprint package:</strong> {descriptor.packageLabel}. <a href={descriptor.modelUrl}>Open model file</a>
      </figcaption>}
      <div class="zcd-model-viewer__viewport-frame">
        <div
          class="zcd-model-viewer__viewport"
          data-model-viewer-viewport=""
          tabindex={instance === "inline" ? 0 : -1}
          aria-label={`Interactive 3D view of shared footprint package ${descriptor.packageLabel}`}
          {...viewportListeners}
        />
        {onEnlarge !== undefined && (
          <button
            type="button"
            class="zcd-preview-enlarge-button"
            data-component-preview-enlarge="model"
            aria-label={`Enlarge 3D preview for ${descriptor.packageLabel}`}
            title={`Enlarge 3D preview for ${descriptor.packageLabel}`}
            on:click={(event) => onEnlarge(event.currentTarget)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false">
              <path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" />
            </svg>
          </button>
        )}
      </div>
      <p class="zcd-model-viewer__status" data-model-viewer-status="" role="status" aria-live="polite">
        Interactive inspection requires JavaScript and WebGL. The package identity remains available in this page.
      </p>
      {instance === "inline" && <p class="zcd-model-viewer__notice">
        This geometry represents a shared footprint package and may not exactly match the manufacturer part.
      </p>}
    </figure>
  );
}
