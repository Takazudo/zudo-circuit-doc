/**
 * `RenderOptions` (#14): the agent-resource toggle, injected integration-domain
 * gloss, the ADR-020 generated notice, zero-state copy, and the FACT-01/02/04
 * render-truthfulness requirements.
 *
 * Every renderer defaults `options` to `DEFAULT_RENDER_OPTIONS`, so
 * `test/core/render.test.ts` and `test/core/presentation.test.ts` already
 * prove the default (today's) output is unchanged — this file exercises the
 * toggles themselves.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { anchor } from "../../src/core/ids.ts";
import { FIELD_KEYS, PublicationPolicy, type InstanceSelection, type PublicationMatrix } from "../../src/core/publication.ts";
import { renderCatalog } from "../../src/core/render/catalog.ts";
import { renderIntegration } from "../../src/core/render/integration.ts";
import { renderLanding } from "../../src/core/render/landing.ts";
import { renderRecord, renderRecordsIndex } from "../../src/core/render/record.ts";
import { DEFAULT_RENDER_OPTIONS, buildRecordIndex, type RenderOptions } from "../../src/core/render/shared.ts";
import { literal, safeText } from "../../src/core/text.ts";
import { FIXTURE_IDS, denseModel, fixtureModel } from "../fixtures/view-model-fixtures.ts";
import type { PublicFact, PublicRecord, PublicViewModel } from "../../src/core/view-model.ts";

const GENERATED_NOTICE_TEXT =
  "Generated from the component evidence records — edit the records, not this page.";

/** Every field decided PUBLISH, so `publishRequired` never throws in these tests. */
function fullPublishPolicy(): PublicationPolicy {
  const matrix = Object.fromEntries(
    FIELD_KEYS.map((key) => [key, "PUBLISH" as const]),
  ) as PublicationMatrix;
  const selection: InstanceSelection = {
    recordIds: [],
    sourceIds: [],
    linkableSourceIds: [],
    documentSelections: [],
    expect: { records: 0, sources: 0, integrationRules: 0 },
  };
  return new PublicationPolicy(matrix, selection);
}

function driverOf(model: PublicViewModel): PublicRecord {
  const record = model.records.find((entry) => entry.identity.recordId === FIXTURE_IDS.driverRecord);
  assert.ok(record, "fixture has no driver record");
  return record;
}

const model = fixtureModel();
const index = buildRecordIndex(model);
const driver = driverOf(model);
const policy = fullPublishPolicy();

describe("agentResources toggle", () => {
  const off: RenderOptions = { ...DEFAULT_RENDER_OPTIONS, agentResources: false };

  it("suppresses the landing hub link but keeps the section", () => {
    const withLinks = renderLanding(model, policy).contents;
    const withoutLinks = renderLanding(model, policy, off).contents;
    assert.ok(withLinks.includes("(/docs/claude/)"));
    assert.ok(withoutLinks.includes("## Raw agent resources"));
    assert.ok(!withoutLinks.includes("(/docs/claude/)"));
    assert.ok(!withoutLinks.includes("/docs/claude"));
  });

  it("suppresses the catalog entry's agent-resource link but still names the bundle", () => {
    const withLinks = renderCatalog(model).contents;
    const withoutLinks = renderCatalog(model, off).contents;
    assert.ok(withLinks.includes(`(/docs/claude-skills/${FIXTURE_IDS.ownerSkill}/)`));
    assert.ok(!withoutLinks.includes("/docs/claude-skills/"));
    assert.ok(withoutLinks.includes(`\`${FIXTURE_IDS.ownerSkill}\``));
    assert.ok(withoutLinks.includes("Agent-resource links are disabled"));
  });

  it("suppresses the integration page's owning-bundle links but still names them", () => {
    const withLinks = renderIntegration(model, index).contents;
    const withoutLinks = renderIntegration(model, index, off).contents;
    assert.ok(withLinks.includes("(/docs/claude-skills/circuit-fixture-integration/)"));
    assert.ok(!withoutLinks.includes("/docs/claude-skills/"));
    assert.ok(withoutLinks.includes("`circuit-fixture-integration`"));
  });

  it("suppresses a record's own owning-bundle link but still names it", () => {
    const withLinks = renderRecord(driver, index).contents;
    const withoutLinks = renderRecord(driver, index, off).contents;
    assert.ok(withLinks.includes(`(/docs/claude-skills/${FIXTURE_IDS.ownerSkill}/)`));
    assert.ok(!withoutLinks.includes("/docs/claude-skills/"));
    assert.ok(withoutLinks.includes(`\`${FIXTURE_IDS.ownerSkill}\``));
  });
});

