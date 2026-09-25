import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";

import { packagedValidatorScriptPath } from "../../src/validate/python.ts";
import type { ValidatorInput } from "../../src/validate/resolved-config.ts";
import { createPackageValidator, runValidateCommand } from "../../src/validate/runner.ts";
import { deleteInventoryFile, writeEmptyValidatorProject } from "../fixtures/validator-fixtures.ts";

let scratch = "";

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "zcd-runner-"));
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/**
 * A fake interpreter: answers `--version`, records its own argv (minus
 * `--version`) to stderr as `ARGV:<json>`, echoes the `--config` payload
 * (stdin or file, following the real transport) to stdout, and exits
 * `FAKE_EXIT` (default 0). Stands in for `pythonBin`, never for the packaged
 * `circuit_validate.py` — the runner is free to pass any script path since
 * this fake never reads it.
 */
async function writeFakeInterpreter(path: string): Promise<void> {
  const source = [
    "#!/usr/bin/env python3",
    "import json, os, sys",
    'if len(sys.argv) >= 2 and sys.argv[1] == "--version":',
    '    print("Python 3.12.0")',
    "    sys.exit(0)",
    "args = sys.argv[1:]",
    'sys.stderr.write("ARGV:" + json.dumps(args) + "\\n")',
    'target = args[args.index("--config") + 1]',
    'config_text = sys.stdin.read() if target == "-" else open(target, encoding="utf-8").read()',
    "sys.stdout.write(config_text)",
    'exit_code = int(os.environ.get("FAKE_EXIT", "0"))',
    "if exit_code:",
    '    sys.stderr.write(f"FAKE FAIL exit={exit_code}\\n")',
    "sys.exit(exit_code)",
    "",
  ].join("\n");
  await writeFile(path, source, "utf8");
  await chmod(path, 0o755);
}

function argvFrom(stderrText: string): string[] {
  const line = stderrText.split("\n").find((entry) => entry.startsWith("ARGV:"));
  assert.ok(line, `no ARGV: line in stderr: ${stderrText}`);
  return JSON.parse(line.slice("ARGV:".length)) as string[];
}

