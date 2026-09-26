#!/usr/bin/env node
// Checks the authored (non-generated) content of a generated circuit project:
// examples/empty, and the initializer template synced from it.
//
//   node scripts/check-authored-content.mjs <project-dir>
//
// Exit codes: 0 pass, 1 problems found, 2 usage error.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set(["node_modules", "dist", ".zudo-doc", ".circuit-cache", ".git"]);
const TEXT_EXTS = new Set([".md", ".mdx", ".json", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".yaml", ".yml", ".css", ".txt", ".html"]);
const DOCS_ROOT = "doc/src/content/docs";
const TEMPLATE_DOCS_ROOT = "circuit/templates/project-docs";
const WORKFLOW = "circuit/WORKFLOW.md";

const REQUIRED_FILES = [
  WORKFLOW,
  "circuit/agent-task-examples.md",
  "circuit/checks/README.md",
  "circuit/templates/README.md",
  "circuit/templates/cad-asset-receipt.md",
  "circuit/templates/cad-asset-receipt.json",
  ...[
    "project/index.mdx",
    "project/next-actions.mdx",
    "project/task-request.mdx",
    "project/change-impact.mdx",
    "architecture/overview.mdx",
    "architecture/interfaces.mdx",
    "research/component-candidate.mdx",
    "decisions/decision.mdx",
    "decisions/sourcing.mdx",
    "verification/bring-up.mdx",
  ].map((p) => `${TEMPLATE_DOCS_ROOT}/${p}`),
  "README.md",
  ".claude/skills/component-spec-audit/SKILL.md",
  ".claude/skills/component-spec-audit/references/new-component-workflow.md",
  ".claude/skills/circuit-spec-integration/SKILL.md",
  ...[
    "project/index.mdx",
    "project/next-actions.mdx",
    "project/how-we-work.mdx",
    "architecture/index.mdx",
    "architecture/overview.mdx",
    "research/index.mdx",
    "decisions/index.mdx",
    "verification/index.mdx",
  ].map((p) => `${DOCS_ROOT}/${p}`),
];

// Content that must never ship in a fresh project: values from the LED lamp
// project this package was extracted from, the component template's deliberate
// placeholder evidence, deploy domains and workstation paths.
const FORBIDDEN = [
  [/\b15\s?V\b/, "lamp supply value"],
  [/AL8860/i, "lamp LED driver"],
  [/STM32/i, "lamp MCU"],
  [/STUSB/i, "lamp USB-PD controller"],
  [/24-LED/i, "lamp LED count"],
  [/JLCPCB/i, "lamp assembler default"],
  [/zudo-led-lamp/i, "lamp project reference"],
  [/\.pages\.dev\b|\.workers\.dev\b|takazudomodular\.com/i, "deploy domain"],
  [/EXAMPLE-MPN|\bC000000\b|example\.invalid/, "template placeholder evidence"],
  [/\b(?:rec|src|fact|int|line|cov)-example\b/, "template placeholder evidence ID"],
  [/\/home\/[\w.-]+\/|\/Users\/[\w.-]+\/|\/mnt\/[a-z]\/|\b[A-Z]:\\/, "machine-absolute path"],
];

// A number followed by an electrical unit. Authored pages must not state
// electrical values: a fresh project has no evidence for any.
const ELECTRICAL_VALUE = /(?<![\w.])\d+(?:[.,]\d+)?\s?(?:[pnuµm]?[VAF]|[kMG]?Hz|[mkM]?W|[mkM]?Ω|[kM]?ohms?|°C)(?![\w])/;

// The epic's generated-project contract: runtime CLI commands and root scripts.
const CLI_COMMANDS = new Set([
  "generate", "check", "validate", "models", "footprints", "scan", "check-built",
  "check-browser", "doctor", "new-component", "--version", "--help", "--config",
]);
const FOOTPRINT_SUBCOMMANDS = new Set(["generate", "check"]);
const PNPM_COMMANDS = new Set([
  "install", "exec", "dev", "build", "check", "check:site", "circuit:check",
  "circuit:generate", "circuit:doctor", "previews:generate",
]);

