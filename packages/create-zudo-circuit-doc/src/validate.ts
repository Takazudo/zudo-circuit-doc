import path from "node:path";
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

// eslint-disable-next-line no-control-regex
const RUNTIME_SPEC_CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
// Permissive semver-range grammar (npm dist-tags like "latest"/"next" also
// match): digits, dots, the usual range operators, hyphen ranges and OR.
// This is deliberately not a full semver-range parser — it only rejects
// values that could not possibly be a range or a "file:" spec.
const SEMVER_RANGE_RE = /^[0-9A-Za-z.\-+^~*<>=|\s]+$/;

/**
 * Throws a CliUsageError if `spec` is not usable as the
 * `@takazudo/zudo-circuit-doc` dependency spec (spec #58). Accepts a semver
 * range/dist-tag, or a `file:` spec whose path is absolute. A relative
 * `file:` path is rejected rather than rebased: `doc/package.json` sits one
 * directory deeper than `package.json`, so one relative string cannot be
 * correct in both places without silently pointing `doc/` at the wrong
 * ancestor — pass an absolute path instead.
 */
export function validateRuntimeSpec(spec: string): void {
  // 1024, not 200 like the other options: a "file:" spec carries a full
  // absolute path (e.g. verify-pack's tmpdir tarball path), which can run
  // considerably longer than a semver range on some platforms/CI runners.
  if (spec.length < 1 || spec.length > 1024) {
    throw new CliUsageError(
      `Invalid --runtime-spec "${spec}": must be 1-1024 characters long.`,
    );
  }
  if (RUNTIME_SPEC_CONTROL_CHAR_RE.test(spec)) {
    throw new CliUsageError(
      `Invalid --runtime-spec "${spec}": must not contain control characters.`,
    );
  }
  if (spec.startsWith("file:")) {
    const filePath = spec.slice("file:".length);
    if (filePath.length === 0 || !path.isAbsolute(filePath)) {
      throw new CliUsageError(
        `Invalid --runtime-spec "${spec}": a "file:" spec must use an absolute path (relative "file:" paths are not supported, since doc/package.json sits one directory deeper than package.json).`,
      );
    }
    return;
  }
  if (!SEMVER_RANGE_RE.test(spec)) {
    throw new CliUsageError(
      `Invalid --runtime-spec "${spec}": must be a semver range/dist-tag or a "file:" spec with an absolute path.`,
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
