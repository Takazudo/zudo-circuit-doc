import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { main } from "../src/cli.ts";
import { readPackageVersion } from "../src/version.ts";
import { createCapture } from "./support/capture.ts";
import { TEMPLATE_DIR, mkdtemp } from "./support/fixtures.ts";

function baseOverrides(overrides: Record<string, unknown> = {}) {
  return {
    cwd: mkdtemp(),
    stdout: createCapture(),
    stderr: createCapture(),
    templateDir: TEMPLATE_DIR,
    isTTY: false,
    runInstall: async () => {},
    runGit: async () => ({ ran: true as const }),
    randomSuffix: () => Math.random().toString(16).slice(2),
    ...overrides,
  };
}

test("--version prints exactly package.json's version", async () => {
  const stdout = createCapture();
  const code = await main(["--version"], { stdout });
  assert.equal(code, 0);
  assert.equal(stdout.text().trim(), readPackageVersion(import.meta.url));
});

test("--help exits 0 and prints usage", async () => {
  const stdout = createCapture();
  const code = await main(["--help"], { stdout });
  assert.equal(code, 0);
  assert.match(stdout.text(), /^Usage: create-zudo-circuit-doc/);
});

test("a non-TTY session with a missing destination is an error (exit 2)", async () => {
  const stderr = createCapture();
  const code = await main([], { isTTY: false, stderr });
  assert.equal(code, 2);
  assert.match(stderr.text(), /destination/i);
});

test("--yes with a missing destination is an error even on a TTY", async () => {
  const stderr = createCapture();
  const code = await main(["--yes"], { isTTY: true, stderr });
  assert.equal(code, 2);
});

test("a full run scaffolds, installs, commits, and prints the success banner + next steps", async () => {
  const overrides = baseOverrides();
  const destination = path.join(overrides.cwd, "my-project");
  const code = await main([destination], overrides);

  assert.equal(code, 0);
  assert.ok(fs.existsSync(path.join(destination, "package.json")));
  const out = overrides.stdout.text();
  assert.match(out, /Plan:/);
  assert.match(out, new RegExp(`Created ${destination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(out, /Next steps:/);
  assert.doesNotMatch(out, /pnpm install\n/); // install already ran, so it is omitted from next steps
});

test("--no-install keeps `pnpm install` in the next-steps block", async () => {
  const overrides = baseOverrides();
  const destination = path.join(overrides.cwd, "my-project");
  let installCalled = false;
  const code = await main([destination, "--no-install"], {
    ...overrides,
    runInstall: async () => {
      installCalled = true;
    },
  });

  assert.equal(code, 0);
  assert.equal(installCalled, false);
  assert.match(overrides.stdout.text(), /pnpm install\n/);
});

test("an install failure exits 1, prints no success banner, and prints recovery commands", async () => {
  const overrides = baseOverrides({
    runInstall: async () => {
      throw new Error("network unreachable");
    },
  });
  const destination = path.join(overrides.cwd, "my-project");
  const code = await main([destination], overrides);

  assert.equal(code, 1);
  assert.ok(fs.existsSync(path.join(destination, "package.json")), "generated files must be kept");
  assert.doesNotMatch(overrides.stdout.text(), /Created /);
  assert.doesNotMatch(overrides.stdout.text(), /Next steps:/);
  assert.match(overrides.stdout.text(), /Recovery:/);
  assert.match(overrides.stderr.text(), /network unreachable/);
});

test("a collision (existing, non-empty destination) exits 1 and never stages anything", async () => {
  const overrides = baseOverrides();
  const destination = path.join(overrides.cwd, "my-project");
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, "keep.txt"), "existing");

  const code = await main([destination], overrides);

  assert.equal(code, 1);
  assert.deepEqual(fs.readdirSync(destination), ["keep.txt"]);
});

test("an invalid --agent value exits 2 as a usage error", async () => {
  const overrides = baseOverrides();
  const destination = path.join(overrides.cwd, "my-project");
  const code = await main([destination, "--agent", "bogus"], overrides);
  assert.equal(code, 2);
});

test("--runtime-spec overwrites the dependency and is echoed in Next steps only when install did not run", async () => {
  const overrides = baseOverrides();
  const destination = path.join(overrides.cwd, "my-project");
  const spec = "file:/abs/path/zudo-circuit-doc-0.2.0.tgz";
  const code = await main([destination, "--no-install", "--runtime-spec", spec], overrides);

  assert.equal(code, 0);
  const pkg = JSON.parse(fs.readFileSync(path.join(destination, "package.json"), "utf8"));
  assert.equal(pkg.devDependencies["@takazudo/zudo-circuit-doc"], spec);
  const docPkg = JSON.parse(fs.readFileSync(path.join(destination, "doc", "package.json"), "utf8"));
  assert.equal(docPkg.dependencies["@takazudo/zudo-circuit-doc"], spec);
  assert.match(overrides.stdout.text(), /Applied --runtime-spec/);
  assert.doesNotMatch(overrides.stdout.text(), /```/);
});

test("a relative --runtime-spec file: path exits 2 as a usage error", async () => {
  const overrides = baseOverrides();
  const destination = path.join(overrides.cwd, "my-project");
  const code = await main([destination, "--runtime-spec", "file:../runtime.tgz"], overrides);
  assert.equal(code, 2);
  assert.ok(!fs.existsSync(destination));
});
