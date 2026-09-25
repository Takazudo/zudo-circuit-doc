const E = "$HOME/repos/circuits/zudo-led-lamp/doc/component-docs";
const { runPipeline } = await import(`${E}/core/pipeline.ts`);
const { VIEW_MODEL_VERSION } = await import(`${E}/core/view-model.ts`);
const { CIRCUIT_PUBLICATION_MATRIX } = await import(`${E}/adapters/circuit/matrix.ts`);
const { projectIndex } = await import(`${E}/adapters/circuit/index.ts`);
const { indexEvidence } = await import(`${E}/adapters/circuit/evidence.ts`);
const selection = { recordIds: [], sourceIds: [], linkableSourceIds: [], documentSelections: [], expect: { records: 0, sources: 0, integrationRules: 0 } };
const inventory = { schema_version: 1, lines: [], assertions: { orderable_lines: 0, fitted_lines: 0, dnp_or_hand_fit_lines: 0 } };
const adapter = {
  id: "circuit-component-spec", contractVersion: 1, supportedViewModelVersions: [VIEW_MODEL_VERSION],
  validate: async () => ({ ok: true, command: [], exitCode: 0, stdout: "", stderr: "" }),
  selection, matrix: CIRCUIT_PUBLICATION_MATRIX,
  project: async ({ policy }) => {
    const idx = indexEvidence(inventory, [], []);
    return projectIndex({ ...idx, references: { documentsByRecordId: new Map(), packages: [], packageByRecordId: new Map() } }, policy);
  },
};
const out = new URL("./out-empty/", import.meta.url).pathname;
const r = await runPipeline(adapter, { generatedRoot: out, dryRun: false });
console.log(r.pages.map(p => p.relativePath), r.emitted, JSON.stringify(r.report.counts));
