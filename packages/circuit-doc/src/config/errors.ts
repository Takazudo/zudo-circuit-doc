export type ConfigErrorCode =
  | "CONFIG_INVALID"
  | "CONFIG_NOT_FOUND"
  | "CONFIG_LOAD_FAILED"
  | "NODE_VERSION_UNSUPPORTED";

export type ConfigIssue = {
  /** Dotted field path, e.g. `cad.previewRenderer.layers[0]`; `""` for the config root. */
  readonly path: string;
  readonly message: string;
};

/** Every config failure; the CLI maps it to exit 2. */
export class ConfigError extends Error {
  readonly code: ConfigErrorCode;
  readonly errors: readonly ConfigIssue[];
  readonly configPath: string | undefined;
  readonly hint: string | undefined;

  constructor(
    code: ConfigErrorCode,
    errors: readonly ConfigIssue[],
    options: { configPath?: string; hint?: string; cause?: unknown } = {},
  ) {
    super(formatConfigErrorMessage(code, errors, options.configPath, options.hint), { cause: options.cause });
    this.name = "ConfigError";
    this.code = code;
    this.errors = errors;
    this.configPath = options.configPath;
    this.hint = options.hint;
  }
}

function formatConfigErrorMessage(
  code: ConfigErrorCode,
  errors: readonly ConfigIssue[],
  configPath: string | undefined,
  hint: string | undefined,
): string {
  const where = configPath === undefined ? "" : ` (${configPath})`;
  const lines = [`[${code}] circuit config${where}: ${errors.length} error(s)`];
  for (const issue of errors) lines.push(`  - ${issue.path === "" ? "<root>" : issue.path}: ${issue.message}`);
  if (hint !== undefined) lines.push(`hint: ${hint}`);
  return lines.join("\n");
}
