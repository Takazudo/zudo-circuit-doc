/**
 * The committed per-field publication decisions for this circuit.
 *
 * This file IS the publication review artifact. Every leaf of the view model
 * appears exactly once with an explicit decision and, where the decision is
 * not obvious, the reason. Adding a leaf without a decision here is a compile
 * error (`PublicationMatrix` is `Record<FieldKey, FieldDecision>`), so the
 * default for anything new is "the build stops until a human decides".
 *
 * Changing a `DENY` to a `PUBLISH` is a publication decision, not a
 * refactoring. Denied fields are the ones that leak audit machinery,
 * distribution-controlled content, or internal review state.
 */

import type { PublicationMatrix } from "../../core/publication.ts";

export const CIRCUIT_PUBLICATION_MATRIX: PublicationMatrix = {
  // Identity is the whole point of the catalog: exact orderable, exact
  // package, exact placement. These are already published in the BOM page.
  "record.recordId": "PUBLISH",
  "record.slug": "PUBLISH",
  "record.kind": "PUBLISH",
  "record.parentRecordId": "PUBLISH",
  "record.lineId": "PUBLISH",
  // The owner bundle's name. Already public: `/docs/claude-skills/<name>/` is
  // generated for every bundle and is on the live site, so this publishes a
  // route that exists rather than a new fact about the project.
  "record.ownerSkill": "PUBLISH",
  "record.mpn": "PUBLISH",
  "record.manufacturer": "PUBLISH",
  "record.lcsc": "PUBLISH",
  "record.package": "PUBLISH",
  "record.function": "PUBLISH",
  "record.identityState": "PUBLISH",
  "record.sourceState": "PUBLISH",
  "record.dnp": "PUBLISH",
  "record.placements": "PUBLISH",

  // Aliases exist to make exact terms findable; that is a reader feature.
  "alias.mpn": "PUBLISH",
  "alias.lcsc": "PUBLISH",
  "alias.manufacturer": "PUBLISH",
  "alias.function": "PUBLISH",
  // Routing prompts are agent-steering text, not reader-facing knowledge. They
  // read as instructions and would be a prompt-injection surface once mirrored
  // into llms.txt and the search index.
  "routing.positivePrompts": "DENY",
  "routing.negativePrompts": "DENY",

  // Provenance a reader can act on: which document, which revision, which
  // page, which table — and whether it is reachable at all.
  "source.sourceId": "PUBLISH",
  "source.documentTitle": "PUBLISH",
  "source.documentNumber": "PUBLISH",
  "source.revision": "PUBLISH",
  "source.documentDate": "PUBLISH",
  "source.retrievalDate": "PUBLISH",
  "source.authorityClass": "PUBLISH",
  "source.availability": "PUBLISH",
  "source.locator": "PUBLISH",
  "source.printedPageLabel": "PUBLISH",
  // A physical PDF page index only means something with the PDF in hand, and
  // V1 publishes no PDFs. The printed page label is the reader-usable one.
  "source.physicalPdfPageIndex": "DENY",
  // Published per source through the narrower `linkableSourceIds` opt-in.
  "source.authoritativeUrl": "PUBLISH",
  // Alternate URLs are mirrors and retrieval fallbacks kept for audit; they
  // are not the citation and several are internal-ish archive endpoints.
  "source.alternateAuthoritativeUrl": "DENY",
  // Retained-copy integrity machinery. Publishing a hash invites redistributing
  // the hashed artifact, which is exactly what V1 does not do.
  "source.sha256": "DENY",
  // Verbatim quotations from vendor datasheets. Retained for audit, not
  // licensed for republication.
  "source.evidenceExtract": "DENY",

  // The epic requires facts to keep their exact shape; every part of a fact is
  // load-bearing for a reader deciding how much a number is worth.
  "fact.factId": "PUBLISH",
  "fact.class": "PUBLISH",
  "fact.value": "PUBLISH",
  "fact.unit": "PUBLISH",
  "fact.conditions": "PUBLISH",
  "fact.locator": "PUBLISH",
  "fact.provenance": "PUBLISH",
  "fact.verdict": "PUBLISH",
  "fact.dependsOn": "PUBLISH",
  "fact.expression": "PUBLISH",

  // Open coverage must show its reason and the exact blocking facts, or the
  // page implies a safety it does not have.
  "coverage.coverageId": "PUBLISH",
  "coverage.domain": "PUBLISH",
  "coverage.status": "PUBLISH",
  "coverage.reason": "PUBLISH",
  "coverage.factIds": "PUBLISH",
  "coverage.blockingFactIds": "PUBLISH",

  "interaction.interactionId": "PUBLISH",
  "interaction.recordIds": "PUBLISH",
  "interaction.factIds": "PUBLISH",
  "interaction.conditions": "PUBLISH",
  "interaction.verdict": "PUBLISH",

  "integration.ruleId": "PUBLISH",
  // Same decision as `record.ownerSkill`: `/docs/claude-skills/<name>/` is
  // already generated for this bundle and is on the live site, so this
  // publishes an existing route rather than a new fact about the project.
  "integration.ownerSkill": "PUBLISH",
  "integration.domain": "PUBLISH",
  "integration.recordIds": "PUBLISH",
  "integration.factIds": "PUBLISH",
  "integration.conditions": "PUBLISH",
  "integration.verdict": "PUBLISH",
  // The refusal text is the most important line on an integration page: it
  // states what may NOT be concluded from the evidence shown above it.
  // Publishing the rule while withholding this would leave a reader with the
  // conditions, the arithmetic and a verdict, and nothing saying what none of
  // it proves — the single most misleading page this feature could produce.
  "integration.refusal": "PUBLISH",

  // Conditioned calculations. These are the cross-component arithmetic the
  // rules already record — a VGS divider, a clamp overage, an LED branch peak —
  // and every part of one is needed to recompute it rather than trust it. The
  // conditions string in particular says what the number is NOT proof of, and a
  // result published without it reads as a measurement.
  "integration.calculationId": "PUBLISH",
  "integration.calculationFactIds": "PUBLISH",
  "integration.calculationExpression": "PUBLISH",
  "integration.calculationResultKey": "PUBLISH",
  "integration.calculationResults": "PUBLISH",
  "integration.calculationConditions": "PUBLISH",

  // The source-to-bench evidence chain. Its stages are mostly OPEN, and that is
  // exactly what has to be visible: withholding the chain would leave the
  // upstream MIXED stages on the page implying downstream closure that has not
  // happened. Stage names and statuses are recorded vocabulary, not internal
  // review state — no reviewer, ticket or person is named.
  "integration.evidenceChainStage": "PUBLISH",
  "integration.evidenceChainStatus": "PUBLISH",
  "integration.evidenceChainFactIds": "PUBLISH",

  "pinMap.pinMapId": "PUBLISH",
  "pinMap.symbol": "PUBLISH",
  "pinMap.footprint": "PUBLISH",
  "pinMap.pins": "PUBLISH",
  // Internal review state ("pending manager independent review") — process
  // bookkeeping that reads as a quality claim out of context.
  "pinMap.reviewedBy": "DENY",

  // Curated shortcuts only. These do not widen the complete evidence-source
  // list and do not publish arbitrary repository binaries.
  "reference.document.sourceId": "PUBLISH",
  "reference.document.documentTitle": "PUBLISH",
  "reference.document.label": "PUBLISH",
  "reference.document.authorityClass": "PUBLISH",
  "reference.document.url": "PUBLISH",
  "reference.document.availability": "PUBLISH",
  "reference.document.documentKind": "PUBLISH",
  "reference.footprint.packageId": "PUBLISH",
  "reference.footprint.name": "PUBLISH",
  "reference.footprint.path": "PUBLISH",
  "reference.model.path": "PUBLISH",
  "reference.model.offset": "PUBLISH",
  "reference.model.rotation": "PUBLISH",
  "reference.model.scale": "PUBLISH",
  "reference.package.recordIds": "PUBLISH",

  "corpus.counts": "PUBLISH",

  // Narrow capabilities used by the reference contract. The PDF is an
  // outbound audited URL; footprint/model preview paths are restricted by the
  // 24-package manifest and validated before projection.
  "asset.datasheetPdf": "PUBLISH",
  "asset.footprintPreview": "PUBLISH",
  "asset.modelPreview": "PUBLISH",
  // No catch-all binary publication is permitted.
  "asset.binary": "DENY",
};

/** The package-default matrix's preset name, as `publication.matrix` names it. */
export const CIRCUIT_PUBLICATION_MATRIX_PRESET = "component-evidence-v1";

export const CIRCUIT_PUBLICATION_MATRIX_PRESETS: Readonly<Record<string, PublicationMatrix>> = {
  [CIRCUIT_PUBLICATION_MATRIX_PRESET]: CIRCUIT_PUBLICATION_MATRIX,
};
