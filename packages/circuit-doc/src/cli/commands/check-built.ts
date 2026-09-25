// Stub (#18); replaced wholesale by #19 (built-output reference checker).
import { EXIT } from "../command.ts";
import { stubCommand } from "../stub.ts";

export const command = stubCommand({
  name: "check-built",
  summary: "check the built site's component pages, previews and models against the selection",
  exitCodes: [
    { code: EXIT.PASS, meaning: "built output matches the selection" },
    { code: EXIT.FAILED, meaning: "built output is missing or has unexpected component artifacts" },
    { code: EXIT.USAGE, meaning: "usage/config error, or not implemented yet" },
  ],
  trackedIn: 19,
});
