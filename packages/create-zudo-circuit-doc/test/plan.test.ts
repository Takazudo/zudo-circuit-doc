import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import type { ParsedOptions } from "../src/args.ts";
import { CliUsageError } from "../src/errors.ts";
import { formatPlan, resolvePlan } from "../src/plan.ts";

function baseOptions(overrides: Partial<ParsedOptions> = {}): ParsedOptions {
  return {
    help: false,
    version: false,
    yes: false,
    destination: undefined,
    name: undefined,
    title: undefined,
    library: undefined,
    agent: "both",
    install: true,
    git: true,
    runtimeSpec: undefined,
    ...overrides,
  };
}

test("derives name/title/library from the destination basename", () => {
  const plan = resolvePlan(baseOptions(), "my-project", "/cwd");
  assert.equal(plan.destinationPath, path.resolve("/cwd", "my-project"));
  assert.equal(plan.name, "my-project");
  assert.equal(plan.title, "My Project");
  assert.equal(plan.library, "my-project");
});

test("explicit --name/--title/--library override the derived defaults", () => {
  const plan = resolvePlan(
    baseOptions({ name: "custom-name", title: "Custom Title", library: "CustomLib" }),
    "dest",
    "/cwd",
  );
  assert.equal(plan.name, "custom-name");
  assert.equal(plan.title, "Custom Title");
  assert.equal(plan.library, "CustomLib");
});

test("a destination path with spaces works with a separate --name", () => {
  const plan = resolvePlan(baseOptions({ name: "spaced-project" }), "a path with spaces", "/cwd");
  assert.equal(plan.destinationPath, path.resolve("/cwd", "a path with spaces"));
  assert.equal(plan.name, "spaced-project");
});

test("an invalid derived name (from the basename) fails with a hint to pass --name", () => {
  assert.throws(
    () => resolvePlan(baseOptions(), "Not A Valid Name", "/cwd"),
    (error: unknown) => error instanceof CliUsageError && /--name/.test((error as Error).message),
  );
});

test("an explicit invalid --name still fails validation", () => {
  assert.throws(() => resolvePlan(baseOptions({ name: "node_modules" }), "dest", "/cwd"), CliUsageError);
});

test("formatPlan renders every field", () => {
  const plan = resolvePlan(baseOptions(), "my-project", "/cwd");
  const text = formatPlan(plan);
  assert.match(text, /destination: /);
  assert.match(text, /name: my-project/);
  assert.match(text, /title: My Project/);
  assert.match(text, /library: my-project/);
  assert.match(text, /agent: both/);
  assert.match(text, /install: yes/);
  assert.match(text, /git: yes/);
  assert.match(text, /runtimeSpec: \(template default\)/);
});

test("a valid --runtime-spec (semver range) passes through unchanged", () => {
  const plan = resolvePlan(baseOptions({ runtimeSpec: "^0.2.0" }), "my-project", "/cwd");
  assert.equal(plan.runtimeSpec, "^0.2.0");
  assert.match(formatPlan(plan), /runtimeSpec: \^0\.2\.0/);
});

test("a valid --runtime-spec (absolute file: spec) passes through unchanged", () => {
  const spec = path.resolve("/tmp/zudo-circuit-doc-0.2.0.tgz");
  const plan = resolvePlan(baseOptions({ runtimeSpec: `file:${spec}` }), "my-project", "/cwd");
  assert.equal(plan.runtimeSpec, `file:${spec}`);
});

test("a relative --runtime-spec file: path is rejected", () => {
  assert.throws(
    () => resolvePlan(baseOptions({ runtimeSpec: "file:../tarballs/runtime.tgz" }), "my-project", "/cwd"),
    (error: unknown) => error instanceof CliUsageError && /absolute/.test((error as Error).message),
  );
});

test("a garbled --runtime-spec is rejected", () => {
  assert.throws(
    () => resolvePlan(baseOptions({ runtimeSpec: "not a spec!!" }), "my-project", "/cwd"),
    CliUsageError,
  );
});
