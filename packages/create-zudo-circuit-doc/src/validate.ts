import { CliUsageError } from "./errors.ts";

const UNSCOPED_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
const SCOPED_NAME_RE = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;

/** Throws a CliUsageError if `name` does not satisfy the npm package-name grammar (spec #3). */
export function validateName(name: string): void {
  if (name.length < 1 || name.length > 214) {
    throw new CliUsageError(
      `Invalid --name "${name}": must be 1-214 characters long.`,
    );
  }
  if (name === "node_modules" || name.includes("node_modules")) {
    throw new CliUsageError(
      `Invalid --name "${name}": must not be or contain "node_modules".`,
    );
  }
  if (!UNSCOPED_NAME_RE.test(name) && !SCOPED_NAME_RE.test(name)) {
    throw new CliUsageError(
      `Invalid --name "${name}": must match the npm package-name grammar (lowercase, optionally scoped).`,
    );
  }
}

// Excluded because the title is substituted verbatim into TS string literals
// and MDX frontmatter — these characters would break that quoting.
const TITLE_FORBIDDEN_RE = /["'`\\$<>{}]/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

/** Throws a CliUsageError if `title` is not 1-80 printable characters excluding quoting-sensitive symbols (spec #3). */
export function validateTitle(title: string): void {
  if (title.length < 1 || title.length > 80) {
    throw new CliUsageError(
      `Invalid --title "${title}": must be 1-80 characters long.`,
    );
  }
  if (CONTROL_CHAR_RE.test(title)) {
    throw new CliUsageError(
      `Invalid --title "${title}": must not contain control characters.`,
    );
  }
  if (TITLE_FORBIDDEN_RE.test(title)) {
    throw new CliUsageError(
      `Invalid --title "${title}": must not contain any of " ' \` \\ $ < > { }.`,
    );
  }
}

const LIBRARY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Throws a CliUsageError if `library` does not match the KiCad library-name grammar (spec #3). */
export function validateLibrary(library: string): void {
  if (!LIBRARY_RE.test(library)) {
    throw new CliUsageError(
      `Invalid --library "${library}": must match ${LIBRARY_RE.source}.`,
    );
  }
}

/** "my-thing" -> "My Thing". Used as the default --title derived from --name. */
export function titleCaseFromName(name: string): string {
  return name
    .split(/[-_]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
