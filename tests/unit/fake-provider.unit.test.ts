import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCatalog } from "../../src/catalog/load.ts";
import { llmFixtureSchema } from "../../src/contracts/llm-fixture.ts";
import type { MatchKeys, PromptSpec } from "../../src/contracts/llm.ts";
import { PrivacyRadarError } from "../../src/infra/errors.ts";
import { createFakeProvider } from "../../src/llm/fake-provider.ts";
import { ProviderError, type LlmCall } from "../../src/llm/provider.ts";
import { promptHash } from "../../src/llm/trace.ts";
import { draftNarrativePrompt } from "../../src/prompts/v1/draft-narrative.ts";
import { createLabelFieldPrompt } from "../../src/prompts/v1/label-field.ts";
import { fieldContext, evidenceMatches } from "../../src/shared/text.ts";
import { buildModelFromTexts } from "../helpers/builders.ts";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";

const catalog = loadCatalog();
const labelPrompt = createLabelFieldPrompt(catalog.categories.map((c) => c.id));
const prompts: readonly PromptSpec<unknown, unknown>[] = [labelPrompt as PromptSpec<unknown, unknown>, draftNarrativePrompt as PromptSpec<unknown, unknown>];
const DEMO = join(PROJECT_ROOT_FOR_TESTS, "fixtures", "llm", "telehealth-clinic.json");
const hashes = () => ({ "label-field.v1": promptHash(labelPrompt), "draft-narrative.v1": promptHash(draftNarrativePrompt) });

type Turn = { id: string; prompt: string; when: MatchKeys; output?: unknown; simulate?: { kind: string; then?: "ok" } };

function writeFixture(t: TestContext, turns: Turn[], promptHashes: Record<string, string> = hashes()): string {
  const path = join(tmpDir(t), "fixture.json");
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, scenario: "unit", promptHashes, turns }));
  return path;
}

function call(prompt: string, matchKeys: MatchKeys): LlmCall & { messages: { role: "system" | "user"; content: string }[]; jsonSchema: object } {
  const spec = prompt === "label-field.v1" ? labelPrompt : draftNarrativePrompt;
  return { prompt: spec as PromptSpec<unknown, unknown>, input: spec.sampleInput, matchKeys, messages: [], jsonSchema: {} };
}

const OUT = { label: "special.health", confidence: 0.62, evidence: "obs Json?", rationale: "r" };

test("the demo fixture and every test fixture with turns parse with llmFixtureSchema and carry current prompt hashes", () => {
  for (const rel of ["fixtures/llm/telehealth-clinic.json", "tests/fixtures/llm/lying-labels.json", "tests/fixtures/llm/garbage-output.json", "tests/fixtures/llm/numbers-drift.json", "tests/fixtures/llm/article-drift.json"]) {
    const parsed = llmFixtureSchema.safeParse(JSON.parse(readFileSync(join(PROJECT_ROOT_FOR_TESTS, rel), "utf8")));
    assert.ok(parsed.success, rel);
    assert.deepEqual(parsed.data.promptHashes, hashes(), `${rel}: run npm run fixtures:rehash`);
  }
});

test("[LLM-03] a matching turn answers in file order and is consumed once", async (t) => {
  const path = writeFixture(t, [
    { id: "first", prompt: "label-field.v1", when: { entity: "Patient", field: "obs" }, output: OUT },
    { id: "second", prompt: "label-field.v1", when: { entity: "Patient", field: "obs" }, output: { ...OUT, confidence: 0.7 } },
  ]);
  const fake = createFakeProvider({ fixturePath: path, prompts })!;
  assert.equal(fake.name, "fake");
  const keys = { entity: "Patient", field: "obs" };
  const a = await fake.complete(call("label-field.v1", keys));
  assert.equal(JSON.parse(a.text).confidence, 0.62);
  assert.equal(a.model, "fake-scripted");
  assert.equal(a.simulated, undefined);
  assert.equal(JSON.parse((await fake.complete(call("label-field.v1", keys))).text).confidence, 0.7);
  await assert.rejects(fake.complete(call("label-field.v1", keys)), (e: PrivacyRadarError) => e.code === "UNSCRIPTED_LLM_CALL");
  assert.deepEqual(fake.consumedIds(), ["first", "second"]);
});

