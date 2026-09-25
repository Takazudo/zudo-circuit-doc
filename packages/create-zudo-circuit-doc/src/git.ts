import { execFileSync } from "node:child_process";

export interface GitOutcome {
  ran: boolean;
  note?: string;
}

export type GitRunner = (cwd: string) => Promise<GitOutcome>;

const COMMIT_MESSAGE = "Initial commit from create-zudo-circuit-doc";

function isInsideExistingWorkTree(cwd: string, env: NodeJS.ProcessEnv): boolean {
  try {
    const out = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return out === "true";
  } catch {
    return false;
  }
}

function hasGitIdentity(cwd: string, env: NodeJS.ProcessEnv): boolean {
  try {
    const name = execFileSync("git", ["config", "user.name"], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    const email = execFileSync("git", ["config", "user.email"], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return name.length > 0 && email.length > 0;
  } catch {
    return false;
  }
}

/**
 * Builds the default GitRunner. `env` is injectable so tests can isolate git
 * identity discovery (HOME, GIT_CONFIG_*) without mutating process.env.
 */
export function createGitRunner(env: NodeJS.ProcessEnv = process.env): GitRunner {
  return async (cwd: string): Promise<GitOutcome> => {
    if (isInsideExistingWorkTree(cwd, env)) {
      return {
        ran: false,
        note: "Skipped git init: the destination is already inside a git work tree.",
      };
    }

    execFileSync("git", ["init", "-b", "main"], { cwd, env, stdio: "ignore" });

    let note: string | undefined;
    const identityArgs: string[] = [];
    if (!hasGitIdentity(cwd, env)) {
      identityArgs.push(
        "-c",
        "user.name=create-zudo-circuit-doc",
        "-c",
        "user.email=create-zudo-circuit-doc@localhost",
      );
      note =
        "No git identity was configured; used a neutral committer identity for the initial commit.";
    }

    execFileSync("git", ["add", "-A"], { cwd, env, stdio: "ignore" });
    execFileSync("git", [...identityArgs, "commit", "-m", COMMIT_MESSAGE], {
      cwd,
      env,
      stdio: "ignore",
    });

    return { ran: true, note };
  };
}

export const defaultRunGit: GitRunner = createGitRunner();