describe("integrationDomainGloss injection", () => {
  const gloss = { "fixture-power-stage": "Whether the fixture power stage survives bench testing." };
  const withGloss: RenderOptions = { ...DEFAULT_RENDER_OPTIONS, integrationDomainGloss: gloss };

  it("has no gloss for a fixture domain by default (package default is `{}`)", () => {
    const page = renderIntegration(model, index).contents;
    assert.ok(!page.includes("What this rule asks:"));
    assert.ok(page.includes("No plain-language description is recorded for this term yet."));
  });

  it("renders an injected gloss on the integration page, in the rule section and the legend", () => {
    const page = renderIntegration(model, index, withGloss).contents;
    assert.ok(page.includes("**What this rule asks:** Whether the fixture power stage survives bench testing."));
    assert.match(page, /\| fixture-power-stage\s*\| Whether the fixture power stage survives bench testing\./u);
  });

  it("renders the same injected gloss on a record page that is named in the rule", () => {
    const page = renderRecord(driver, index, withGloss).contents;
    assert.ok(page.includes("Whether the fixture power stage survives bench testing."));
  });

  it("still renders an unglossed domain verbatim, never dropped", () => {
    const page = renderIntegration(model, index, withGloss).contents;
    // rule-fixture-chain's domain has no entry in `gloss` above.
    assert.ok(page.includes("fixture-source-to-bench-chain"));
  });
});

describe("generatedNotice (ADR-020)", () => {
  it("is on by default, at the top of every generated page", () => {
    const catalogPage = renderCatalog(model).contents;
    const landingPage = renderLanding(model, policy).contents;
    const integrationPage = renderIntegration(model, index).contents;
    const recordPage = renderRecord(driver, index).contents;
    const recordsIndexPage = renderRecordsIndex(model.records).contents;

    for (const page of [catalogPage, landingPage, integrationPage, recordPage, recordsIndexPage]) {
      assert.ok(page.includes(GENERATED_NOTICE_TEXT), "page is missing the ADR-020 notice");
    }
    assert.ok(catalogPage.indexOf(GENERATED_NOTICE_TEXT) < catalogPage.indexOf("## Parts at a glance"));
    assert.ok(landingPage.indexOf(GENERATED_NOTICE_TEXT) < landingPage.indexOf("## How to read these pages"));
    assert.ok(integrationPage.indexOf(GENERATED_NOTICE_TEXT) < integrationPage.indexOf("## Rules at a glance"));
    assert.ok(recordPage.indexOf(GENERATED_NOTICE_TEXT) < recordPage.indexOf("## Identity"));
    assert.ok(recordsIndexPage.indexOf(GENERATED_NOTICE_TEXT) < recordsIndexPage.indexOf("## Records"));
  });

  it("disappears entirely when the project turns it off — the LED fixture's case", () => {
    const off: RenderOptions = { ...DEFAULT_RENDER_OPTIONS, generatedNotice: false };
    for (const page of [
      renderCatalog(model, off).contents,
      renderLanding(model, policy, off).contents,
      renderIntegration(model, index, off).contents,
      renderRecord(driver, index, off).contents,
      renderRecordsIndex(model.records, off).contents,
    ]) {
      assert.ok(!page.includes(GENERATED_NOTICE_TEXT));
    }
  });
});

