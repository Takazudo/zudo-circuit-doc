"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource @takazudo/zfb/zudo-react */

import { computed, getScope, Show, signal, type Ref } from "@takazudo/zfb/zudo-react";

import { PreviewEnlargeDialog } from "./preview-enlarge-dialog.tsx";

export type FootprintPreviewIslandProps = {
  readonly assetUrl: string;
  readonly footprintName: string;
};

export function FootprintPreviewIsland({ assetUrl, footprintName }: FootprintPreviewIslandProps) {
  const imageRef: Ref<HTMLImageElement> = { current: null };
  const returnFocusRef: Ref<HTMLElement> = { current: null };
  const isImageReady = signal(false);
  const isDialogOpen = signal(false);
  const dialogImageFailed = signal(false);
  const alt = `Footprint preview for ${footprintName}`;

  getScope().onActivate(() => {
    const image = imageRef.current;
    if (image === null) return;
    const markReady = () => { isImageReady.value = image.naturalWidth > 0; };
    if (image.complete) markReady();
    else image.addEventListener("load", markReady, { once: true });
    return () => image.removeEventListener("load", markReady);
  });

  return (
    <figure
      class="zcd-component-references__footprint"
      data-footprint-preview-state={computed(() => isImageReady.value ? "ready" : "no-js")}
    >
      <div class="zcd-component-references__footprint-frame">
        <a href={assetUrl} aria-label={`Enlarge footprint preview for ${footprintName}; opens SVG without JavaScript`} on:click={(event) => {
          event.preventDefault();
          returnFocusRef.current = event.currentTarget;
          dialogImageFailed.value = false;
          isDialogOpen.value = true;
        }}>
          <img ref={imageRef} src={assetUrl} alt={alt} on:load={() => { isImageReady.value = true; }} on:error={() => { isImageReady.value = false; }} />
        </a>
        <button
          type="button"
          class="zcd-preview-enlarge-button"
          data-component-preview-enlarge="footprint"
          aria-label={`Enlarge footprint preview for ${footprintName}`}
          title={`Enlarge footprint preview for ${footprintName}`}
          on:click={(event) => {
            returnFocusRef.current = event.currentTarget;
            dialogImageFailed.value = false;
            isDialogOpen.value = true;
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false">
            <path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" />
          </svg>
        </button>
      </div>
      <figcaption>
        Shared footprint package: <code>{footprintName}</code>. <a href={assetUrl}>Open SVG</a>
      </figcaption>
      <PreviewEnlargeDialog
        isOpen={isDialogOpen}
        onClose={() => { isDialogOpen.value = false; }}
        returnFocusRef={returnFocusRef}
        title={alt}
        variant="footprint"
      >
        <Show when={isDialogOpen}>{() => (
          <Show when={dialogImageFailed} fallback={() => <img src={assetUrl} alt="" on:error={() => { dialogImageFailed.value = true; }} />}>
            {() => <span class="zcd-preview-dialog__media-fallback" role="img" aria-label="Footprint preview could not be loaded" />}
          </Show>
        )}</Show>
      </PreviewEnlargeDialog>
    </figure>
  );
}
