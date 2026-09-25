// The host's chrome-bindings shim spreads this into
// `defineChromeBindings({ mdxExtras })`. Every name in core
// ALLOWED_COMPONENT_ATTRIBUTES must be registered here or ship globally from
// @takazudo/zudo-doc (CategoryNav does) — an unregistered name the generator
// emits renders as literal text and silently swallows the content it wraps.
import { ComponentReferences } from "./ui/component-references.tsx";
import { EvidenceAnchor } from "./ui/evidence-anchor.tsx";
import { EvidenceDetails } from "./ui/evidence-details.tsx";
import { EvidenceFact } from "./ui/evidence-fact.tsx";
import { EvidenceTable } from "./ui/evidence-table.tsx";
import { PackageModelViewer } from "./ui/package-model-viewer.tsx";

export const circuitDocMdxExtras = {
  EvidenceAnchor,
  EvidenceDetails,
  EvidenceFact,
  EvidenceTable,
  ComponentReferences,
  PackageModelViewer,
} as const;