describe("zero-state pages", () => {
  const empty = denseModel(0);
  const emptyIndex = buildRecordIndex(empty);

  it("catalog shows guidance instead of a header-only index table", () => {
    const page = renderCatalog(empty).contents;
    assert.ok(
      page.includes(
        "No component record is published yet. Add the first exact component with Workflow B in",
      ),
    );
    assert.ok(page.includes("`circuit/WORKFLOW.md`"));
    assert.ok(page.includes("`circuit/publication/selection.json`"));
    assert.ok(!page.includes("## Parts at a glance"), "an empty catalog must not render the index table");
    assert.ok(!page.includes('<EvidenceTable label="parts-index">'));
  });

  it("landing carries the same guidance", () => {
    const page = renderLanding(empty, policy).contents;
    assert.ok(
      page.includes(
        "No component record is published yet. Add the first exact component with Workflow B in",
      ),
    );
  });

  it("integration states the zero-rule case without a safety claim", () => {
    const page = renderIntegration(empty, emptyIndex).contents;
    assert.ok(page.includes("No cross-component integration rule is declared."));
    assert.ok(!page.toLowerCase().includes("safe"));
  });

  it("records index keeps its existing empty-corpus line", () => {
    assert.ok(renderRecordsIndex(empty.records).contents.includes("No component record is published."));
  });
});

describe("FACT-04: a COVERED domain never hides a NEEDS BENCH fact behind it", () => {
  it("keeps the bench requirement visible next to the fact, with no verification badge", () => {
    const truthful: PublicRecord = {
      ...driver,
      coverage: [
        ...driver.coverage,
        {
          coverageId: literal("cov-fixture-truthful"),
          anchor: anchor("cov-fixture-truthful"),
          recordId: driver.identity.recordId,
          domain: literal("fixture-truthful-coverage"),
          status: "COVERED",
          reason: literal("Every fact this domain asks for is on record, including one still awaiting a bench measurement."),
          factIds: [literal("fact-fixture-thermal-rise")],
          blockingFactIds: [],
        },
      ],
    };
    const page = renderRecord(truthful, index).contents;

    const domainSection = page.slice(
      page.indexOf("### fixture-truthful-coverage"),
      page.indexOf("### fixture-truthful-coverage") + 600,
    );
    assert.ok(domainSection.includes("**Status:** COVERED"));
    assert.ok(!domainSection.toLowerCase().includes("verified"));
    assert.ok(!domainSection.toLowerCase().includes("passed"));

    // The fact itself, in the Facts section, still carries its own real verdict —
    // a COVERED domain never upgrades or hides it.
    assert.match(
      page,
      /fact-fixture-thermal-rise[\s\S]*?\*\*Verdict:\*\* NEEDS BENCH/u,
    );
  });
});

describe("FACT-01: a TYPICAL_CURVE fact is never labelled a guaranteed limit", () => {
  it("keeps the class gloss and the fact's own conditions visible", () => {
    const typicalCurveFact: PublicFact = {
      factId: literal("fact-fixture-typical-curve"),
      anchor: anchor("fact-fixture-typical-curve"),
      recordId: driver.identity.recordId,
      sourceId: driver.sources[0]!.sourceId,
      factClass: literal("TYPICAL_CURVE"),
      value: 1.8,
      unit: literal("A"),
      conditions: safeText("read from the typical efficiency-vs-load curve at 25 C", { field: "test" }),
      locator: safeText("Typical Performance Characteristics, Figure 4", { field: "test" }),
      provenance: literal("PRIMARY-SPEC"),
      verdict: literal("PASS - primary-source confirmed"),
      dependsOn: [],
      expression: safeText("", { field: "test", allowEmpty: true }),
    };
    const withTypicalCurve: PublicRecord = { ...driver, facts: [...driver.facts, typicalCurveFact] };
    const page = renderRecord(withTypicalCurve, index).contents;

    // The serializer backslash-escapes the underscore in heading text (it could
    // otherwise open emphasis), so the heading reads `TYPICAL\_CURVE` — the same
    // prefix-only check `render.test.ts` already uses for `ABSOLUTE_MAXIMUM` etc.
    assert.ok(page.includes("### TYPICAL"));
    assert.ok(
      page.includes("Typical values are not guaranteed and vary part to part."),
      "the class gloss must say this is not a guarantee",
    );
    assert.ok(page.includes("read from the typical efficiency-vs-load curve at 25 C"));
    assert.doesNotMatch(
      page,
      /typical efficiency-vs-load curve[\s\S]{0,200}guaranteed limit/u,
    );
  });
});

