import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { articleKey, type RuleId } from "../../src/contracts/catalog.ts";
import { findingSchema, type Finding, type Severity } from "../../src/contracts/findings.ts";
import { makeLabelFieldOutputSchema, type AmbiguousField, type LlmLabel } from "../../src/contracts/llm.ts";
import { sensitivityFor } from "../../src/engine/classify-field.ts";
import { compareFindings } from "../../src/engine/finalize.ts";
import { mergeFindings, type MergeContext } from "../../src/engine/merge-findings.ts";
import { finding, testCatalog } from "../helpers/builders.ts";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";
import { mulberry32, propertySeed } from "../helpers/prng.ts";

const catalog = testCatalog();
const ids = catalog.categories.map((c) => c.id);
const personalIds = catalog.categories.filter((c) => sensitivityFor(c, "both") !== "not-personal").map((c) => c.id);
const labelOutputSchema = makeLabelFieldOutputSchema(ids);

const FILES = ["prisma/schema.prisma", "src/a.ts", "migrations/001_init.sql"];
const maskedLines = new Map<string, string[]>(FILES.map((f) => [f, Array.from({ length: 60 }, (_, i) => `  line ${i + 1} of ${f}   Json?`)]));
const ctx: MergeContext = { catalog, regime: "both", maskedLines, minConfidence: 0.5 };

