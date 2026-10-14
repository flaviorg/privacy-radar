import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCatalog } from "../../src/catalog/load.ts";
import type { AmbiguousField, DraftNarrativeInput, LabelFieldInput, MatchKeys } from "../../src/contracts/llm.ts";
import { FixturePromptDriftError, UnscriptedLlmCallError } from "../../src/infra/errors.ts";
import { createFakeProvider } from "../../src/llm/fake-provider.ts";
import { providerSchema } from "../../src/llm/openai-compatible.ts";
import { callLlm, ProviderError, type LlmProvider, type LlmRaw, type LlmRequest } from "../../src/llm/provider.ts";
import { draftNarrative, labelAmbiguousField } from "../../src/llm/tasks.ts";
import { createTrace, inputSha256, promptHash } from "../../src/llm/trace.ts";
import { createPrompts } from "../../src/prompts/index.ts";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";

const catalog = loadCatalog();
const prompts = createPrompts(catalog.categories.map((c) => c.id));
const redact = (s: string) => s;

function labelInput(entity: string, field: string, declarationText: string, comment: string | null = null): LabelFieldInput {
  return {
    field: { name: field, rawType: "Json", optional: true, array: false, entity, declarationText, entityFields: ["id", "diagnosis", field], sourceKind: "prisma", file: "prisma/schema.prisma", line: 17 },
    candidateCategories: [],
    maskedSamples: [],
    comment,
  };
}
const ambiguous = (input: LabelFieldInput): AmbiguousField => ({ entity: input.field.entity, field: input.field.name, entityKind: "model", file: input.field.file, line: input.field.line, column: 3, sensitiveEntity: true, input });

type Turn = { id: string; prompt: string; when: MatchKeys; output?: unknown; simulate?: { kind: string; then?: "ok" } };
function fixture(t: TestContext, turns: Turn[]): string {
  const path = join(tmpDir(t), "f.json");
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, scenario: "unit", promptHashes: Object.fromEntries(prompts.all.map((p) => [p.name, promptHash(p)])), turns }));
  return path;
}

/** Records every request a provider receives. */
function spy(inner: LlmProvider): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return { name: inner.name, requests, complete: (call) => (requests.push(call), inner.complete(call)) };
}
const stub = (complete: (call: LlmRequest) => Promise<LlmRaw>): LlmProvider => ({ name: "openai-compatible", complete });

test("[LLM-02] a label is accepted only when the schema parses and the evidence is in the field context", async (t) => {
  const path = fixture(t, [
    { id: "ok", prompt: "label-field.v1", when: { entity: "Patient", field: "obs" }, output: { label: "special.health", confidence: 0.62, evidence: "obs   Json?", rationale: "clinical notes" } },
    { id: "lie", prompt: "label-field.v1", when: { entity: "Patient", field: "extra" }, output: { label: "special.health", confidence: 0.9, evidence: "HIV status", rationale: "x" } },
    { id: "off-enum", prompt: "label-field.v1", when: { entity: "Patient", field: "meta" }, output: { label: "special.made-up", confidence: 0.9, evidence: "meta Json?", rationale: "x" } },
    { id: "off-enum-repair", prompt: "label-field.v1", when: { entity: "Patient", field: "meta" }, output: { label: "special.made-up", confidence: 0.9, evidence: "meta Json?", rationale: "x" } },
  ]);
  const fake = createFakeProvider({ fixturePath: path, prompts: prompts.all })!;
  const trace = createTrace();
  const label = await labelAmbiguousField(fake, prompts.label, ambiguous(labelInput("Patient", "obs", "obs Json?")), { trace, redact });
  assert.deepEqual(label, { entity: "Patient", field: "obs", file: "prisma/schema.prisma", line: 17, column: 3, label: "special.health", confidence: 0.62, evidence: "obs   Json?", rationale: "clinical notes", scripted: true });
  assert.equal(await labelAmbiguousField(fake, prompts.label, ambiguous(labelInput("Patient", "extra", "extra Json?")), { trace, redact }), null);
  assert.equal(await labelAmbiguousField(fake, prompts.label, ambiguous(labelInput("Patient", "meta", "meta Json?")), { trace, redact }), null);
  assert.deepEqual(trace.lines().map((l) => [l.matchKeys["field"], l.outcome]), [["obs", "ok"], ["extra", "evidence-mismatch"], ["meta", "degraded"]]);
});

