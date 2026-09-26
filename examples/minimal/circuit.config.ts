import type { CircuitConfig } from "@takazudo/zudo-circuit-doc/config";

export default {
  configVersion: 1,
  project: {
    name: "example-minimal-circuit",
    title: "Example: TMP1075 I²C Temperature Breakout",
  },
  docs: {
    root: "doc",
    generatedContent: "doc/src/content/docs/components",
    preflight: "circuit/generated/preflight.json",
    publicRoot: "doc/public",
    dist: "doc/dist",
    agentResources: true,
  },
  evidence: {
    contractVersion: 1,
    bundlesRoot: ".claude/skills",
    ownerPrefix: "component-",
    auditSkill: "component-spec-audit",
    integrationSkill: "circuit-spec-integration",
    inventory: ".claude/skills/component-spec-audit/references/inventory.json",
    integrationRules: ".claude/skills/circuit-spec-integration/references/rules.json",
    directRouting: ".claude/skills/component-spec-audit/references/direct-routing.json",
    vendorQualifiers: ".claude/skills/component-spec-audit/references/external-vendor-qualifiers.json",
    sourceCache: ".circuit-cache/sources",
  },
  inventoryProvider: { kind: "manual" },
  publication: {
    selection: "circuit/publication/selection.json",
    assets: "circuit/publication/assets.json",
  },
  cad: {
    enabled: true,
    libraryName: "example-minimal-circuit-lib",
    symbolLibraries: ["symbols/example-minimal-circuit-lib.kicad_sym"],
    footprintMasterRoot: "footprints/kicad",
    footprintLibraryRoot: "footprints/kicad/example-minimal-circuit-lib.pretty",
    modelRoot: "footprints/kicad/example-minimal-circuit-lib.3dshapes",
    modelLocatorPrefix: "${KIPRJMOD}/../../footprints/kicad/example-minimal-circuit-lib.3dshapes/",
    previewRenderer: {
      image: "kicad/kicad@sha256:e638b79b0321f29395a5b783e94bb9f3c73303e8da15da27b8f5cb4b67a37729",
      version: "9.0.9",
      platform: "linux/amd64",
      layers: ["F.Cu", "F.Silkscreen", "F.Fabrication", "F.Courtyard"],
      theme: "KiCad Default",
      options: ["--black-and-white"],
    },
  },
  validation: {},
} satisfies CircuitConfig;
