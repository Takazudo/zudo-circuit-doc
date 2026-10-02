import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ConfigError, type ConfigIssue } from "../../src/config/errors.ts";
import { collectCircuitConfigIssues, configPathProblem, validateCircuitConfig } from "../../src/config/schema.ts";
import { DEFAULT_PROJECT_CONFIG, LED_STYLE_CONFIG, mutable } from "./fixtures.ts";

function paths(issues: readonly ConfigIssue[]): string[] {
  return issues.map((issue) => issue.path);
}

function issueFor(issues: readonly ConfigIssue[], path: string): ConfigIssue {
  const found = issues.find((issue) => issue.path === path);
  assert.ok(found, `expected an issue at ${path}; got ${JSON.stringify(issues)}`);
  return found;
}

describe("valid configs", () => {
  test("the generated-project default validates", () => {
    assert.deepEqual(collectCircuitConfigIssues(DEFAULT_PROJECT_CONFIG), []);
    assert.equal(validateCircuitConfig(DEFAULT_PROJECT_CONFIG), DEFAULT_PROJECT_CONFIG);
  });

  test("the LED-style config (root: upstream, CAD enabled) validates", () => {
    assert.deepEqual(collectCircuitConfigIssues(LED_STYLE_CONFIG), []);
  });

  test("optional sections may be omitted", () => {
    const config = mutable(DEFAULT_PROJECT_CONFIG);
    delete config.validation;
    delete config.docs.agentResources;
    delete config.cad.libraryName;
    assert.deepEqual(collectCircuitConfigIssues(config), []);
  });

  test("docs.generatedNotice accepts a boolean, independent of generatedMarker", () => {
    const config = mutable(DEFAULT_PROJECT_CONFIG);
    config.docs.generatedNotice = false;
    assert.deepEqual(collectCircuitConfigIssues(config), []);
    config.docs.generatedMarker = "any single-line marker";
    config.docs.generatedNotice = true;
    assert.deepEqual(collectCircuitConfigIssues(config), []);
  });

  test("root may be the config directory itself", () => {
    assert.deepEqual(collectCircuitConfigIssues({ ...DEFAULT_PROJECT_CONFIG, root: "." }), []);
    assert.deepEqual(collectCircuitConfigIssues({ ...DEFAULT_PROJECT_CONFIG, root: "./data/../data" }), []);
  });
});