test("[LLM-07] invalid output triggers exactly one repair with the validation issues; a second failure degrades", async () => {
  const garbage = createFakeProvider({ fixturePath: join(PROJECT_ROOT_FOR_TESTS, "tests", "fixtures", "llm", "garbage-output.json"), prompts: prompts.all })!;
  const provider = spy(garbage);
  const trace = createTrace();
  const reasons: string[] = [];
  const r = await callLlm(provider, prompts.label, labelInput("Patient", "obs", "obs Json?"), { trace, redact, onDegraded: (reason) => reasons.push(reason) });
  assert.equal(r.value, null);
  assert.equal(r.outcome, "degraded");
  assert.equal(r.simulated, true);
  assert.equal(provider.requests.length, 2);
  const firstUser = provider.requests[0]!.messages.find((m) => m.role === "user")!.content;
  const repairUser = provider.requests[1]!.messages.find((m) => m.role === "user")!.content;
  assert.ok(!firstUser.includes("failed validation"));
  assert.ok(repairUser.startsWith(firstUser));
  assert.match(repairUser, /Your previous answer failed validation: unexpectedKey: unrecognized_keys\. Return only JSON matching the schema\./);
  assert.deepEqual(reasons, ["LLM_OUTPUT_INVALID"]);
  assert.deepEqual(trace.lines().map((l) => [l.outcome, l.simulated]), [["degraded", true]]);
});

test("[LLM-07] an invalid-json turn with then: ok is repaired and marked simulated", async (t) => {
  const path = fixture(t, [{ id: "fail-once", prompt: "label-field.v1", when: { entity: "Patient", field: "obs" }, simulate: { kind: "invalid-json", then: "ok" }, output: { label: "unknown", confidence: 0.3, evidence: "obs", rationale: "x" } }]);
  const provider = spy(createFakeProvider({ fixturePath: path, prompts: prompts.all })!);
  const trace = createTrace();
  const r = await callLlm(provider, prompts.label, labelInput("Patient", "obs", "obs Json?"), { trace, redact });
  assert.deepEqual([r.outcome, r.simulated, r.value?.label], ["repaired", true, "unknown"]);
  assert.match(provider.requests[1]!.messages[1]!.content, /failed validation: invalid JSON\./);
  assert.deepEqual(trace.lines().map((l) => [l.outcome, l.simulated]), [["repaired", true]]);
});

test("[LLM-07] provider errors degrade and never throw; fixture errors are rethrown", async () => {
  const input = labelInput("Patient", "obs", "obs Json?");
  for (const [err, reason] of [
    [new ProviderError("timeout", "slow"), "LLM_TIMEOUT"],
    [new ProviderError("http", "rate", { status: 429 }), "LLM_HTTP_429"],
    [new ProviderError("refusal", "no"), "LLM_REFUSAL"],
    [new ProviderError("network", "down"), "LLM_NETWORK"],
    [new Error("anything else"), "LLM_ERROR"],
  ] as const) {
    let calls = 0;
    const reasons: string[] = [];
    const r = await callLlm(stub(async () => (calls++, Promise.reject(err))), prompts.label, input, { trace: createTrace(), redact, onDegraded: (x) => reasons.push(x) });
    assert.deepEqual([r.value, r.outcome, calls, reasons], [null, "degraded", 1, [reason]]);
  }
  await assert.rejects(callLlm(stub(async () => Promise.reject(new UnscriptedLlmCallError("x"))), prompts.label, input, { trace: createTrace(), redact }), UnscriptedLlmCallError);
  await assert.rejects(callLlm(stub(async () => Promise.reject(new FixturePromptDriftError("x"))), prompts.label, input, { trace: createTrace(), redact }), FixturePromptDriftError);
});

