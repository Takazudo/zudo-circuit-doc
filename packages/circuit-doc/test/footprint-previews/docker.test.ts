/**
 * The injectable Docker seam itself (issue #20, spec item 5): `isDockerAvailable`
 * and `isImagePresent` turn any runner failure into `false` rather than
 * propagating it, so the CLI can tell "Docker missing" from "image missing"
 * apart without inspecting error internals.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isDockerAvailable, isImagePresent, pullImage, type DockerRunner } from "../../src/footprint-previews/docker.ts";

function recordingRunner(behavior: (args: readonly string[]) => Promise<{ stdout: string; stderr: string }>): {
  readonly runner: DockerRunner;
  readonly calls: (readonly string[])[];
} {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    runner: async (args) => {
      calls.push(args);
      return behavior(args);
    },
  };
}

describe("Docker availability seam", () => {
  it("isDockerAvailable is false when the runner throws (docker missing)", async () => {
    const { runner } = recordingRunner(async () => {
      throw Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" });
    });
    assert.equal(await isDockerAvailable(runner), false);
  });

  it("isDockerAvailable is true when `docker --version` succeeds", async () => {
    const { runner, calls } = recordingRunner(async () => ({ stdout: "Docker version 27.0.0\n", stderr: "" }));
    assert.equal(await isDockerAvailable(runner), true);
    assert.deepEqual(calls, [["--version"]]);
  });

  it("isImagePresent inspects the pinned digest and is false when absent", async () => {
    const { runner, calls } = recordingRunner(async () => {
      throw new Error("Error: No such image: fixture/kicad@sha256:absent");
    });
    assert.equal(await isImagePresent(runner, "fixture/kicad@sha256:absent"), false);
    assert.deepEqual(calls, [["image", "inspect", "fixture/kicad@sha256:absent"]]);
  });

  it("isImagePresent is true when `docker image inspect` succeeds", async () => {
    const { runner } = recordingRunner(async () => ({ stdout: "[{}]", stderr: "" }));
    assert.equal(await isImagePresent(runner, "fixture/kicad@sha256:present"), true);
  });

  it("pullImage runs `docker pull <image>` and propagates a failure", async () => {
    const { runner, calls } = recordingRunner(async () => ({ stdout: "", stderr: "" }));
    await pullImage(runner, "fixture/kicad@sha256:present");
    assert.deepEqual(calls, [["pull", "fixture/kicad@sha256:present"]]);

    const failing = recordingRunner(async () => {
      throw new Error("pull access denied");
    });
    await assert.rejects(pullImage(failing.runner, "fixture/kicad@sha256:absent"), /pull access denied/u);
  });
});
