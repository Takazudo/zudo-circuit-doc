// #59: examples/empty and examples/minimal each ship their own copy of the
// package's frozen component-spec contract at
// .claude/skills/component-spec-audit/references/contract.md, so the
// component-spec-audit skill is self-contained without depending on a
// node_modules install. Nothing enforces those copies stay in sync with the
// package's own copy except this guard — a hand-edit to either would
// silently drift the frozen prose out from under the skill.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(TEST_DIR, "../..");
const SOURCE_PATH = join(PROJECT_ROOT, "packages", "circuit-doc", "contract", "contract.md");
const MIRROR_PATHS = [
  join(PROJECT_ROOT, "examples", "empty", ".claude", "skills", "component-spec-audit", "references", "contract.md"),
  join(PROJECT_ROOT, "examples", "minimal", ".claude", "skills", "component-spec-audit", "references", "contract.md"),
];

test("examples/{empty,minimal}'s contract.md are byte-identical to packages/circuit-doc/contract/contract.md", () => {
  const source = readFileSync(SOURCE_PATH);
  for (const mirrorPath of MIRROR_PATHS) {
    const mirror = readFileSync(mirrorPath);
    assert.ok(
      source.equals(mirror),
      `${mirrorPath} has drifted from ${SOURCE_PATH}; re-copy the package's contract.md into it.`,
    );
  }
});