describe("createPackageValidator (fake interpreter)", () => {
  let fakePython = "";
  let input: ValidatorInput;

  before(async () => {
    fakePython = join(scratch, "fake-python");
    await writeFakeInterpreter(fakePython);
    input = await writeEmptyValidatorProject(join(scratch, "fake-project"));
  });

  it("pipes the resolved config on stdin via --config - by default", async () => {
    const outcome = await createPackageValidator(input, { pythonBin: fakePython })();
    assert.equal(outcome.ok, true, outcome.stderr);
    assert.deepEqual(argvFrom(outcome.stderr).slice(-2), ["--config", "-"]);
    const received = JSON.parse(outcome.stdout);
    assert.equal(received.projectRoot, input.projectRoot);
    assert.equal(received.bundles.root, input.bundles.root);
    assert.equal(received.template.name, "component-example");
  });

  it("runs -B <script> --config - as the command, script first", async () => {
    const outcome = await createPackageValidator(input, { pythonBin: fakePython })();
    assert.equal(outcome.command[0], fakePython);
    assert.equal(outcome.command[1], "-B");
    assert.equal(outcome.command[2], packagedValidatorScriptPath());
  });

  it("writes a unique mkdtemp file and removes it afterwards when transport is tempfile", async () => {
    const outcome = await createPackageValidator(input, { pythonBin: fakePython, transport: "tempfile" })();
    assert.equal(outcome.ok, true, outcome.stderr);
    const argv = argvFrom(outcome.stderr);
    const tempPath = argv[argv.indexOf("--config") + 1] as string;
    assert.notEqual(tempPath, "-");
    assert.match(tempPath, /zcd-validate-/u);
    const received = JSON.parse(outcome.stdout);
    assert.equal(received.projectRoot, input.projectRoot);
    await assert.rejects(stat(tempPath), /ENOENT/u);
  });

  it("maps a nonzero exit through ok:false with the real exit code and stderr", async () => {
    const outcome = await createPackageValidator(input, {
      pythonBin: fakePython,
      env: { ...process.env, FAKE_EXIT: "2" },
    })();
    assert.equal(outcome.ok, false);
    assert.equal(outcome.exitCode, 2);
    assert.match(outcome.stderr, /FAKE FAIL exit=2/u);
  });

  it("never passes --online/--refresh-source/--json unless the caller builds them explicitly", async () => {
    const outcome = await createPackageValidator(input, { pythonBin: fakePython })();
    const argv = argvFrom(outcome.stderr);
    assert.equal(argv.includes("--online"), false);
    assert.equal(argv.includes("--refresh-source"), false);
    assert.equal(argv.includes("--json"), false);
  });

  it("passes --online/--refresh-source/--json through extraArgs when asked", async () => {
    const outcome = await createPackageValidator(input, {
      pythonBin: fakePython,
      extraArgs: ["--online", "--json"],
    })();
    const argv = argvFrom(outcome.stderr);
    assert.deepEqual(argv.slice(-2), ["--online", "--json"]);
  });

  describe("interpreter precedence (env overrides the configured bin)", () => {
    it("CIRCUIT_DOC_PYTHON wins over the configured pythonBin", async () => {
      const configured = join(scratch, "configured-python-a");
      const overridden = join(scratch, "circuit-doc-python-a");
      await writeFakeInterpreter(configured);
      await writeFakeInterpreter(overridden);
      const outcome = await createPackageValidator(input, {
        pythonBin: configured,
        env: { ...process.env, CIRCUIT_DOC_PYTHON: overridden },
      })();
      assert.equal(outcome.ok, true, outcome.stderr);
      assert.equal(outcome.command[0], overridden);
    });

    it("legacy COMPONENT_DOCS_PYTHON wins over the configured pythonBin when CIRCUIT_DOC_PYTHON is unset", async () => {
      const configured = join(scratch, "configured-python-b");
      const legacy = join(scratch, "legacy-python-b");
      await writeFakeInterpreter(configured);
      await writeFakeInterpreter(legacy);
      const env: NodeJS.ProcessEnv = { ...process.env, COMPONENT_DOCS_PYTHON: legacy };
      delete env.CIRCUIT_DOC_PYTHON;
      const outcome = await createPackageValidator(input, { pythonBin: configured, env })();
      assert.equal(outcome.ok, true, outcome.stderr);
      assert.equal(outcome.command[0], legacy);
    });

    it("falls back to the configured pythonBin when neither env var is set", async () => {
      const configured = join(scratch, "configured-python-c");
      await writeFakeInterpreter(configured);
      const env = { ...process.env };
      delete env.CIRCUIT_DOC_PYTHON;
      delete env.COMPONENT_DOCS_PYTHON;
      const outcome = await createPackageValidator(input, { pythonBin: configured, env })();
      assert.equal(outcome.ok, true, outcome.stderr);
      assert.equal(outcome.command[0], configured);
    });
  });
});

describe("runValidateCommand (fake interpreter)", () => {
  let fakePython = "";
  let input: ValidatorInput;

  before(async () => {
    fakePython = join(scratch, "fake-python-cli");
    await writeFakeInterpreter(fakePython);
    input = await writeEmptyValidatorProject(join(scratch, "fake-project-cli"));
  });

  function collector() {
    const chunks: string[] = [];
    return { write: (chunk: unknown) => (chunks.push(String(chunk)), true), text: () => chunks.join("") };
  }

  it("streams stdout/stderr and maps exit codes 0, 1 and 2 unchanged", async () => {
    for (const exit of [0, 1, 2]) {
      const out = collector();
      const err = collector();
      const code = await runValidateCommand(input, {
        pythonBin: fakePython,
        env: { ...process.env, FAKE_EXIT: String(exit) },
        stdout: out,
        stderr: err,
      });
      assert.equal(code, exit);
      const received = JSON.parse(out.text());
      assert.equal(received.projectRoot, input.projectRoot);
      if (exit !== 0) assert.match(err.text(), new RegExp(`FAKE FAIL exit=${exit}`));
    }
  });

  it("maps any other outcome (e.g. the interpreter gate) to a check failure, exit 1", async () => {
    const out = collector();
    const err = collector();
    const code = await runValidateCommand(input, {
      pythonBin: join(scratch, "does-not-exist"),
      stdout: out,
      stderr: err,
    });
    assert.equal(code, 1);
    assert.match(err.text(), />= 3\.10/u);
  });

  it("adds --online, --refresh-source and --json only when asked", async () => {
    const out = collector();
    const err = collector();
    await runValidateCommand(input, {
      pythonBin: fakePython,
      online: true,
      refreshSources: ["src-a", "src-b"],
      json: true,
      stdout: out,
      stderr: err,
    });
    const argv = argvFrom(err.text());
    assert.deepEqual(
      argv.slice(argv.indexOf("--config") + 2),
      ["--online", "--refresh-source", "src-a", "--refresh-source", "src-b", "--json"],
    );
  });

  it("passes no extra args by default (never --online)", async () => {
    const out = collector();
    const err = collector();
    await runValidateCommand(input, { pythonBin: fakePython, stdout: out, stderr: err });
    const argv = argvFrom(err.text());
    assert.deepEqual(argv.slice(-2), ["--config", "-"]);
  });
});

