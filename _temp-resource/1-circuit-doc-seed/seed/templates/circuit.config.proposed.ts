/**
 * PROPOSED CONFIG ONLY.
 * No create-zudo-circuit-doc runtime consumes this file yet.
 * Fields describe the extraction seam and must be implemented/validated locally.
 * This config format is separate from the existing evidence schema_version: 1.
 */
export default {
  configVersion: 1,
  projectRoot: ".",
  docs: {
    root: "doc",
    generatedContent: "doc/src/content/docs/components",
    preflight: "circuit/generated/preflight.json",
  },
  evidence: {
    contractVersion: 1,
    bundlesRoot: ".claude/skills",
    inventory: ".claude/skills/component-spec-audit/references/inventory.json",
    integrationRules: ".claude/skills/circuit-spec-integration/references/rules.json",
    // New convenience capability; ignored local files, never published by default.
    sourceCache: ".circuit-cache/sources",
  },
  // Proposed provider. Must be extracted from LED's hard-coded board generator.
  inventoryProvider: { kind: "manual" },
  boards: [],
  cad: {
    enabled: false,
    symbolsRoot: "symbols",
    footprintsRoot: "footprints",
    // Set only after actual libraries exist. Do not synthesize KiCad files.
    footprintLibrary: null,
    modelLibrary: null,
    previewRenderer: null,
  },
  publication: {
    selectionFile: "circuit/publication/selection.json",
    // Proposed name for the extracted, complete upstream field-decision matrix.
    matrixPreset: "component-evidence-v1",
    // Asset selections are a separate reviewed project concern.
    assetsFile: "circuit/publication/assets.json",
  },
  validation: {
    profile: "generic-v1",
    projectChecksRoot: "circuit/checks",
  },
  agentInstructions: "circuit/WORKFLOW.md",
} as const;