// A fenced code block, possibly indented inside a list item.
const FENCE = /^[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm;

const WORKFLOW_SECTIONS = ["A", "B", "C", "D", "E", "F", "G"];

function usage(message) {
  console.error(`usage: node scripts/check-authored-content.mjs <project-dir>\n${message}`);
  process.exit(2);
}

const projectArg = process.argv[2];
if (!projectArg || process.argv.length > 3) usage("expected exactly one project directory");
const root = path.resolve(projectArg);
if (!existsSync(root) || !statSync(root).isDirectory()) usage(`not a directory: ${projectArg}`);

const problems = [];
const report = (rel, line, message) => problems.push(`${rel}${line ? `:${line}` : ""}: ${message}`);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && TEXT_EXTS.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const toRel = (abs) => path.relative(root, abs).split(path.sep).join("/");
const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const isUnder = (rel, dir) => rel === dir || rel.startsWith(`${dir}/`);

function splitFrontmatter(text) {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return null;
  return { raw: text.slice(4, end), bodyStart: end + 5 };
}

function parseFrontmatter(raw) {
  const fields = {};
  for (const line of raw.split("\n")) {
    if (line.trimStart().startsWith("#") || !line.includes(":")) continue;
    const [key, ...rest] = line.split(":");
    let value = rest.join(":").trim();
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    fields[key.trim()] = value;
  }
  return fields;
}

const isGenerated = (text) => {
  const fm = splitFrontmatter(text);
  return fm !== null && /^#\s*GENERATED\b/m.test(fm.raw);
};

// Replace code (fenced blocks, inline code, and optionally frontmatter) with
// spaces, keeping newlines so reported line numbers stay correct.
function maskCode(text, { frontmatter = false } = {}) {
  const blank = (s) => s.replace(/[^\n]/g, " ");
  let out = text;
  if (frontmatter) {
    const fm = splitFrontmatter(out);
    if (fm) out = blank(out.slice(0, fm.bodyStart)) + out.slice(fm.bodyStart);
  }
  out = out.replace(FENCE, blank);
  out = out.replace(/`[^`\n]*`/g, blank);
  return out;
}

function codeSegments(text) {
  const segments = [];
  for (const m of text.matchAll(FENCE)) {
    segments.push({ code: m[2], index: m.index });
  }
  const withoutFences = text.replace(FENCE, (s) => s.replace(/[^\n]/g, " "));
  for (const m of withoutFences.matchAll(/`([^`\n]+)`/g)) segments.push({ code: m[1], index: m.index });
  return segments;
}

// --- required files -------------------------------------------------------
for (const rel of REQUIRED_FILES) {
  if (!existsSync(path.join(root, rel))) report(rel, 0, "required authored file is missing");
}

// Authored content is what git would track: skip gitignored build output a local
// build leaves behind (doc/.zfb-build/, zudo-doc's claude* mirror). Outside a git
// work tree (scratch copies) no filter applies.
const gitVisible = (() => {
  try {
    const out = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return new Set(out.split("\0").filter(Boolean));
  } catch {
    return null;
  }
})();

const files = walk(root).filter((abs) => !gitVisible || gitVisible.has(toRel(abs))).map((abs) => ({ abs, rel: toRel(abs), text: readFileSync(abs, "utf8") }));

// Authored agent-facing content: root docs, circuit/, .claude/ and the
// non-generated doc pages. The upstream doc host scaffold is not ours to check.
const isAuthoredScope = (f) =>
  (!f.rel.includes("/") && /\.mdx?$/.test(f.rel)) ||
  isUnder(f.rel, "circuit") ||
  isUnder(f.rel, ".claude") ||
  isUnder(f.rel, DOCS_ROOT);
const isOwnerBundle = (rel) => /^\.claude\/skills\/component-(?!spec-audit\/)/.test(rel);

// --- forbidden strings (whole tree) ----------------------------------------
for (const f of files) {
  f.text.split("\n").forEach((line, i) => {
    for (const [re, why] of FORBIDDEN) {
      if (re.test(line)) report(f.rel, i + 1, `forbidden content (${why}): ${line.trim().slice(0, 120)}`);
    }
  });
}

// --- MDX frontmatter ---------------------------------------------------------
for (const f of files) {
  if (!f.rel.endsWith(".mdx")) continue;
  if (!isUnder(f.rel, DOCS_ROOT) && !isUnder(f.rel, TEMPLATE_DOCS_ROOT)) continue;
  const fm = splitFrontmatter(f.text);
  if (!fm) {
    report(f.rel, 1, "missing or unterminated frontmatter");
    continue;
  }
  const fields = parseFrontmatter(fm.raw);
  for (const key of ["title", "description"]) {
    if (!fields[key]) report(f.rel, 1, `frontmatter \`${key}\` is missing or empty`);
  }
  if (!/^-?\d+$/.test(fields.sidebar_position ?? "")) {
    report(f.rel, 1, "frontmatter `sidebar_position` must be an integer");
  }
}

// --- authored markdown: links, MDX safety, electrical values, CLI names --------
for (const f of files) {
  if (!/\.mdx?$/.test(f.rel) || !isAuthoredScope(f) || isGenerated(f.text)) continue;
  const isMdx = f.rel.endsWith(".mdx");
  const masked = maskCode(f.text, { frontmatter: isMdx });
  const inDocs = isUnder(f.rel, DOCS_ROOT);

  for (const m of masked.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1];
    const line = lineOf(masked, m.index);
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#") || target.startsWith("/")) continue;
    const filePart = decodeURIComponent(target.split("#")[0].split("?")[0]);
    const resolved = path.resolve(path.dirname(f.abs), filePart);
    const resolvedRel = toRel(resolved);
    // Installed-package paths exist only after `pnpm install`.
    if (resolvedRel.split("/").includes("node_modules")) continue;
    if (resolvedRel.startsWith("..")) {
      report(f.rel, line, `link leaves the project: ${target}`);
      continue;
    }
    if (!existsSync(resolved)) report(f.rel, line, `broken relative link: ${target}`);
    if (inDocs) {
      if (!isUnder(resolvedRel, DOCS_ROOT)) {
        report(f.rel, line, `doc page links outside the doc site (use a code span for repository paths): ${target}`);
      } else if (!/\.(mdx?|png|jpe?g|svg|gif|webp)$/i.test(filePart)) {
        report(f.rel, line, `zudo-doc resolves relative page links only with a .md/.mdx extension: ${target}`);
      }
    }
  }

  if (isMdx) {
    for (const m of masked.matchAll(/[<{}]/g)) {
      report(f.rel, lineOf(masked, m.index), `raw \`${m[0]}\` outside code is parsed as MDX syntax`);
    }
  }

  if (!isOwnerBundle(f.rel)) {
    f.text.split("\n").forEach((line, i) => {
      const hit = line.match(ELECTRICAL_VALUE);
      if (hit) report(f.rel, i + 1, `electrical value in authored content: "${hit[0]}"`);
    });
  }

  for (const seg of codeSegments(f.text)) {
    const line = lineOf(f.text, seg.index);
    for (const m of seg.code.matchAll(/(?<![\w@/.-])zudo-circuit-doc\s+(--?[\w-]+|[a-z][\w-]*)(?:\s+([a-z][\w-]*))?/g)) {
      if (!CLI_COMMANDS.has(m[1])) report(f.rel, line, `unknown zudo-circuit-doc command: ${m[1]}`);
      if (m[1] === "footprints" && !FOOTPRINT_SUBCOMMANDS.has(m[2] ?? "")) {
        report(f.rel, line, `zudo-circuit-doc footprints needs generate or check, got: ${m[2] ?? "(none)"}`);
      }
    }
    for (const m of seg.code.matchAll(/(?<![\w-])pnpm\s+(?:run\s+)?([\w:.-]+)(?:\s+([\w@/.-]+))?/g)) {
      if (!PNPM_COMMANDS.has(m[1])) report(f.rel, line, `unknown project command: pnpm ${m[1]}`);
      if (m[1] === "exec" && m[2] !== "zudo-circuit-doc") report(f.rel, line, `unexpected pnpm exec target: ${m[2] ?? "(none)"}`);
    }
  }
}

