// Stub (#18); replaced wholesale by #19 (scanner policy / artifact scan).
import { EXIT } from "../command.ts";
import { stubCommand } from "../stub.ts";

export const command = stubCommand({
  name: "scan",
  summary: "scan the built site for published evidence that should have been withheld",
  flags: [
    {
      name: "--agent-skill",
      kind: "value",
      valueName: "<dir>",
      description: "also scan this agent-skill mirror directory",
    },
  ],
  exitCodes: [
    { code: EXIT.PASS, meaning: "no leak found" },
    { code: EXIT.FAILED, meaning: "a withheld value or credential pattern reached the built output" },
    { code: EXIT.USAGE, meaning: "usage/config error, or not implemented yet" },
  ],
  trackedIn: 19,
});