describe("error classes, every error reported", () => {
  test("a non-object config", () => {
    for (const value of [null, 1, "x", [], undefined]) {
      const issues = collectCircuitConfigIssues(value);
      assert.equal(issues.length, 1);
      assert.equal(issues[0]?.path, "");
      assert.match(issues[0]?.message ?? "", /must be an object/u);
    }
  });

  test("an empty object lists every missing required section", () => {
    assert.deepEqual(paths(collectCircuitConfigIssues({})), [
      "configVersion",
      "project",
      "docs",
      "evidence",
      "inventoryProvider",
      "publication",
      "cad",
    ]);
  });

  test("unknown keys are rejected at every level", () => {
    const config = mutable(DEFAULT_PROJECT_CONFIG);
    config.extra = 1;
    config.docs.extra = 1;
    config.evidence.extra = 1;
    config.inventoryProvider.extra = 1;
    config.cad.symbolLibraries = ["symbols/x.kicad_sym"];
    config.validation.profile = "generic-v1";
    const issues = collectCircuitConfigIssues(config);
    assert.deepEqual(paths(issues).sort(), [
      "cad.symbolLibraries",
      "docs.extra",
      "evidence.extra",
      "extra",
      "inventoryProvider.extra",
      "validation.profile",
    ]);
    for (const issue of issues) assert.match(issue.message, /^unknown key/u);
  });

  test("configVersion and evidence.contractVersion must be 1", () => {
    const config = mutable(DEFAULT_PROJECT_CONFIG);
    config.configVersion = 2;
    config.evidence.contractVersion = "1";
    const issues = collectCircuitConfigIssues(config);
    assert.deepEqual(paths(issues), ["configVersion", "evidence.contractVersion"]);
    assert.match(issueFor(issues, "configVersion").message, /must be 1 \(got 2\)/u);
  });

  test("wrong types are reported with their field paths", () => {
    const config = mutable(DEFAULT_PROJECT_CONFIG);
    config.project.name = "";
    config.project.title = 3;
    config.docs.agentResources = "yes";
    config.docs.generatedMarker = "line1\nline2";
    config.docs.generatedNotice = "yes";
    config.evidence.ownerPrefix = "a/b";
    config.validation.pythonMinVersion = 3.1;
    config.validation.userAgent = "";
    config.scan = { minimumOwnedFiles: -1, expectedWithheld: 1.5, positiveControlRecord: 7 };
    config.browserSmoke = { representatives: [{ kind: "IC", path: "docs/x", slug: "x", identity: "X" }, "nope"] };
    assert.deepEqual(paths(collectCircuitConfigIssues(config)), [
      "project.name",
      "project.title",
      "docs.agentResources",
      "docs.generatedMarker",
      "docs.generatedNotice",
      "evidence.ownerPrefix",
      "validation.pythonMinVersion",
      "validation.userAgent",
      "scan.minimumOwnedFiles",
      "scan.expectedWithheld",
      "scan.positiveControlRecord",
      "browserSmoke.representatives[0].path",
      "browserSmoke.representatives[1]",
    ]);
  });

  test("pythonMinVersion below the 3.10 floor is rejected", () => {
    const config = mutable(DEFAULT_PROJECT_CONFIG);
    config.validation.pythonMinVersion = "3.9";
    assert.match(issueFor(collectCircuitConfigIssues(config), "validation.pythonMinVersion").message, /at least 3\.10/u);
    config.validation.pythonMinVersion = "3.12";
    assert.deepEqual(collectCircuitConfigIssues(config), []);
  });

  test("inventoryProvider.kind must be a registered kind", () => {
    const config = mutable(DEFAULT_PROJECT_CONFIG);
    config.inventoryProvider = { kind: "jlcpcb" };
    const issue = issueFor(collectCircuitConfigIssues(config), "inventoryProvider.kind");
    assert.match(issue.message, /manual, led-generator-v1/u);
    config.inventoryProvider = {};
    assert.match(issueFor(collectCircuitConfigIssues(config), "inventoryProvider.kind").message, /is required/u);
  });

  test("led-generator-v1 requires a non-empty specs list", () => {
    const config = mutable(DEFAULT_PROJECT_CONFIG);
    config.inventoryProvider = { kind: "led-generator-v1" };
    assert.deepEqual(paths(collectCircuitConfigIssues(config)), ["inventoryProvider.specs"]);
    config.inventoryProvider = { kind: "led-generator-v1", specs: [] };
    assert.match(issueFor(collectCircuitConfigIssues(config), "inventoryProvider.specs").message, /must not be empty/u);
    config.inventoryProvider = { kind: "led-generator-v1", specs: [{ path: "/abs/spec.py" }, { file: "x" }] };
    assert.deepEqual(paths(collectCircuitConfigIssues(config)), [
      "inventoryProvider.specs[0].path",
      "inventoryProvider.specs[1].path",
      "inventoryProvider.specs[1].file",
    ]);
  });

  test("led-generator-v1 accepts placement fit, reviewed LCSC exceptions and board names", () => {
    const config = mutable(DEFAULT_PROJECT_CONFIG);
    config.inventoryProvider = {
      kind: "led-generator-v1",
      specs: [{ path: "scripts/schgen/main.py", board: "main" }],
      fit: "placement",
      mpnFromValueLcsc: ["C144397", "C123"],
    };
    assert.deepEqual(collectCircuitConfigIssues(config), []);
  });

  test("led-generator-v1 rejects invalid options and unknown spec keys", () => {
    const config = mutable(DEFAULT_PROJECT_CONFIG);
    config.inventoryProvider = {
      kind: "led-generator-v1",
      specs: [{ path: "spec.py", board: " " }],
      fit: "mixed",
      mpnFromValueLcsc: ["c123", "C123", "C123"],
    };
    config.inventoryProvider.specs[0].extra = true;
    const issues = collectCircuitConfigIssues(config);
    assert.deepEqual(paths(issues).sort(), [
      "inventoryProvider.fit",
      "inventoryProvider.mpnFromValueLcsc[0]",
      "inventoryProvider.mpnFromValueLcsc[2]",
      "inventoryProvider.specs[0].board",
      "inventoryProvider.specs[0].extra",
    ]);
    assert.match(issueFor(issues, "inventoryProvider.fit").message, /line, placement/u);
    assert.match(issueFor(issues, "inventoryProvider.mpnFromValueLcsc[0]").message, /C\[0-9\]\+/u);
    assert.match(issueFor(issues, "inventoryProvider.mpnFromValueLcsc[2]").message, /duplicates/u);
    assert.match(issueFor(issues, "inventoryProvider.specs[0].board").message, /non-empty string/u);
    assert.match(issueFor(issues, "inventoryProvider.specs[0].extra").message, /^unknown key/u);
  });

  test("the manual provider takes no other keys", () => {
    const config = mutable(DEFAULT_PROJECT_CONFIG);
    config.inventoryProvider = { kind: "manual", specs: [] };
    assert.deepEqual(paths(collectCircuitConfigIssues(config)), ["inventoryProvider.specs"]);
  });

  test("cad.enabled true requires every CAD field", () => {
    const config = mutable(DEFAULT_PROJECT_CONFIG);
    config.cad = { enabled: true };
    assert.deepEqual(paths(collectCircuitConfigIssues(config)), [
      "cad.libraryName",
      "cad.symbolLibraries",
      "cad.footprintMasterRoot",
      "cad.footprintLibraryRoot",
      "cad.modelRoot",
      "cad.modelLocatorPrefix",
      "cad.previewRenderer",
    ]);
  });

  test("cad.enabled must be a boolean", () => {
    const config = mutable(DEFAULT_PROJECT_CONFIG);
    config.cad = { enabled: "true" };
    assert.deepEqual(paths(collectCircuitConfigIssues(config)), ["cad.enabled"]);
    config.cad = {};
    assert.match(issueFor(collectCircuitConfigIssues(config), "cad.enabled").message, /is required/u);
  });

  test("CAD renderer and limits are checked in depth", () => {
    const config = mutable(LED_STYLE_CONFIG);
    config.cad.previewRenderer.layers = [];
    config.cad.previewRenderer.options = ["ok", 1];
    delete config.cad.previewRenderer.image;
    config.cad.symbolLibraries = [];
    config.cad.limits = { modelBytes: 0, footprintBytes: 1024, unknown: 1 };
    assert.deepEqual(paths(collectCircuitConfigIssues(config)), [
      "cad.symbolLibraries",
      "cad.previewRenderer.image",
      "cad.previewRenderer.layers",
      "cad.previewRenderer.options[1]",
      "cad.limits.modelBytes",
      "cad.limits.unknown",
    ]);
  });

  test("validateCircuitConfig throws a ConfigError carrying the full list", () => {
    const config = mutable(DEFAULT_PROJECT_CONFIG);
    config.configVersion = 0;
    config.docs.root = "../doc";
    config.cad.enabled = 1;
    assert.throws(
      () => validateCircuitConfig(config, { configPath: "/p/circuit.config.ts" }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.equal(error.code, "CONFIG_INVALID");
        assert.equal(error.configPath, "/p/circuit.config.ts");
        assert.deepEqual(paths(error.errors), ["configVersion", "docs.root", "cad.enabled"]);
        assert.match(error.message, /3 error\(s\)/u);
        assert.match(error.message, /docs\.root: /u);
        return true;
      },
    );
  });
});

