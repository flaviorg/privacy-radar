import { before, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLlm, type LlmSetup } from "../../src/app/llm.ts";
import type { ScanOutcome } from "../../src/app/scan.ts";
import { loadCatalog } from "../../src/catalog/load.ts";
import { scanResultSchema } from "../../src/contracts/findings.ts";
import { inventorySchema } from "../../src/contracts/inventory.ts";
import { loadEnv } from "../../src/infra/config.ts";
import { createPrompts } from "../../src/prompts/index.ts";
import { runScanInProcess } from "../helpers/run-scan.ts";

const prompts = createPrompts(loadCatalog().categories.map((c) => c.id));
const fakeSetup = (fixturePath: string): LlmSetup => resolveLlm({ choice: "fake", fixturePath, env: loadEnv({}), prompts, redact: (s) => s });

let fake: ScanOutcome & { outDir: string };
let none: ScanOutcome & { outDir: string };
let lying: ScanOutcome & { outDir: string };
let fakeSetupUsed: LlmSetup;

before(async (hook) => {
  const t = hook as TestContext; // a hook receives a TestContext at run time
  fakeSetupUsed = fakeSetup("fixtures/llm/telehealth-clinic.json");
  fake = await runScanInProcess(t, { llm: fakeSetupUsed, formats: ["json", "sarif", "md"] });
  none = await runScanInProcess(t);
  lying = await runScanInProcess(t, { llm: fakeSetup("tests/fixtures/llm/lying-labels.json") });
});

test("[LLM-02] Patient.obs becomes one PR-AMBIGUOUS note with origin llm, special.health 0.62", () => {
  const amb = fake.result.findings.filter((f) => f.origin === "llm");
  assert.deepEqual(
    amb.map((f) => [f.ruleId, f.severity, f.categories[0], f.confidence, f.location.file, f.location.line]),
    [["PR-AMBIGUOUS", "note", "special.health", 0.62, "prisma/schema.prisma", 17]],
  );
  assert.deepEqual(amb[0]!.entity, { name: "Patient", field: "obs", kind: "model" });
  assert.equal(fake.result.provider, "fake");
  assert.equal(fakeSetupUsed.label, "fake (scripted)");
  scanResultSchema.parse(fake.result);
  // without --docs only the two label turns run; the narrative turns are consumed by document runs (documents.e2e, demo.e2e)
  assert.deepEqual([...fakeSetupUsed.fake!.consumedIds()].sort(), ["classify-appointment-extra", "classify-patient-obs"]);
});

test("[LLM-02] Appointment.extra (unknown) appears only as the inventory llmLabel", () => {
  assert.ok(!fake.result.findings.some((f) => f.entity?.field === "extra"));
  inventorySchema.parse(fake.inventory);
  const field = (entity: string, name: string) => fake.inventory.entities.find((e) => e.name === entity)!.fields.find((f) => f.name === name)!;
  assert.deepEqual(field("Appointment", "extra").llmLabel, { label: "unknown", confidence: 0.3, scripted: true, rationale: "No neighbouring field suggests a category." });
  assert.deepEqual(field("Patient", "obs").llmLabel, { label: "special.health", confidence: 0.62, scripted: true, rationale: "Free-form clinical observations next to diagnosis and allergies." });
  assert.equal(field("Patient", "obs").status, "ambiguous");
  assert.deepEqual(field("Patient", "obs").categories, []);
  const md = readFileSync(join(fake.outDir, "inventory.md"), "utf8");
  assert.ok(md.includes("`special.health` (0.62, scripted)"));
  assert.ok(!md.includes("Free-form clinical observations"), "a rationale is never written to Markdown");
});

test("[LLM-06] the lying fixture produces no finding and the trace records not-ambiguous or evidence-mismatch", () => {
  assert.ok(!lying.result.findings.some((f) => f.origin === "llm"));
  assert.deepEqual(lying.trace.map((l) => [l.matchKeys["entity"], l.matchKeys["field"], l.outcome]), [
    ["Patient", "obs", "evidence-mismatch"],
    ["Appointment", "extra", "evidence-mismatch"],
  ]);
  assert.ok(lying.inventory.entities.every((e) => e.fields.every((f) => f.llmLabel === undefined)));
  assert.equal(lying.result.llm.fieldsClassified, 0);
});

test("[LLM-06] inventory counts are identical with and without labels", () => {
  assert.deepEqual(fake.inventory.counts, none.inventory.counts);
  assert.deepEqual(lying.inventory.counts, none.inventory.counts);
  const strip = (inv: typeof fake.inventory) => JSON.stringify(inv, (k, v) => (k === "llmLabel" ? undefined : v));
  assert.equal(strip(fake.inventory), strip(none.inventory));
});

test("summary counts: 5 error, 10 warning, 3 note with the fake; llm 2 fields labeled", () => {
  const { summary, llm } = fake.result;
  assert.deepEqual([summary.error, summary.warning, summary.note, summary.llmLabeled, summary.suppressed], [5, 10, 3, 1, 0]);
  assert.deepEqual(llm, { calls: 2, degraded: 0, repaired: 0, fieldsClassified: 2, narrativeSections: 0, simulated: false });
  assert.equal(fake.exitFindings.length, 17);
  assert.ok(fake.exitFindings.every((f) => f.origin === "deterministic"));
});

test("the trace has one line per ambiguous field, sensitive entity first, and llm-trace.jsonl holds it", () => {
  assert.deepEqual(fake.trace.map((l) => [l.seq, l.prompt, l.matchKeys["entity"], l.matchKeys["field"], l.outcome, l.model]), [
    [1, "label-field.v1", "Patient", "obs", "ok", "fake-scripted"],
    [2, "label-field.v1", "Appointment", "extra", "ok", "fake-scripted"],
  ]);
  const lines = readFileSync(join(fake.outDir, "llm-trace.jsonl"), "utf8").trimEnd().split("\n").map((l) => JSON.parse(l) as { seq: number });
  assert.deepEqual(lines.map((l) => l.seq), [1, 2]);
  assert.ok(fake.written.includes("llm-trace.jsonl"));
  assert.ok(!none.written.includes("llm-trace.jsonl"));
});

test("--max-llm-fields caps the labeled fields (sensitive entity first)", async (t) => {
  const capped = await runScanInProcess(t, { llm: fakeSetup("fixtures/llm/telehealth-clinic.json"), maxLlmFields: 1 });
  assert.deepEqual(capped.trace.map((l) => l.matchKeys["field"]), ["obs"]);
  const zero = await runScanInProcess(t, { llm: fakeSetup("fixtures/llm/telehealth-clinic.json"), maxLlmFields: 0 });
  assert.equal(zero.trace.length, 0);
  assert.equal(zero.result.llm.calls, 0);
});
