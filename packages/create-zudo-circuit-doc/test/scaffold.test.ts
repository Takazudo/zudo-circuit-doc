import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { CliError } from "../src/errors.ts";
import { checkDestinationCollision, composeProject } from "../src/scaffold.ts";
import { TEMPLATE_DIR, makePlan, mkdtemp } from "./support/fixtures.ts";
import { hashTree } from "./support/hash-tree.ts";

test("composeProject copies the template and substitutes every placeholder, with none remaining", () => {
  const parent = mkdtemp();
  const destinationPath = path.join(parent, "acme-widget");
  const plan = makePlan({
    destinationPath,
    name: "acme-widget",
    title: "Acme Widget",
    library: "acme_lib",
  });

  composeProject({ plan, templateDir: TEMPLATE_DIR, randomSuffix: () => "abc123" });

  assert.ok(fs.existsSync(destinationPath));
  const pkg = JSON.parse(fs.readFileSync(path.join(destinationPath, "package.json"), "utf8"));
  assert.equal(pkg.name, "acme-widget");

  const config = fs.readFileSync(path.join(destinationPath, "circuit.config.ts"), "utf8");
  assert.match(config, /name: "acme-widget"/);
  assert.match(config, /title: "Acme Widget"/);
  assert.match(config, /libraryName: "acme_lib"/);

  const readme = fs.readFileSync(path.join(destinationPath, "README.md"), "utf8");
  assert.doesNotMatch(readme, /__PROJECT_NAME__|__SITE_TITLE__|__LIBRARY_NAME__/);
  assert.doesNotMatch(readme, /not\s+yet published/i);

  // No leftover staging directory next to the destination.
  const siblingEntries = fs.readdirSync(parent);
  assert.deepEqual(
    siblingEntries.filter((name) => name.startsWith(".create-zudo-circuit-doc-staging-")),
    [],
  );
});

test("_gitignore is renamed to .gitignore", () => {
  const destinationPath = path.join(mkdtemp(), "proj");
  composeProject({ plan: makePlan({ destinationPath }), templateDir: TEMPLATE_DIR, randomSuffix: () => "s1" });
  assert.ok(fs.existsSync(path.join(destinationPath, ".gitignore")));
  assert.ok(!fs.existsSync(path.join(destinationPath, "_gitignore")));
});

test("binary files are copied byte-for-byte and skipped from substitution/assertion", () => {
  const destinationPath = path.join(mkdtemp(), "proj");
  composeProject({ plan: makePlan({ destinationPath }), templateDir: TEMPLATE_DIR, randomSuffix: () => "s2" });
  const original = fs.readFileSync(path.join(TEMPLATE_DIR, "assets", "logo.png"));
  const copied = fs.readFileSync(path.join(destinationPath, "assets", "logo.png"));
  assert.deepEqual(copied, original);
});

test("file modes are preserved", () => {
  const destinationPath = path.join(mkdtemp(), "proj");
  composeProject({ plan: makePlan({ destinationPath }), templateDir: TEMPLATE_DIR, randomSuffix: () => "s3" });
  const sourceMode = fs.statSync(path.join(TEMPLATE_DIR, "README.md")).mode;
  const targetMode = fs.statSync(path.join(destinationPath, "README.md")).mode;
  assert.equal(targetMode, sourceMode);
});

test("--agent matrix: claude removes AGENTS.md, codex removes CLAUDE.md, none removes both, both keeps both; .claude/skills always stays", () => {
  const cases: Array<{ agent: "claude" | "codex" | "both" | "none"; keepsClaudeMd: boolean; keepsAgentsMd: boolean }> = [
    { agent: "claude", keepsClaudeMd: true, keepsAgentsMd: false },
    { agent: "codex", keepsClaudeMd: false, keepsAgentsMd: true },
    { agent: "both", keepsClaudeMd: true, keepsAgentsMd: true },
    { agent: "none", keepsClaudeMd: false, keepsAgentsMd: false },
  ];

  let i = 0;
  for (const testCase of cases) {
    i += 1;
    const destinationPath = path.join(mkdtemp(), "proj");
    composeProject({
      plan: makePlan({ destinationPath, agent: testCase.agent }),
      templateDir: TEMPLATE_DIR,
      randomSuffix: () => `agent-${i}`,
    });
    assert.equal(fs.existsSync(path.join(destinationPath, "CLAUDE.md")), testCase.keepsClaudeMd, testCase.agent);
    assert.equal(fs.existsSync(path.join(destinationPath, "AGENTS.md")), testCase.keepsAgentsMd, testCase.agent);
    assert.ok(
      fs.existsSync(path.join(destinationPath, ".claude/skills/component-spec-audit/SKILL.md")),
      `.claude/skills must always stay for --agent ${testCase.agent}`,
    );
  }
});

