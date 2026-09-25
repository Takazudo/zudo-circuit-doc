// Stub (#18); replaced wholesale by #27 (browser smoke over system Chrome).
import { EXIT } from "../command.ts";
import { stubCommand } from "../stub.ts";

export const command = stubCommand({
  name: "check-browser",
  summary: "browser smoke of the built site in system Chrome (islands, viewers, no-JS fallback)",
  flags: [
    { name: "--dist", kind: "value", valueName: "<dir>", description: "built site directory (default: docs.dist)" },
    {
      name: "--representatives",
      kind: "value",
      valueName: "<json>",
      description: "representative pages (default: config browserSmoke.representatives)",
    },
    { name: "--chrome", kind: "value", valueName: "<bin>", description: "Chrome binary (default: $CHROME_BIN)" },
    { name: "--shell-assertions", description: "also assert the zudo-doc shell DOM" },
    { name: "--search-assertions", description: "also assert search and llms output" },
  ],
  exitCodes: [
    { code: EXIT.PASS, meaning: "every browser check passed" },
    { code: EXIT.FAILED, meaning: "a browser check failed" },
    { code: EXIT.USAGE, meaning: "usage/config error, or not implemented yet" },
    { code: EXIT.NOT_RUN, meaning: "not run: Chrome not found (set CHROME_BIN)" },
  ],
  trackedIn: 27,
});