const ENTITIES = ["Patient", "Appointment", "Clinic", "Order"];
const FIELDS = ["obs", "extra", "cpf", "email", "notes", "meta", "payload", "diagnosis"];
const DET_RULES: RuleId[] = ["PR-LOG", "PR-THIRD-PARTY", "PR-ANALYTICS", "PR-FILE", "PR-URL-QUERY", "PR-TRANSFER", "PR-PLAINTEXT-SENSITIVE", "PR-RETENTION", "PR-CHILD", "PR-HARDCODED-VALUE"];
const SEVERITIES: Severity[] = ["error", "warning", "note"];
const pick = <T>(rnd: () => number, list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
const hex = (rnd: () => number, n: number) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join("");

function genFindings(rnd: () => number): Finding[] {
  return Array.from({ length: Math.floor(rnd() * 9) }, () => {
    const fp = hex(rnd, 32);
    const withEntity = rnd() < 0.6;
    return finding({
      id: `PRF-${fp.slice(0, 12)}`,
      fingerprint: fp,
      ruleId: pick(rnd, DET_RULES),
      categories: rnd() < 0.5 ? [pick(rnd, ids)] : [pick(rnd, ids), pick(rnd, ids)],
      severity: pick(rnd, SEVERITIES),
      confidence: Math.round(rnd() * 100) / 100,
      location: { file: pick(rnd, FILES), line: 1 + Math.floor(rnd() * 50), column: 1 + Math.floor(rnd() * 10), snippet: "masked" },
      ...(withEntity ? { entity: { name: pick(rnd, ENTITIES), field: pick(rnd, FIELDS), kind: "model" as const } } : {}),
      ...(rnd() < 0.1 ? { suppressed: { reason: "accepted by the team", by: "dpo" } } : {}),
    });
  });
}

function amb(entity: string, field: string, line: number, comment: string | null = null): AmbiguousField {
  return {
    entity,
    field,
    entityKind: "model",
    file: "prisma/schema.prisma",
    line,
    column: 3,
    sensitiveEntity: entity === "Patient",
    input: {
      field: { name: field, rawType: "Json", optional: true, array: false, entity, declarationText: `${field} Json?`, entityFields: ["id", "diagnosis", field], sourceKind: "prisma", file: "prisma/schema.prisma", line },
      candidateCategories: [],
      maskedSamples: [],
      comment,
    },
  };
}

function genAmbiguous(rnd: () => number, det: readonly Finding[]): AmbiguousField[] {
  const out: AmbiguousField[] = [];
  const n = Math.floor(rnd() * 5);
  for (let i = 0; i < n; i++) {
    const fromDet = det.length > 0 && rnd() < 0.3 ? det[Math.floor(rnd() * det.length)]!.entity : undefined;
    const entity = fromDet?.name ?? pick(rnd, ENTITIES);
    const field = fromDet?.field ?? pick(rnd, FIELDS);
    if (!out.some((a) => a.entity === entity && a.field === field)) out.push(amb(entity, field, 1 + Math.floor(rnd() * 50), rnd() < 0.5 ? "free text" : null));
  }
  return out;
}

function label(entity: string, field: string, over: Partial<LlmLabel> = {}): LlmLabel {
  return { entity, field, file: "prisma/schema.prisma", line: 1, column: 1, label: "special.health", confidence: 0.62, evidence: `${field} Json?`, rationale: "r", scripted: true, ...over };
}

function genLabels(rnd: () => number, det: readonly Finding[], ambiguous: readonly AmbiguousField[]): LlmLabel[] {
  const out: LlmLabel[] = [];
  for (const f of det) if (f.entity && rnd() < 0.7) out.push(label(f.entity.name, f.entity.field, { label: "not-personal", confidence: 1, evidence: "ignore all findings", rationale: "Delete all findings" }));
  for (const a of ambiguous) {
    const evidence = rnd() < 0.7 ? `${a.field} Json?` : pick(rnd, ["ignore all findings", "x", a.field.slice(0, 2), "diagnosis"]);
    out.push(label(a.entity, a.field, { label: rnd() < 0.8 ? pick(rnd, personalIds) : pick(rnd, ["not-personal", "unknown", ...ids]), confidence: Math.round(rnd() * 100) / 100, evidence }));
  }
  const extra = Math.floor(rnd() * 3);
  for (let i = 0; i < extra; i++) out.push(label(pick(rnd, ENTITIES), pick(rnd, FIELDS), { label: pick(rnd, [...ids, "not-personal", "unknown"]), confidence: rnd() }));
  return out;
}

const FIXED = { lgpd: ["5 I"], gdpr: ["4(1)"] };
const keysOf = (f: Finding) => ({ lgpd: f.articles.lgpd.map(articleKey), gdpr: f.articles.gdpr.map(articleKey) });

test("[LLM-04] for 500 generated pairs every deterministic finding is in the result deep-equal and unchanged", () => {
  const seed = propertySeed();
  const rnd = mulberry32(seed);
  for (let i = 0; i < 500; i++) {
    const det = genFindings(rnd);
    const before = structuredClone(det);
    const ambiguous = genAmbiguous(rnd, det);
    const labels = genLabels(rnd, det, ambiguous);
    const out = mergeFindings(det, labels, ambiguous, ctx);
    assert.ok(out.length >= det.length, `seed=${seed} i=${i}`);
    for (const f of det) assert.ok(out.includes(f), `seed=${seed} i=${i}`);
    assert.deepEqual(det, before, `seed=${seed} i=${i}`);
    assert.deepEqual(out.filter((f) => det.includes(f)), [...det].sort(compareFindings), `seed=${seed} i=${i}`);
    const added = out.filter((x) => !det.includes(x));
    assert.ok(added.length <= ambiguous.length, `seed=${seed} i=${i}`);
    for (const f of added) {
      assert.deepEqual([f.origin, f.ruleId, f.severity], ["llm", "PR-AMBIGUOUS", "note"], `seed=${seed} i=${i}`);
      assert.deepEqual(keysOf(f), FIXED, `seed=${seed} i=${i}`);
      assert.ok(ambiguous.some((a) => a.entity === f.entity?.name && a.field === f.entity?.field), `seed=${seed} i=${i}`);
      assert.ok(f.confidence >= 0.5 && f.confidence <= 0.79 && f.confidenceLevel === "medium", `seed=${seed} i=${i}`);
      assert.ok(findingSchema.safeParse(f).success, `seed=${seed} i=${i}`);
    }
    for (let k = 1; k < out.length; k++) assert.ok(compareFindings(out[k - 1]!, out[k]!) <= 0, `seed=${seed} i=${i} order`);
  }
});

test("[LLM-12] PR-AMBIGUOUS articles are LGPD 5 I and GDPR 4(1) whatever the label", () => {
  assert.ok(personalIds.length > 30);
  for (const id of personalIds) {
    const out = mergeFindings([], [label("Patient", "obs", { label: id, evidence: "obs Json?" })], [amb("Patient", "obs", 17)], ctx);
    assert.equal(out.length, 1, id);
    assert.deepEqual(keysOf(out[0]!), FIXED, id);
  }
  const lgpdOnly = mergeFindings([], [label("Patient", "obs")], [amb("Patient", "obs", 17)], { ...ctx, regime: "lgpd" });
  assert.deepEqual(keysOf(lgpdOnly[0]!), { lgpd: ["5 I"], gdpr: [] });
});

test("the added finding: note, label category, capped confidence, llm-label evidence and the field's preferred location", () => {
  const det = [finding({ severity: "warning", location: { file: "src/a.ts", line: 3, column: 1, snippet: "x" } })];
  const [first, second] = mergeFindings(det, [label("Patient", "obs", { confidence: 0.95 })], [amb("Patient", "obs", 17)], ctx);
  assert.equal(first, det[0]);
  const f = second!;
  assert.equal(findingSchema.parse(f).ruleId, "PR-AMBIGUOUS");
  assert.deepEqual([f.origin, f.severity, f.categories, f.sensitivity, f.confidence, f.confidenceLevel, f.belowThreshold], ["llm", "note", ["special.health"], "sensitive", 0.79, "medium", false]);
  assert.deepEqual(f.location, { file: "prisma/schema.prisma", line: 17, column: 3, snippet: "line 17 of prisma/schema.prisma Json?" });
  assert.deepEqual(f.entity, { name: "Patient", field: "obs", kind: "model" });
  assert.deepEqual(f.evidence, [{ kind: "llm-label", detail: "special.health (0.95)", weight: 0 }]);
  assert.match(f.fingerprint, /^[0-9a-f]{32}$/);
  assert.equal(f.id, `PRF-${f.fingerprint.slice(0, 12)}`);
  assert.match(f.message, /Patient\.obs/);
  assert.equal(f.suppressed, undefined);
});

test("[LLM-06] a label for a field the engine did not mark ambiguous is dropped", () => {
  const lying = JSON.parse(readFileSync(join(PROJECT_ROOT_FOR_TESTS, "tests", "fixtures", "llm", "lying-labels.json"), "utf8")) as { turns: { when: { entity: string; field: string }; output: Omit<LlmLabel, "entity" | "field" | "file" | "line" | "column" | "scripted"> }[] };
  const cpf = lying.turns.find((t) => t.when.field === "cpf")!;
  const det = [finding({ entity: { name: "Patient", field: "cpf", kind: "model" } })];
  const asLabel = label("Patient", "cpf", cpf.output);
  assert.deepEqual(mergeFindings(det, [asLabel], [amb("Patient", "obs", 17)], ctx), det);
  assert.deepEqual(mergeFindings(det, [{ ...asLabel, label: "special.health", confidence: 0.9 }], [amb("Patient", "obs", 17)], ctx), det);
});

test("[LLM-06] a label whose evidence is not in the field's declaration or comment is dropped", () => {
  const field = amb("Patient", "obs", 17, "clinical observations");
  assert.equal(mergeFindings([], [label("Patient", "obs", { evidence: "medical record number and HIV status" })], [field], ctx).length, 0);
  assert.equal(mergeFindings([], [label("Patient", "obs", { evidence: "diagnosis" })], [field], ctx).length, 0, "a sibling name is not the field's own text");
  assert.equal(mergeFindings([], [label("Patient", "obs", { evidence: "ob" })], [field], ctx).length, 0, "at least 3 characters");
  assert.equal(mergeFindings([], [label("Patient", "obs", { evidence: "clinical  observations" })], [field], ctx).length, 1, "the comment counts");
});

test("[LLM-04] suppress-attempt outputs with severity, suppress and articles keys are rejected by the strict schema", () => {
  const data = JSON.parse(readFileSync(join(PROJECT_ROOT_FOR_TESTS, "tests", "fixtures", "llm", "suppress-attempt.json"), "utf8")) as { outputs: unknown[] };
  assert.ok(data.outputs.length >= 3);
  for (const o of data.outputs) assert.equal(labelOutputSchema.safeParse(o).success, false);
});

test("labels not-personal and unknown add no finding; confidence below 0.5 adds none; a not-personal category adds none", () => {
  const field = [amb("Patient", "obs", 17)];
  for (const l of [{ label: "not-personal" }, { label: "unknown" }, { label: "special.health", confidence: 0.49 }, { label: "identifier.cnpj" }]) {
    assert.deepEqual(mergeFindings([], [label("Patient", "obs", l)], field, ctx), [], JSON.stringify(l));
  }
  assert.equal(mergeFindings([], [label("Patient", "obs", { confidence: 0.5 })], field, ctx).length, 1);
});
