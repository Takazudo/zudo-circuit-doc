/**
 * End-to-end CLI acceptance on temp projects: canonical `circuit.config.ts`
 * (`import type` + `satisfies`) and the real packaged Python validator.
 */

import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, before, describe, it } from "node:test";

import { EXIT } from "../../src/cli/command.ts";
import { GENERATED_MARKER } from "../../src/core/page.ts";
import { VIEW_MODEL_VERSION } from "../../src/core/view-model.ts";
import {
  EMPTY_SELECTION,
  GENERATED,
  INVENTORY,
  PREFLIGHT,
  SELECTION,
  configSource,
  runCli,
  writeEmptyProject,
  writeJson,
} from "./project-fixture.ts";

// ADR-020 notice wording (not exported by render/shared.ts).
const GENERATED_NOTICE_TEXT = "Generated from the component evidence records — edit the records, not this page.";

let scratch = "";
let counter = 0;

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "zcd-cli-"));
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function project(): Promise<string> {
  counter += 1;
  return writeEmptyProject(join(scratch, `p${counter}`));
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split("\\").join("/"))
    .sort();
}

describe("generate / check on an empty project", () => {
  it("generates exactly the zero-state pages, each with the marker and the generated notice", async () => {
    const root = await project();
    const run = await runCli(root, ["generate"]);
    assert.equal(run.code, EXIT.PASS, run.stderr);
    assert.deepEqual(await listFiles(join(root, GENERATED)), [
      "catalog/index.mdx",
      "index.mdx",
      "integration/index.mdx",
      "records/index.mdx",
    ]);
    for (const page of await listFiles(join(root, GENERATED))) {
      const contents = await readFile(join(root, GENERATED, page), "utf8");
      assert.ok(contents.includes(GENERATED_MARKER), `${page} carries the package marker`);
      assert.ok(contents.includes(GENERATED_NOTICE_TEXT), `${page} carries the generated notice`);
    }
    const preflight = JSON.parse(await readFile(join(root, PREFLIGHT), "utf8"));
    assert.equal(preflight.viewModelVersion, 2);
    assert.equal(VIEW_MODEL_VERSION, 2);
    assert.equal(preflight.counts.generatedPages, 4);
    assert.match(run.stdout, /view model {6}v2/u);
    assert.match(run.stdout, /\+ doc\/src\/content\/docs\/components\/index\.mdx/u);
  });

  it("check is clean right after generate (validator, pages, preflight, models, zero footprints)", async () => {
    const root = await project();
    assert.equal((await runCli(root, ["generate"])).code, EXIT.PASS);
    const run = await runCli(root, ["check"]);
    assert.equal(run.code, EXIT.PASS, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /PASS: component-spec contract; 0 lines/u);
    assert.match(run.stdout, /ok {3}generated pages: doc\/src\/content\/docs\/components is up to date/u);
    assert.match(run.stdout, /ok {3}preflight: circuit\/generated\/preflight\.json is up to date/u);
    assert.match(run.stdout, /ok {3}models: 0 selected, up to date/u);
    assert.match(run.stdout, /ok {3}footprints: ok: zero selected footprints/u);
  });

  it("check before any generate reports every missing output, read-only", async () => {
    const root = await project();
    const run = await runCli(root, ["check"]);
    assert.equal(run.code, EXIT.FAILED);
    assert.match(run.stderr, /missing: doc\/src\/content\/docs\/components\/index\.mdx/u);
    assert.match(run.stdout, /missing: circuit\/generated\/preflight\.json; run `pnpm circuit:generate`/u);
    assert.match(run.stdout, /check failed \(exit \d+\); fix the steps marked FAIL, then run `pnpm check`/u);
    await assert.rejects(readdir(join(root, GENERATED)), { code: "ENOENT" });
  });

  it("a hand-edited generated page is drift; with its marker removed it is an ownership conflict", async () => {
    const root = await project();
    assert.equal((await runCli(root, ["generate"])).code, EXIT.PASS);
    const page = join(root, GENERATED, "catalog/index.mdx");
    const original = await readFile(page, "utf8");

    await writeFile(page, `${original}\nHand edit.\n`);
    const drift = await runCli(root, ["check"]);
    assert.equal(drift.code, EXIT.FAILED);
    assert.match(drift.stderr, /changed: doc\/src\/content\/docs\/components\/catalog\/index\.mdx/u);
    assert.match(drift.stdout, /run `pnpm circuit:generate`/u);

    await writeFile(page, original.replace(`${GENERATED_MARKER}\n`, ""));
    const conflict = await runCli(root, ["check"]);
    assert.equal(conflict.code, EXIT.FAILED);
    assert.match(conflict.stderr, /conflict: doc\/src\/content\/docs\/components\/catalog\/index\.mdx/u);
    // and generate refuses to overwrite it
    const refused = await runCli(root, ["generate"]);
    assert.equal(refused.code, EXIT.FAILED);
    assert.match(refused.stderr, /PATH_CONTAINMENT/u);
  });

  it("agentResources: false and a custom marker reach the rendered pages", async () => {
    const root = await project();
    const marker = "# GENERATED by test — do not edit";
    await writeFile(join(root, "circuit.config.ts"), configSource({ docs: { agentResources: false, generatedMarker: marker } }));
    assert.equal((await runCli(root, ["generate"])).code, EXIT.PASS);
    const landing = await readFile(join(root, GENERATED, "index.mdx"), "utf8");
    assert.ok(landing.includes(marker));
    assert.doesNotMatch(landing, /\/docs\/claude\//u);
    assert.ok(landing.includes(GENERATED_NOTICE_TEXT));
  });
});

describe("config and data errors", () => {
  it("a malformed config exits 2 and lists every error", async () => {
    const root = await project();
    const source = configSource()
      .replace('configVersion: 1', 'configVersion: 7')
      .replace('ownerPrefix: "component-"', 'ownerPrefix: "component-", surprise: true');
    await writeFile(join(root, "circuit.config.ts"), source);
    const run = await runCli(root, ["generate"]);
    assert.equal(run.code, EXIT.USAGE);
    assert.match(run.stderr, /\[CONFIG_INVALID\] .*2 error\(s\)/u);
    assert.match(run.stderr, /configVersion: must be 1/u);
    assert.match(run.stderr, /evidence\.surprise: unknown key/u);
  });

  it("a missing inventory exits 1 with ADAPTER_CONTRACT and its path; an explicitly empty one passes", async () => {
    const root = await project();
    await rm(join(root, INVENTORY));
    const run = await runCli(root, ["generate"]);
    assert.equal(run.code, EXIT.FAILED);
    assert.match(run.stderr, /\[ADAPTER_CONTRACT\]/u);
    assert.ok(run.stderr.includes(`evidence.inventory: ${INVENTORY} (file)`), run.stderr);

    const empty = await project(); // lines: [] with zero assertions
    assert.equal((await runCli(empty, ["generate"])).code, EXIT.PASS);
  });

  it("a selection naming an absent record is STALE_SELECTION", async () => {
    const root = await project();
    await writeJson(join(root, SELECTION), {
      ...EMPTY_SELECTION,
      recordIds: ["rec-ghost"],
      sourceIds: ["src-ghost"],
      linkableSourceIds: ["src-ghost"],
      documentSelections: [{ recordId: "rec-ghost", sourceId: "src-ghost", documentKind: "datasheet" }],
      expect: { ...EMPTY_SELECTION.expect, records: 1, sources: 1 },
    });
    const run = await runCli(root, ["generate"]);
    assert.equal(run.code, EXIT.FAILED);
    assert.match(run.stderr, /\[STALE_SELECTION\]/u);
    assert.match(run.stderr, /rec-ghost/u);
  });

  it("a malformed selection lists every problem with its path", async () => {
    const root = await project();
    await writeJson(join(root, SELECTION), { schema_version: 2, recordIds: "nope", expect: { records: 0 } });
    const run = await runCli(root, ["generate"]);
    assert.equal(run.code, EXIT.FAILED);
    assert.match(run.stderr, /publication\.selection is malformed/u);
    assert.match(run.stderr, /path: circuit\/publication\/selection\.json/u);
    for (const problem of [
      "schema_version: must be 1",
      "recordIds: must be an array",
      "sourceIds: is required",
      "expect.packages: is required",
    ]) {
      assert.ok(run.stderr.includes(problem), `${problem}\n${run.stderr}`);
    }
  });
});

describe("new-component", () => {
  it("creates the named bundle, refuses an existing one, and the untouched copy fails validation", async () => {
    const root = await project();
    const dry = await runCli(root, ["new-component", "x", "--dry-run"]);
    assert.equal(dry.code, EXIT.PASS);
    assert.match(dry.stdout, /would create \.claude\/skills\/component-x\//u);
    await assert.rejects(readdir(join(root, ".claude/skills/component-x")), { code: "ENOENT" });

    const created = await runCli(root, ["new-component", "x"]);
    assert.equal(created.code, EXIT.PASS, created.stderr);
    assert.match(created.stdout, /Replace EVERY example value/u);
    assert.match(created.stdout, /pnpm circuit:check/u);
    const skill = await readFile(join(root, ".claude/skills/component-x/SKILL.md"), "utf8");
    assert.match(skill, /^---\nname: component-x\n/u);

    const again = await runCli(root, ["new-component", "x"]);
    assert.equal(again.code, EXIT.USAGE);
    assert.match(again.stderr, /already exists/u);

    // Straight after creation the bundle is not in the inventory yet.
    const unowned = await runCli(root, ["validate"]);
    assert.equal(unowned.code, EXIT.FAILED);
    assert.match(unowned.stderr, /owner skills/u);

    // Registering it without replacing the example values trips the placeholder leak.
    await writeJson(join(root, INVENTORY), {
      schema_version: 1,
      generator_specs: [],
      assertions: { orderable_lines: 1, fitted_lines: 1, dnp_or_hand_fit_lines: 0 },
      exclusions: [],
      lines: [
        {
          line_id: "line-example",
          mpn: "EXAMPLE-MPN",
          manufacturer: "Example Manufacturer",
          lcsc: "C000000",
          package: "EXAMPLE",
          dnp: false,
          owner_skill: "component-x",
          identity_state: "VERIFIED",
          source_state: "AVAILABLE",
          function: "example function",
          placements: [],
        },
      ],
    });
    const leaked = await runCli(root, ["validate"]);
    assert.equal(leaked.code, EXIT.FAILED);
    assert.match(leaked.stderr, /template placeholder leaked into an active bundle/u);
  });

  it("rejects a suffix that is not a plain kebab name", async () => {
    const root = await project();
    const run = await runCli(root, ["new-component", "../escape"]);
    assert.equal(run.code, EXIT.USAGE);
    assert.match(run.stderr, /must be lowercase/u);
  });
});

describe("user-facing text", () => {
  it("never names the LED paths or scripts", async () => {
    const root = await project();
    const outputs = [
      await runCli(root, ["check"]),
      await runCli(root, ["generate"]),
      await runCli(root, ["--help"]),
    ];
    for (const run of outputs) {
      assert.doesNotMatch(`${run.stdout}${run.stderr}`, /doc\/component-docs|generate:components/u);
    }
  });
});