// --- JSON files in the authored scope parse --------------------------------------
for (const f of files) {
  if (!f.rel.endsWith(".json") || !isAuthoredScope(f)) continue;
  try {
    JSON.parse(f.text);
  } catch (error) {
    report(f.rel, 0, `invalid JSON: ${error.message}`);
  }
}

// --- WORKFLOW.md sections A–G, each with a Done criterion ---------------------
const workflowPath = path.join(root, WORKFLOW);
if (existsSync(workflowPath)) {
  const text = readFileSync(workflowPath, "utf8");
  const headings = [...text.matchAll(/^## Workflow ([A-Z])\b.*$/gm)];
  const letters = headings.map((m) => m[1]);
  if (letters.join("") !== WORKFLOW_SECTIONS.join("")) {
    report(WORKFLOW, 0, `expected sections Workflow ${WORKFLOW_SECTIONS.join(", ")} in order; found ${letters.join(", ") || "none"}`);
  }
  headings.forEach((m, i) => {
    const next = text.slice(m.index + m[0].length).search(/^## /m);
    const body = next === -1 ? text.slice(m.index) : text.slice(m.index, m.index + m[0].length + next);
    if (!/^\*\*Done:\*\*/m.test(body)) report(WORKFLOW, lineOf(text, m.index), `Workflow ${m[1]} has no "**Done:**" criterion`);
  });
}

// --- thin entry files ----------------------------------------------------------
const entries = ["CLAUDE.md", "AGENTS.md"].filter((name) => existsSync(path.join(root, name)));
if (entries.length === 0) report("CLAUDE.md", 0, "no agent entry file (CLAUDE.md or AGENTS.md)");
for (const name of entries) {
  const text = readFileSync(path.join(root, name), "utf8");
  if (!text.includes("circuit/WORKFLOW.md")) report(name, 0, "entry file must point to circuit/WORKFLOW.md");
  if (!text.includes("pnpm circuit:check")) report(name, 0, "entry file must name pnpm circuit:check");
  if (text.split("\n").length > 30) report(name, 0, "entry file must stay thin; the workflow belongs in circuit/WORKFLOW.md");
}

// --- skill frontmatter (the v1 validator's frontmatter() rules) -------------------
const skillsDir = path.join(root, ".claude/skills");
if (existsSync(skillsDir)) {
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rel = `.claude/skills/${entry.name}/SKILL.md`;
    const skillPath = path.join(root, rel);
    if (!existsSync(skillPath)) {
      report(rel, 0, "skill directory has no SKILL.md");
      continue;
    }
    const text = readFileSync(skillPath, "utf8");
    const fm = splitFrontmatter(text);
    if (!fm) {
      report(rel, 1, "missing or unterminated frontmatter");
      continue;
    }
    const fields = {};
    for (const line of fm.raw.split("\n")) {
      if (!line.includes(":")) continue;
      const [key, ...rest] = line.split(":");
      fields[key.trim()] = rest.join(":").trim();
    }
    if (fields.name !== entry.name) report(rel, 1, `name must equal directory ${entry.name}`);
    const description = fields.description ?? "";
    if (description.length < 80 || !description.toLowerCase().includes("use")) {
      report(rel, 1, "description must be at least 80 characters and contain \"use\"");
    }
    if ("triggers" in fields) report(rel, 1, "undocumented triggers key");
    if (fields["disable-model-invocation"] === "true") report(rel, 1, "model invocation disabled");
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.log(`FAIL: ${problem}`);
  console.log(`FAIL: authored content; ${problems.length} problem(s) in ${toRel(root) || "."}`);
  process.exit(1);
}
console.log(`PASS: authored content; ${files.length} files checked in ${path.relative(process.cwd(), root) || "."}`);
