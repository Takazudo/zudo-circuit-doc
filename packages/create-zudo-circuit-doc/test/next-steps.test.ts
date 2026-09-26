import assert from "node:assert/strict";
import test from "node:test";
import { formatNextSteps } from "../src/next-steps.ts";

test("the next-steps block is exact when install already ran", () => {
  const text = formatNextSteps({ displayDestination: "my-project", installRan: true });
  assert.equal(
    text,
    [
      "Next steps:",
      "",
      "  cd my-project",
      "  pnpm circuit:doctor",
      "  pnpm dev",
      "",
      "Open circuit/WORKFLOW.md → Workflow A",
    ].join("\n"),
  );
});

test("the next-steps block includes `pnpm install` when install was skipped", () => {
  const text = formatNextSteps({ displayDestination: "my-project", installRan: false });
  assert.equal(
    text,
    [
      "Next steps:",
      "",
      "  cd my-project",
      "  pnpm install",
      "  pnpm circuit:doctor",
      "  pnpm dev",
      "",
      "Open circuit/WORKFLOW.md → Workflow A",
    ].join("\n"),
  );
});

test("a destination with spaces is shell-quoted", () => {
  const text = formatNextSteps({ displayDestination: "my project", installRan: true });
  assert.match(text, /cd 'my project'/);
});

test("no literal fences appear anywhere in the block", () => {
  const text = formatNextSteps({ displayDestination: "my-project", installRan: false });
  assert.doesNotMatch(text, /```/);
});

test("a --runtime-spec is mentioned only when install did not run", () => {
  const notRan = formatNextSteps({
    displayDestination: "my-project",
    installRan: false,
    runtimeSpec: "file:/abs/path/runtime.tgz",
  });
  assert.match(notRan, /Applied --runtime-spec "file:\/abs\/path\/runtime\.tgz" to package\.json and doc\/package\.json\./);

  const ran = formatNextSteps({
    displayDestination: "my-project",
    installRan: true,
    runtimeSpec: "file:/abs/path/runtime.tgz",
  });
  assert.doesNotMatch(ran, /Applied --runtime-spec/);
});
