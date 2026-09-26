// Two exit-code families the CLI distinguishes throughout: usage/config
// mistakes the caller can fix by rereading --help (exit 2), and everything
// else that failed after the input was understood (exit 1).

export class CliUsageError extends Error {}

export class CliError extends Error {}
