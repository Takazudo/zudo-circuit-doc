import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentChoice } from "../../src/args.ts";
import type { Plan } from "../../src/plan.ts";

export const TEMPLATE_DIR = fileURLToPath(new URL("../fixtures/template/", import.meta.url));

export function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    destinationPath: path.join(mkdtemp(), "my-project"),
    name: "my-project",
    title: "My Project",
    library: "my-project",
    agent: "both" as AgentChoice,
    install: true,
    git: true,
    ...overrides,
  };
}

/** A fresh, empty temp directory this test owns; removed by the OS temp cleanup, not by us, to keep failures inspectable. */
export function mkdtemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "czcd-test-"));
}
