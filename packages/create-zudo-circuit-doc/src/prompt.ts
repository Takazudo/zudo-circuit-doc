import readline from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

/** Prompts on a TTY for the destination directory (spec #2). */
export async function promptForDestination(
  input: Readable,
  output: Writable,
): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question("Project directory: ");
    return answer.trim();
  } finally {
    rl.close();
  }
}