test("callLlm sends the system prompt, the user message and the provider schema", async () => {
  const provider = spy(stub(async () => ({ text: 'Sure: {"label":"unknown","confidence":0.3,"evidence":"obs","rationale":"x"} done', usage: { promptTokens: 7, completionTokens: 3 }, model: "m-1" })));
  const input = labelInput("Patient", "obs", "obs Json?");
  const trace = createTrace();
  const r = await callLlm(provider, prompts.label, input, { trace, redact });
  assert.equal(r.outcome, "ok");
  const req = provider.requests[0]!;
  assert.deepEqual(req.messages, [{ role: "system", content: prompts.label.system }, { role: "user", content: prompts.label.buildUser(input) }]);
  assert.deepEqual(req.jsonSchema, providerSchema(prompts.label.outputSchema));
  assert.deepEqual(req.matchKeys, { entity: "Patient", field: "obs" });
  assert.deepEqual(trace.lines()[0]!.usage, { promptTokens: 7, completionTokens: 3 });
  assert.equal(trace.lines()[0]!.model, "m-1");
});

test("trace lines carry outcome, prompt, matchKeys and inputSha256 but never the input or output text", async (t) => {
  const path = fixture(t, [{ id: "ok", prompt: "label-field.v1", when: { entity: "Patient", field: "obs" }, output: { label: "special.health", confidence: 0.62, evidence: "obs Json?", rationale: "RATIONALE-MARK" } }]);
  const fake = createFakeProvider({ fixturePath: path, prompts: prompts.all })!;
  const trace = createTrace();
  const input = labelInput("Patient", "obs", "obs Json? DECL-MARK", "COMMENT-MARK");
  await labelAmbiguousField(fake, prompts.label, ambiguous(input), { trace, redact });
  const [line] = trace.lines();
  assert.deepEqual(Object.keys(line!).sort(), ["durationMs", "inputSha256", "matchKeys", "model", "outcome", "prompt", "seq", "usage"]);
  assert.deepEqual([line!.seq, line!.prompt, line!.outcome, line!.inputSha256, line!.model], [1, "label-field.v1", "ok", inputSha256(input), "fake-scripted"]);
  const text = JSON.stringify(trace.lines());
  for (const mark of ["DECL-MARK", "COMMENT-MARK", "RATIONALE-MARK", "special.health"]) assert.ok(!text.includes(mark), mark);
});

const narrativeInput: DraftNarrativeInput = { ...prompts.narrative.sampleInput, document: "ropa", section: "purposes" };

test("[DOC-05] draftNarrative returns paragraphs, a placeholder on drift and a placeholder when the provider is unavailable", async (t) => {
  const path = fixture(t, [
    { id: "good", prompt: "draft-narrative.v1", when: { document: "ropa", section: "purposes" }, output: { paragraphs: ["The controller keeps 1 entity with 3 fields under art. 46."], citedFindingIds: [] } },
    { id: "drift", prompt: "draft-narrative.v1", when: { document: "ropa", section: "purposes" }, output: { paragraphs: ["The controller keeps 7 entities and many more fields."], citedFindingIds: [] } },
    { id: "cite", prompt: "draft-narrative.v1", when: { document: "ropa", section: "purposes" }, output: { paragraphs: ["Processing of the 1 entity falls under art. 9 here."], citedFindingIds: [] } },
  ]);
  const fake = createFakeProvider({ fixturePath: path, prompts: prompts.all })!;
  const trace = createTrace();
  assert.deepEqual(await draftNarrative(fake, prompts.narrative, narrativeInput, new Set(), { trace, redact }), { paragraphs: ["The controller keeps 1 entity with 3 fields under art. 46."] });
  assert.deepEqual(await draftNarrative(fake, prompts.narrative, narrativeInput, new Set(), { trace, redact }), { placeholder: "_Narrative unavailable (LLM output rejected: numbers-drift)._", reason: "numbers-drift" });
  assert.deepEqual(await draftNarrative(fake, prompts.narrative, narrativeInput, new Set(), { trace, redact }), { placeholder: "_Narrative unavailable (LLM output rejected: article-drift)._", reason: "article-drift" });
  const down = stub(async () => Promise.reject(new ProviderError("network", "down")));
  assert.deepEqual(await draftNarrative(down, prompts.narrative, narrativeInput, new Set(), { trace, redact }), { placeholder: "_Narrative unavailable (LLM output rejected: provider unavailable)._", reason: "provider unavailable" });
  assert.deepEqual(trace.lines().map((l) => l.outcome), ["ok", "numbers-drift", "article-drift", "degraded"]);
});