/** Recursively finds every path segment matching `name` under `root`. */
async function findDirsNamed(root: string, name: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && entry.name === name)
    .map((entry) => join(entry.parentPath, entry.name));
}

/** A stable digest of every file's relative path and content under `root`. */
async function hashTree(root: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.slice(root.length));
    hash.update(await readFile(file));
  }
  return hash.digest("hex");
}

describe("createPackageValidator against the real circuit_validate.py (system python3)", () => {
  it("passes on a synthetic empty project: SCOPE, CAD SKIP, PASS 0 lines, offline", async () => {
    const root = join(scratch, "real-empty-project");
    const input = await writeEmptyValidatorProject(root);
    const outcome = await createPackageValidator(input)();
    assert.equal(outcome.ok, true, outcome.stderr);
    assert.equal(outcome.exitCode, 0);
    assert.deepEqual(outcome.stdout.trim().split("\n"), [
      "SCOPE: inventory provider=manual; schematic/placement binding not performed " +
        "(0 lines, 0 declared placements unverified); pin-asset check not performed: cad disabled",
      "SKIP: pin-asset check not performed: cad disabled",
      "PASS: component-spec contract; 0 lines; offline=True; refreshed=none",
    ]);
    assert.equal(outcome.stderr, "");
  });

  it("fails naming the missing inventory path, exit 1, no traceback", async () => {
    const root = join(scratch, "real-missing-inventory");
    const input = await writeEmptyValidatorProject(root);
    await deleteInventoryFile(input);
    const outcome = await createPackageValidator(input)();
    assert.equal(outcome.ok, false);
    assert.equal(outcome.exitCode, 1);
    assert.equal(outcome.stderr, `FAIL: inventory: configured file is missing: ${input.inventory.path}\n`);
    assert.equal(outcome.stderr.includes("Traceback"), false);
  });

  it("leaves the project tree byte-unchanged and writes no __pycache__ under python/", async () => {
    const root = join(scratch, "real-byte-unchanged");
    const input = await writeEmptyValidatorProject(root);
    const before_ = await hashTree(root);

    const outcome = await createPackageValidator(input)();
    assert.equal(outcome.ok, true, outcome.stderr);

    const after_ = await hashTree(root);
    assert.equal(after_, before_, "the project tree changed during validate");

    const pythonRoot = dirname(packagedValidatorScriptPath());
    assert.deepEqual(await findDirsNamed(pythonRoot, "__pycache__"), []);
  });

  it("runs two concurrent validators over the same project without interference", async () => {
    const root = join(scratch, "real-concurrent");
    const input = await writeEmptyValidatorProject(root);
    const [stdinOutcome, tempFileOutcome] = await Promise.all([
      createPackageValidator(input)(),
      createPackageValidator(input, { transport: "tempfile" })(),
    ]);
    assert.equal(stdinOutcome.ok, true, stdinOutcome.stderr);
    assert.equal(tempFileOutcome.ok, true, tempFileOutcome.stderr);
    assert.equal(stdinOutcome.stdout, tempFileOutcome.stdout);
  });
});
