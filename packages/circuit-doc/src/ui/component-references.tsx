/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { decodeComponentReferencesDescriptor, MODEL_UNAVAILABLE_TEXT } from "../core/reference-descriptor.ts";
import { FootprintPreview } from "./footprint-preview.tsx";
import { PackageModelViewer } from "./package-model-viewer.tsx";

export type ComponentReferencesProps = { readonly descriptor: string };

/**
 * The compact, server-rendered reference shortcut for a component detail page.
 * Its source data is an encoded, validated descriptor rather than prose parsed
 * from the MDX file, keeping document labels and asset paths faithful to the model.
 */
export function ComponentReferences({ descriptor: encoded }: ComponentReferencesProps) {
  const descriptor = decodeComponentReferencesDescriptor(encoded);
  const { document, footprint } = descriptor;
  return (
    <section className="zcd-component-references" aria-label="Selected document and package previews">
      <div className="zcd-component-references__document">
        <div>
          <p className="zcd-component-references__document-label">{document.label}</p>
          <p className="zcd-component-references__document-title"><a href={document.url}>{document.title}</a></p>
        </div>
        <dl className="zcd-component-references__metadata">
          <div><dt>Authority</dt><dd>{document.authority}</dd></div>
          <div><dt>Availability</dt><dd>{document.availability}</dd></div>
        </dl>
      </div>
      <div className="zcd-component-references__previews">
        <article className="zcd-component-references__preview">
          <h3 className="zcd-component-references__card-heading">Footprint preview</h3>
          <FootprintPreview assetUrl={footprint.assetUrl} footprintName={footprint.name} />
        </article>
        <article className="zcd-component-references__preview zcd-component-references__model-card">
          <h3 className="zcd-component-references__card-heading">Package model</h3>
          {descriptor.modelDescriptor === null
            ? <p data-model-unavailable="true">{MODEL_UNAVAILABLE_TEXT}</p>
            : <PackageModelViewer descriptor={descriptor.modelDescriptor} />}
        </article>
      </div>
    </section>
  );
}