test("[LLM-03] when keys are a subset of the call's match keys and the prompt must match", async (t) => {
  const path = writeFixture(t, [{ id: "by-entity", prompt: "label-field.v1", when: { entity: "Patient" }, output: OUT }]);
  const fake = createFakeProvider({ fixturePath: path, prompts })!;
  await assert.rejects(fake.complete(call("draft-narrative.v1", { entity: "Patient" })), (e: PrivacyRadarError) => e.code === "UNSCRIPTED_LLM_CALL");
  assert.equal(JSON.parse((await fake.complete(call("label-field.v1", { entity: "Patient", field: "any" }))).text).label, "special.health");
});

test("[LLM-03] a hash mismatch fails with FIXTURE_PROMPT_DRIFT", (t) => {
  const withHash = (h: string) => writeFixture(t, [{ id: "x", prompt: "label-field.v1", when: { entity: "A", field: "b" }, output: OUT }], { ...hashes(), "label-field.v1": h });
  assert.throws(
    () => createFakeProvider({ fixturePath: withHash("sha256:00"), prompts }),
    (e: PrivacyRadarError) => e.code === "FIXTURE_PROMPT_DRIFT" && /label-field\.v1/.test(e.message) && /npm run fixtures:rehash/.test(e.message),
  );
  const missing = writeFixture(t, [{ id: "x", prompt: "label-field.v1", when: { entity: "A", field: "b" }, output: OUT }], { "draft-narrative.v1": promptHash(draftNarrativePrompt) });
  assert.throws(() => createFakeProvider({ fixturePath: missing, prompts }), (e: PrivacyRadarError) => e.code === "FIXTURE_PROMPT_DRIFT");
});

test("an invalid fixture is a USAGE error that names no value", (t) => {
  const dir = tmpDir(t);
  const notJson = join(dir, "a.json");
  writeFileSync(notJson, "{ not json");
  assert.throws(() => createFakeProvider({ fixturePath: notJson, prompts }), (e: PrivacyRadarError) => e.code === "USAGE" && /not valid JSON/.test(e.message));
  const badShape = join(dir, "b.json");
  writeFileSync(badShape, JSON.stringify({ schemaVersion: 1, scenario: "x", promptHashes: hashes(), turns: [{ id: "t", prompt: "label-field.v1", when: {}, output: OUT, secretish: "value-xyz" }] }));
  assert.throws(() => createFakeProvider({ fixturePath: badShape, prompts }), (e: PrivacyRadarError) => e.code === "USAGE" && /turns\.0\.secretish/.test(e.message) && !e.message.includes("value-xyz"));
  const dup = join(dir, "c.json");
  writeFileSync(dup, JSON.stringify({ schemaVersion: 1, scenario: "x", promptHashes: hashes(), turns: [{ id: "t", prompt: "label-field.v1", when: {}, output: OUT }, { id: "t", prompt: "label-field.v1", when: {}, output: OUT }] }));
  assert.throws(() => createFakeProvider({ fixturePath: dup, prompts }), (e: PrivacyRadarError) => e.code === "USAGE" && /duplicate turn id/.test(e.message));
});

test("[LLM-03] an unscripted call names prompt, match keys, consumed and known turns", async () => {
  const fake = createFakeProvider({ fixturePath: DEMO, prompts })!;
  await fake.complete(call("label-field.v1", { entity: "Appointment", field: "extra" }));
  await assert.rejects(
    fake.complete(call("label-field.v1", { entity: "X", field: "y" })),
    (e: PrivacyRadarError) =>
      e.code === "UNSCRIPTED_LLM_CALL" &&
      /label-field\.v1/.test(e.message) &&
      /entity=X/.test(e.message) &&
      /field=y/.test(e.message) &&
      /consumed: classify-appointment-extra/.test(e.message) &&
      /classify-patient-obs/.test(e.message) &&
      !e.message.includes("\n"),
  );
});

