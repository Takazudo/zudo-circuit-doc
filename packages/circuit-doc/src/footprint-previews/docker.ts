/**
 * The Docker runner seam (issue #20, spec item 5): injectable so tests exercise
 * `generateFootprintPreviews` with a fake, and the real implementation is the
 * only thing that ever spawns `docker`.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type DockerRunResult = { readonly stdout: string; readonly stderr: string };

export type DockerRunner = (args: readonly string[]) => Promise<DockerRunResult>;

export async function realDockerRunner(args: readonly string[]): Promise<DockerRunResult> {
  const { stdout, stderr } = await execFileAsync("docker", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return { stdout, stderr };
}

/** `docker` itself missing (or otherwise unrunnable) from the host. */
export async function isDockerAvailable(runDocker: DockerRunner): Promise<boolean> {
  try {
    await runDocker(["--version"]);
    return true;
  } catch {
    return false;
  }
}

/** `docker image inspect <digest>`: present locally already. */
export async function isImagePresent(runDocker: DockerRunner, image: string): Promise<boolean> {
  try {
    await runDocker(["image", "inspect", image]);
    return true;
  } catch {
    return false;
  }
}

export async function pullImage(runDocker: DockerRunner, image: string): Promise<void> {
  await runDocker(["pull", image]);
}
