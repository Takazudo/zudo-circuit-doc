import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createGitRunner } from "../src/git.ts";
import { mkdtemp } from "./support/fixtures.ts";

/** An env with no git identity reachable: an isolated HOME, no system config, no author/committer env vars. */
function noIdentityEnv(homeDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: homeDir, GIT_CONFIG_NOSYSTEM: "1" };
  delete env.GIT_CONFIG_GLOBAL;
  delete env.GIT_AUTHOR_NAME;
  delete env.GIT_AUTHOR_EMAIL;
  delete env.GIT_COMMITTER_NAME;
  delete env.GIT_COMMITTER_EMAIL;
  return env;
}

/** An env with a global gitconfig carrying a real identity. */
function withIdentityEnv(homeDir: string, globalConfigPath: string): NodeJS.ProcessEnv {
  return { ...noIdentityEnv(homeDir), GIT_CONFIG_GLOBAL: globalConfigPath };
}

test("git-identity fallback: no configured identity -> neutral committer, note printed, commit still created", async () => {
  const home = mkdtemp();
  const destinationPath = path.join(mkdtemp(), "proj");
  fs.mkdirSync(destinationPath);
  fs.writeFileSync(path.join(destinationPath, "file.txt"), "hello");

  const env = noIdentityEnv(home);
  const runGit = createGitRunner(env);
  const outcome = await runGit(destinationPath);

  assert.equal(outcome.ran, true);
  assert.match(outcome.note ?? "", /neutral committer identity/);

  const author = execFileSync("git", ["log", "-1", "--format=%an <%ae>"], {
    cwd: destinationPath,
    env,
  })
    .toString()
    .trim();
  assert.equal(author, "create-zudo-circuit-doc <create-zudo-circuit-doc@localhost>");
});

test("a configured git identity is used as-is, with no note", async () => {
  const home = mkdtemp();
  const globalConfigPath = path.join(home, "gitconfig");
  fs.writeFileSync(globalConfigPath, "[user]\n\tname = Test User\n\temail = test@example.com\n");
  const destinationPath = path.join(mkdtemp(), "proj");
  fs.mkdirSync(destinationPath);
  fs.writeFileSync(path.join(destinationPath, "file.txt"), "hello");

  const env = withIdentityEnv(home, globalConfigPath);
  const runGit = createGitRunner(env);
  const outcome = await runGit(destinationPath);

  assert.equal(outcome.ran, true);
  assert.equal(outcome.note, undefined);

  const author = execFileSync("git", ["log", "-1", "--format=%an <%ae>"], {
    cwd: destinationPath,
    env,
  })
    .toString()
    .trim();
  assert.equal(author, "Test User <test@example.com>");
});

test("skips git init with a note when the destination is already inside a git work tree", async () => {
  const home = mkdtemp();
  const repoRoot = mkdtemp();
  const env = noIdentityEnv(home);
  execFileSync("git", ["init", "-b", "main"], { cwd: repoRoot, env, stdio: "ignore" });

  const destinationPath = path.join(repoRoot, "nested-project");
  fs.mkdirSync(destinationPath);

  const runGit = createGitRunner(env);
  const outcome = await runGit(destinationPath);

  assert.equal(outcome.ran, false);
  assert.match(outcome.note ?? "", /already inside a git work tree/);
  assert.ok(!fs.existsSync(path.join(destinationPath, ".git")));
});