test("[LLM-03] simulated failures are marked simulated and then: ok recovers", async (t) => {
  const keys = (field: string) => ({ entity: "E", field });
  const path = writeFixture(t, [
    { id: "bad-json", prompt: "label-field.v1", when: keys("a"), simulate: { kind: "invalid-json", then: "ok" }, output: OUT },
    { id: "violation", prompt: "label-field.v1", when: keys("b"), simulate: { kind: "schema-violation" }, output: OUT },
    { id: "refusal", prompt: "label-field.v1", when: keys("c"), simulate: { kind: "refusal-text" } },
    { id: "rate", prompt: "label-field.v1", when: keys("d"), simulate: { kind: "http-429" } },
    { id: "rate-ok", prompt: "label-field.v1", when: keys("e"), simulate: { kind: "http-429", then: "ok" }, output: OUT },
    { id: "slow", prompt: "label-field.v1", when: keys("f"), simulate: { kind: "timeout" } },
    { id: "boom", prompt: "label-field.v1", when: keys("g"), simulate: { kind: "http-500" } },
  ]);
  const fake = createFakeProvider({ fixturePath: path, prompts })!;
  const first = await fake.complete(call("label-field.v1", keys("a")));
  assert.equal(first.text, "not json {");
  assert.equal(first.simulated, true);
  const second = await fake.complete(call("label-field.v1", keys("a")));
  assert.deepEqual(JSON.parse(second.text), OUT);
  assert.equal(second.simulated, true);
  const violation = JSON.parse((await fake.complete(call("label-field.v1", keys("b")))).text);
  assert.ok(Object.keys(violation).length > Object.keys(OUT).length);
  assert.equal((await fake.complete(call("label-field.v1", keys("c")))).text, "I cannot help with that.");
  await assert.rejects(fake.complete(call("label-field.v1", keys("d"))), (e: unknown) => e instanceof ProviderError && e.kind === "http" && e.status === 429 && e.simulated);
  const recovered = await fake.complete(call("label-field.v1", keys("e")));
  assert.deepEqual(JSON.parse(recovered.text), OUT);
  assert.equal(recovered.simulated, true);
  await assert.rejects(fake.complete(call("label-field.v1", keys("f"))), (e: unknown) => e instanceof ProviderError && e.kind === "timeout" && e.simulated);
  await assert.rejects(fake.complete(call("label-field.v1", keys("g"))), (e: unknown) => e instanceof ProviderError && e.status === 500 && e.simulated);
  fake.assertAllConsumed();
});

test("[LLM-11] no fixture path or a missing file returns null", () => {
  assert.equal(createFakeProvider({ fixturePath: null, prompts }), null);
  assert.equal(createFakeProvider({ fixturePath: "/nonexistent/x.json", prompts }), null);
});

test("assertAllConsumed lists stale turns", async () => {
  const fake = createFakeProvider({ fixturePath: DEMO, prompts })!;
  await fake.complete(call("label-field.v1", { entity: "Patient", field: "obs" }));
  assert.throws(() => fake.assertAllConsumed(), (e: Error) => /classify-appointment-extra/.test(e.message) && !/classify-patient-obs/.test(e.message));
});

test("every evidence string of the demo fixture passes the context check against the demo fixture's fields", () => {
  const read = (rel: string) => readFileSync(join(PROJECT_ROOT_FOR_TESTS, "fixtures", "telehealth-clinic", rel), "utf8");
  const model = buildModelFromTexts({ "prisma/schema.prisma": read("prisma/schema.prisma"), "migrations/001_init.sql": read("migrations/001_init.sql") });
  const fixture = llmFixtureSchema.parse(JSON.parse(readFileSync(DEMO, "utf8")));
  const labelTurns = fixture.turns.filter((turn) => turn.prompt === "label-field.v1");
  assert.equal(labelTurns.length, 2);
  for (const turn of labelTurns) {
    const entity = model.entities.find((e) => e.name === turn.when["entity"])!;
    const field = entity.fields.find((f) => f.name === turn.when["field"])!;
    assert.ok(field.ambiguous, `${entity.name}.${field.name} is ambiguous`);
    const context = fieldContext({ declarationText: field.field.declarationText, comment: field.field.comment, entityFields: entity.fields.map((f) => f.name) });
    assert.ok(evidenceMatches((turn.output as { evidence: string }).evidence, context), turn.id);
  }
});
