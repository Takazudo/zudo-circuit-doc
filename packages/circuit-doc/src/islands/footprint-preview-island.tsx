"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { useEffect, useRef, useState } from "preact/hooks";

import { PreviewEnlargeDialog } from "./preview-enlarge-dialog.tsx";

export type FootprintPreviewIslandProps = {
  readonly assetUrl: string;
  readonly footprintName: string;
};

export function FootprintPreviewIsland({ assetUrl, footprintName }: FootprintPreviewIslandProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const returnFocusRef = useRef<HTMLElement>(null);
  const [isImageReady, setImageReady] = useState(false);
  const [isHydrated, setHydrated] = useState(false);
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [dialogImageFailed, setDialogImageFailed] = useState(false);
  const alt = `Footprint preview for ${footprintName}`;

  useEffect(() => {
    setHydrated(true);
    const image = imageRef.current;
    if (image === null) return;
    const markReady = () => setImageReady(image.naturalWidth > 0);
    if (image.complete) markReady();
    else image.addEventListener("load", markReady, { once: true });
    return () => image.removeEventListener("load", markReady);
  }, [assetUrl]);

  return (
    <figure
      className="zcd-component-references__footprint"
      data-footprint-preview-state={isImageReady ? "ready" : "no-js"}
    >
      <div className="zcd-component-references__footprint-frame">
        <a href={assetUrl} aria-label={`Enlarge footprint preview for ${footprintName}; opens SVG without JavaScript`} onClick={(event) => {
          if (!isHydrated) return;
          event.preventDefault();
          returnFocusRef.current = event.currentTarget;
          setDialogImageFailed(false);
          setDialogOpen(true);
        }}>
          <img ref={imageRef} src={assetUrl} alt={alt} onLoad={() => setImageReady(true)} onError={() => setImageReady(false)} />
        </a>
        <button
          type="button"
          className="zcd-preview-enlarge-button"
          data-component-preview-enlarge="footprint"
          aria-label={`Enlarge footprint preview for ${footprintName}`}
          title={`Enlarge footprint preview for ${footprintName}`}
          onClick={(event) => {
            returnFocusRef.current = event.currentTarget;
            setDialogImageFailed(false);
            setDialogOpen(true);
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
            <path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" />
          </svg>
        </button>
      </div>
      <figcaption>
        Shared footprint package: <code>{footprintName}</code>. <a href={assetUrl}>Open SVG</a>
      </figcaption>
      <PreviewEnlargeDialog
        isOpen={isDialogOpen}
        onClose={() => setDialogOpen(false)}
        returnFocusRef={returnFocusRef}
        title={alt}
        variant="footprint"
      >
        {isDialogOpen && (dialogImageFailed
          ? <span className="zcd-preview-dialog__media-fallback" role="img" aria-label="Footprint preview could not be loaded" />
          : <img src={assetUrl} alt="" onError={() => setDialogImageFailed(true)} />)}
      </PreviewEnlargeDialog>
    </figure>
  );
}

FootprintPreviewIsland.displayName = "FootprintPreviewIsland";