describe("path rules", () => {
  test("configPathProblem accepts contained relative paths", () => {
    for (const ok of [".", "doc", "./doc", "a/b/c.json", "a/../b", ".claude/skills", "a/b/.."]) {
      assert.equal(configPathProblem(ok), undefined, ok);
    }
  });

  test("configPathProblem rejects escapes, absolute paths and junk", () => {
    const cases: [unknown, RegExp][] = [
      ["..", /escape/u],
      ["../doc", /escape/u],
      ["a/../../doc", /escape/u],
      ["./..", /escape/u],
      ["/abs/doc", /absolute/u],
      ["C:/doc", /absolute/u],
      ["c:doc", /absolute/u],
      ["doc\\sub", /forward slashes/u],
      ["\\\\server\\share", /forward slashes/u],
      ["", /empty/u],
      ["a\0b", /NUL/u],
      [null, /string path/u],
      [["doc"], /string path/u],
    ];
    for (const [value, pattern] of cases) {
      assert.match(configPathProblem(value) ?? "", pattern, JSON.stringify(value));
    }
  });

  test("root and every path field reject escapes, each with its own path", () => {
    const config = mutable(LED_STYLE_CONFIG);
    config.root = "..";
    config.docs.generatedContent = "/tmp/out";
    config.evidence.inventory = "../other/inventory.json";
    config.evidence.forwardTests = "../tests";
    config.publication.matrix = "../matrix.json";
    config.cad.symbolLibraries = ["ok.kicad_sym", "../../x.kicad_sym"];
    config.cad.footprintPathBase = "..";
    config.validation.policy = "/etc/policy.json";
    config.inventoryProvider.specs = [{ path: "../spec.py" }];
    assert.deepEqual(paths(collectCircuitConfigIssues(config)), [
      "root",
      "docs.generatedContent",
      "evidence.inventory",
      "evidence.forwardTests",
      "inventoryProvider.specs[0].path",
      "publication.matrix",
      "cad.symbolLibraries[1]",
      "cad.footprintPathBase",
      "validation.policy",
    ]);
  });

  test("evidence.candidates is an optional nullable path", () => {
    const config = mutable(DEFAULT_PROJECT_CONFIG);
    config.evidence.candidates = null;
    assert.deepEqual(collectCircuitConfigIssues(config), []);

    config.evidence.candidates = "circuit/candidates.json";
    assert.deepEqual(collectCircuitConfigIssues(config), []);

    config.evidence.candidates = 42;
    assert.deepEqual(paths(collectCircuitConfigIssues(config)), ["evidence.candidates"]);
  });
});
