export const USAGE_LINE =
  "Usage: create-zudo-circuit-doc [destination] [--name <npm-name>] [--title <site title>] [--library <kicad-lib-name>] [--agent claude|codex|both|none] [--yes] [--install|--no-install] [--git|--no-git] [--help] [--version]";

export const HELP_TEXT = [
  USAGE_LINE,
  "",
  "Also works as: pnpm create zudo-circuit-doc <destination>",
  "",
  "Options:",
  "  --name <npm-name>        Package name (default: the destination's basename)",
  "  --title <site title>     Site title (default: title-cased --name)",
  "  --library <lib-name>     KiCad library name (default: --name)",
  "  --agent <choice>         claude | codex | both | none (default: both)",
  "  --yes, -y                Do not prompt; a missing destination is an error",
  "  --install / --no-install Run `pnpm install` after scaffolding (default: on)",
  "  --git / --no-git         Run `git init` + initial commit (default: on)",
  "  --help, -h               Print this help and exit",
  "  --version, -v            Print the package version and exit",
].join("\n");
