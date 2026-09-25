import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  assertPythonVersion,
  DEFAULT_VALIDATOR_PYTHON_MIN_VERSION,
  packagedValidatorScriptPath,
  parsePythonVersion,
  requirePackagedValidatorScript,
  resolvePythonBin,
} from "../../src/validate/python.ts";

let scratch = "";

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "zcd-python-"));
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** A fake interpreter: `--version` prints `versionLine`, anything else exits 3. */
async function stubInterpreter(name: string, versionLine: string): Promise<string> {
  const path = join(scratch, name);
  await writeFile(
    path,
    `#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo "${versionLine}"; exit 0; fi\nexit 3\n`,
    "utf8",
  );
  await chmod(path, 0o755);
  return path;
}

describe("resolvePythonBin", () => {
  it("prefers CIRCUIT_DOC_PYTHON over everything else", () => {
    const bin = resolvePythonBin("configured", {
      CIRCUIT_DOC_PYTHON: "/opt/circuit-python",
      COMPONENT_DOCS_PYTHON: "/opt/legacy-python",
    });
    assert.equal(bin, "/opt/circuit-python");
  });

  it("falls back to the legacy COMPONENT_DOCS_PYTHON when CIRCUIT_DOC_PYTHON is unset", () => {
    const bin = resolvePythonBin("configured", { COMPONENT_DOCS_PYTHON: "/opt/legacy-python" });
    assert.equal(bin, "/opt/legacy-python");
  });

  it("falls back to the caller-supplied (config) bin when neither env var is set", () => {
    assert.equal(resolvePythonBin("configured-python", {}), "configured-python");
  });

  it("falls back to python3 when nothing is configured", () => {
    assert.equal(resolvePythonBin(undefined, {}), "python3");
  });
});

describe("parsePythonVersion", () => {
  it("parses a MAJOR.MINOR string", () => {
    assert.deepEqual(parsePythonVersion("3.10"), { major: 3, minor: 10 });
  });

  it("throws on a malformed version string", () => {
    assert.throws(() => parsePythonVersion("3"), /MAJOR\.MINOR/u);
    assert.throws(() => parsePythonVersion("three.ten"), /MAJOR\.MINOR/u);
  });
});

describe("packagedValidatorScriptPath / requirePackagedValidatorScript", () => {
  it("resolves to the real, existing circuit_validate.py", () => {
    const path = packagedValidatorScriptPath();
    assert.match(path, /circuit_validate\.py$/u);
    assert.equal(requirePackagedValidatorScript(), path);
  });
});

describe("assertPythonVersion", () => {
  it("clears the gate for the real system interpreter (>= 3.10)", async () => {
    const outcome = await assertPythonVersion(
      "python3",
      scratch,
      DEFAULT_VALIDATOR_PYTHON_MIN_VERSION,
      process.env,
    );
    assert.equal(outcome, null);
  });

  it("fails with the targeted message and exit code 127 when the interpreter is too old", async () => {
    const stub = await stubInterpreter("old-python", "Python 3.5.9");
    const outcome = await assertPythonVersion(stub, scratch, { major: 3, minor: 10 }, process.env);
    assert.notEqual(outcome, null);
    assert.equal(outcome?.ok, false);
    assert.equal(outcome?.exitCode, 127);
    assert.equal(
      outcome?.stderr,
      `Python >= 3.10 is required for canonical evidence validation (found 3.5 at ${stub}); set CIRCUIT_DOC_PYTHON`,
    );
  });

  it("clears the gate when the interpreter exactly meets minVersion", async () => {
    const stub = await stubInterpreter("exact-python", "Python 3.10.0");
    const outcome = await assertPythonVersion(stub, scratch, { major: 3, minor: 10 }, process.env);
    assert.equal(outcome, null);
  });

  it("fails with exit code 127 when the interpreter cannot be run at all", async () => {
    const outcome = await assertPythonVersion(
      join(scratch, "does-not-exist"),
      scratch,
      DEFAULT_VALIDATOR_PYTHON_MIN_VERSION,
      process.env,
    );
    assert.equal(outcome?.ok, false);
    assert.equal(outcome?.exitCode, 127);
    assert.match(outcome?.stderr ?? "", />= 3\.10/u);
  });

  it("fails with exit code 127 when --version prints something unparseable", async () => {
    const stub = await stubInterpreter("weird-python", "not a version at all");
    const outcome = await assertPythonVersion(stub, scratch, DEFAULT_VALIDATOR_PYTHON_MIN_VERSION, process.env);
    assert.equal(outcome?.ok, false);
    assert.equal(outcome?.exitCode, 127);
  });
});
