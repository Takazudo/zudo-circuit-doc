const SAFE_UNQUOTED_RE = /^[A-Za-z0-9_.\-/]+$/;

/** Quotes `value` for a POSIX shell only when it contains characters that would need it. */
export function shellQuote(value: string): string {
  if (SAFE_UNQUOTED_RE.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