test("checkDestinationCollision is a no-op when the destination is missing or an empty directory", () => {
  const parent = mkdtemp();
  assert.doesNotThrow(() => checkDestinationCollision(path.join(parent, "missing")));
  const emptyDir = path.join(parent, "empty");
  fs.mkdirSync(emptyDir);
  assert.doesNotThrow(() => checkDestinationCollision(emptyDir));
});

test("composeProject succeeds when the destination already exists as an empty directory", () => {
  const parent = mkdtemp();
  const destinationPath = path.join(parent, "proj");
  fs.mkdirSync(destinationPath);
  composeProject({ plan: makePlan({ destinationPath }), templateDir: TEMPLATE_DIR, randomSuffix: () => "empty-dest" });
  assert.ok(fs.existsSync(path.join(destinationPath, "package.json")));
});

test("collision: a non-empty destination is rejected with exit-1-worthy CliError and the tree is left byte-for-byte unchanged", () => {
  const parent = mkdtemp();
  const destinationPath = path.join(parent, "taken");
  fs.mkdirSync(destinationPath);
  fs.writeFileSync(path.join(destinationPath, "keep.txt"), "do not touch me");
  fs.mkdirSync(path.join(destinationPath, "nested"));
  fs.writeFileSync(path.join(destinationPath, "nested", "file.txt"), "nested content");

  const before = hashTree(destinationPath);
  assert.throws(() => checkDestinationCollision(destinationPath), CliError);
  const after = hashTree(destinationPath);
  assert.equal(after, before);
});

test("--runtime-spec overwrites the runtime dependency in both package.json and doc/package.json", () => {
  const destinationPath = path.join(mkdtemp(), "proj");
  composeProject({
    plan: makePlan({ destinationPath, runtimeSpec: "file:/abs/path/zudo-circuit-doc-0.2.0.tgz" }),
    templateDir: TEMPLATE_DIR,
    randomSuffix: () => "runtime-spec-1",
  });
  const pkg = JSON.parse(fs.readFileSync(path.join(destinationPath, "package.json"), "utf8"));
  assert.equal(pkg.devDependencies["@takazudo/zudo-circuit-doc"], "file:/abs/path/zudo-circuit-doc-0.2.0.tgz");
  const docPkg = JSON.parse(fs.readFileSync(path.join(destinationPath, "doc", "package.json"), "utf8"));
  assert.equal(docPkg.dependencies["@takazudo/zudo-circuit-doc"], "file:/abs/path/zudo-circuit-doc-0.2.0.tgz");
});

test("no --runtime-spec leaves the template's own dependency spec untouched", () => {
  const destinationPath = path.join(mkdtemp(), "proj");
  composeProject({ plan: makePlan({ destinationPath }), templateDir: TEMPLATE_DIR, randomSuffix: () => "runtime-spec-2" });
  const pkg = JSON.parse(fs.readFileSync(path.join(destinationPath, "package.json"), "utf8"));
  assert.equal(pkg.devDependencies["@takazudo/zudo-circuit-doc"], "^0.1.0");
});

test("a staging failure injected mid-copy leaves no destination and no leftover staging directory", () => {
  const parent = mkdtemp();
  const destinationPath = path.join(parent, "proj");

  assert.throws(
    () =>
      composeProject({
        plan: makePlan({ destinationPath }),
        templateDir: TEMPLATE_DIR,
        randomSuffix: () => "fail-1",
        beforeCopyFile: (relPath) => {
          if (relPath === "circuit.config.ts") {
            throw new Error("simulated mid-copy failure");
          }
        },
      }),
    CliError,
  );

  assert.ok(!fs.existsSync(destinationPath));
  const siblingEntries = fs.readdirSync(parent);
  assert.deepEqual(
    siblingEntries.filter((name) => name.startsWith(".create-zudo-circuit-doc-staging-")),
    [],
  );
});
