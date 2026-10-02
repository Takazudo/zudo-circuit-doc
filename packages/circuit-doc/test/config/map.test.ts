import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveCircuitConfig } from "../../src/config/resolve.ts";
import {
  declaredProjectFiles,
  missingProjectFiles,
  projectPathsFor,
  validatorInputFor,
} from "../../src/config/map.ts";
import { DEFAULT_PROJECT_CONFIG, mutable } from "./fixtures.ts";
import { CIRCUIT_PROJECT_PATH_KEYS, projectPaths } from "../../src/provider/v1/paths.ts";

describe("candidate inventory config mapping", () => {
  it("defaults to null in provider paths and validator input", () => {
    const config = resolveCircuitConfig(DEFAULT_PROJECT_CONFIG, "/work/project");

    assert.equal(projectPathsFor(config).candidateInventoryFile, null);
    assert.equal(validatorInputFor(config).inventory.candidatesPath, null);
  });

  it("maps a configured path and reports it when the file is missing", async () => {
    const source = mutable(DEFAULT_PROJECT_CONFIG);
    source.evidence.candidates = "circuit/candidates.json";
    const configDir = `/tmp/candidate-config-map-${process.pid}-${Date.now()}`;
    const config = resolveCircuitConfig(source as typeof DEFAULT_PROJECT_CONFIG, configDir);
    const candidatePath = `${configDir}/circuit/candidates.json`;

    assert.equal(projectPathsFor(config).candidateInventoryFile, candidatePath);
    assert.equal(validatorInputFor(config).inventory.candidatesPath, candidatePath);
    assert.ok(
      declaredProjectFiles(config).some(
        (entry) => entry.field === "evidence.candidates" && entry.path === candidatePath && entry.kind === "file",
      ),
    );

    const missing = await missingProjectFiles(config);
    assert.ok(missing.some((entry) => entry.field === "evidence.candidates" && entry.path === candidatePath));
  });

  it("accepts the candidate path as an optional projectPaths extra", () => {
    const paths = projectPaths("/work/project", {
      projectRoot: ".",
      bundlesRoot: ".",
      inventoryFile: ".",
      integrationRulesFile: ".",
      generatedRoot: ".",
      preflightFile: ".",
      distRoot: ".",
      publicRoot: ".",
      footprintMasterRoot: ".",
      footprintLibraryRoot: ".",
      modelRoot: ".",
      modelPublicRoot: ".",
      footprintPreviewRoot: ".",
      candidateInventoryFile: "circuit/candidates.json",
    });

    assert.equal(paths.candidateInventoryFile, "/work/project/circuit/candidates.json");
    assert.equal((CIRCUIT_PROJECT_PATH_KEYS as readonly string[]).includes("candidateInventoryFile"), false);
  });
});
