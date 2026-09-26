/**
 * Footprint selection (issue #20, spec item 2): the package list comes from
 * the already-validated CAD reference contract (#15), never from a re-read of
 * disk, and its order is the selection order — `readCircuitReferenceContract`
 * builds `packages` by walking `selection.recordIds` in order, so preserving
 * that order here is what keeps `check.ts`'s per-index comparison meaningful.
 *
 * The upstream 25/35 literal gates are gone; `expect.packages` (checked inside
 * `readCircuitReferenceContract`) replaces the package count, and
 * `assertAliasCoverage` below replaces the hard-coded 35-record alias count
 * with the same count derived from the selection itself: every selected
 * record that is not `mounting: "external"` must be covered by exactly one
 * package's `recordIds`.
 */

import { fail } from "../core/errors.ts";
import type { InstanceSelection } from "../core/publication.ts";
import type { EvidenceIndex } from "../provider/v1/evidence.ts";
import type { FootprintSelection } from "./manifest.ts";

export function footprintSelectionsFromIndex(
  index: EvidenceIndex,
  selection: InstanceSelection,
): readonly FootprintSelection[] {
  const references = index.references;
  if (references === undefined) {
    fail("ADAPTER_CONTRACT", "reference assets were not validated before footprint preview selection");
  }
  assertAliasCoverage(index, selection, references.packages);
  return references.packages.map((entry) => ({
    packageId: entry.packageId,
    footprintName: entry.footprintName,
    footprintPath: entry.footprintPath,
    recordIds: entry.recordIds,
  }));
}

function assertAliasCoverage(
  index: EvidenceIndex,
  selection: InstanceSelection,
  packages: readonly FootprintSelection[],
): void {
  const nonExternalSelected = selection.recordIds.filter((recordId) => {
    const entry = index.recordById.get(recordId);
    return entry !== undefined && entry.line.mounting !== "external";
  });
  const covered = new Map<string, string>();
  for (const entry of packages) {
    for (const recordId of entry.recordIds) {
      const existing = covered.get(recordId);
      if (existing !== undefined && existing !== entry.footprintName) {
        fail("ADAPTER_CONTRACT", `record ${recordId} maps to more than one footprint package`, {
          recordId,
          first: existing,
          second: entry.footprintName,
        });
      }
      covered.set(recordId, entry.footprintName);
    }
  }
  if (covered.size !== nonExternalSelected.length) {
    fail(
      "ADAPTER_CONTRACT",
      `footprint packages must cover exactly the selected non-external records (expected ${nonExternalSelected.length}, got ${covered.size})`,
      { expected: nonExternalSelected.length, actual: covered.size },
    );
  }
  for (const recordId of nonExternalSelected) {
    if (!covered.has(recordId)) {
      fail("ADAPTER_CONTRACT", `selected record ${recordId} is not covered by any footprint package`, { recordId });
    }
  }
}
