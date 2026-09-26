import { spawn } from "node:child_process";
import { CliError } from "./errors.ts";

export type InstallRunner = (cwd: string) => Promise<void>;

/** Runs `pnpm install` in `cwd` with stdio inherited (spec #7). */
export const defaultRunInstall: InstallRunner = (cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["install"], { cwd, stdio: "inherit" });
    child.on("error", (error) => {
      reject(new CliError(`Failed to run "pnpm install": ${error.message}`));
    });
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new CliError(
            `"pnpm install" exited with ${signal ? `signal ${signal}` : `code ${code}`}.`,
          ),
        );
      }
    });
  });