describe("FACT-02: a calculated fact keeps its own verdict, never one borrowed from an UNSOURCED input", () => {
  it("prints the calculated fact's real verdict even when it depends on an UNSOURCED fact", () => {
    const crossRecordFact = driver.facts.find(
      (fact) => fact.factId === FIXTURE_IDS.crossRecordFact,
    );
    assert.ok(crossRecordFact);
    assert.equal(crossRecordFact.verdict, "NEEDS BENCH");

    const unsourcedDependency = driver.facts.find((fact) => fact.verdict === "UNSOURCED");
    assert.ok(unsourcedDependency, "fixture must carry an UNSOURCED fact to depend on");

    const withUnsourcedDependency: PublicRecord = {
      ...driver,
      facts: driver.facts.map((fact) =>
        fact.factId === FIXTURE_IDS.crossRecordFact
          ? { ...fact, dependsOn: [...fact.dependsOn, unsourcedDependency.factId] }
          : fact,
      ),
    };
    const page = renderRecord(withUnsourcedDependency, index).contents;

    // The renderer never recomputes a verdict from a fact's dependencies — this
    // is the validator's job (FACT-02's other half). Here it is enough that the
    // calculated fact's OWN recorded verdict, not some derived "PASS", is what
    // publishes.
    assert.match(
      page,
      new RegExp(`${FIXTURE_IDS.crossRecordFact}[\\s\\S]*?\\*\\*Verdict:\\*\\* NEEDS BENCH`, "u"),
    );
    assert.ok(page.includes(`\`${unsourcedDependency.factId}\``));
  });
});

describe("LED-shaped options reproduce the moved gloss wording (harness for #21's byte-for-byte proof)", () => {
  // The real byte-identical proof against the pinned LED goldens is #21's
  // (this branch has no provider yet — #11/#12/#17 are parallel siblings). What
  // this harness CAN prove now: the six sentences removed from
  // `render/shared.ts`'s old hard-coded `INTEGRATION_DOMAIN_GLOSS` still render
  // identically once a project supplies them through `RenderOptions`, and that
  // supplying LED-shaped options (`agentResources: true`, `generatedNotice:
  // false`) is deterministic across repeated runs — the two properties #21
  // actually depends on from this issue.
  const LED_INTEGRATION_GLOSS = {
    "rail-envelope":
      "Whether every part on the input rail stays inside its own recorded limits across a legal " +
      "power contract, a mis-contract, and a transient clamp event.",
    "usb-pd-nvm-load-switch":
      "How the power-delivery controller's stored configuration and its enable output drive the " +
      "load switch, through every state from detached to fault.",
    "al8860-led-stage":
      "How the LED driver, its sense resistor, inductor, catch diode and per-branch ballast " +
      "behave together across the LED forward-voltage, tolerance and temperature envelope.",
    "ap63203-logic-stage":
      "How the logic-rail converter, its inductor and its output capacitor behave together under " +
      "the real load the microcontroller presents.",
    "ntc-adc-firmware":
      "How the thermistor, its divider, the analog-to-digital input and the firmware that reads " +
      "them combine into a temperature the design can act on.",
    "source-to-bench-chain":
      "How far each claim has travelled from a manufacturer document towards a measurement on " +
      "real hardware, stage by stage.",
  } as const;

  const ledLikeOptions: RenderOptions = {
    agentResources: true,
    integrationDomainGloss: LED_INTEGRATION_GLOSS,
    generatedNotice: false,
  };

  it("renders the exact moved sentence for a real LED domain name", () => {
    const ledDomainModel: PublicViewModel = {
      ...model,
      integration: [
        {
          ...model.integration[0]!,
          domain: literal("al8860-led-stage"),
        },
      ],
    };
    const page = renderIntegration(ledDomainModel, index, ledLikeOptions).contents;
    assert.ok(
      page.includes(
        "How the LED driver, its sense resistor, inductor, catch diode and per-branch ballast " +
          "behave together across the LED forward-voltage, tolerance and temperature envelope.",
      ),
    );
    assert.ok(!page.includes(GENERATED_NOTICE_TEXT), "LED fixture keeps generatedNotice off");
  });

  it("is deterministic across repeated runs with the same LED-shaped options", () => {
    const first = renderIntegration(model, index, ledLikeOptions).contents;
    const second = renderIntegration(fixtureModel(), buildRecordIndex(fixtureModel()), ledLikeOptions).contents;
    assert.equal(first, second);
  });
});
